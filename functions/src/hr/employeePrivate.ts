import { randomUUID } from 'node:crypto';

import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { bucket, downloadUrl, IMAGE_TYPES } from '../catalogue/covers.js';
import { aadhaarInput } from '../core/aadhaar.js';
import { recordAudit, recordAuditNow } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, name } from '../core/schemas.js';
import { auditCtx, date, optionalEmail, phone } from './common.js';
import { type ChecklistItem, loadEmployee, requireFor } from './model.js';
import { deleteFile, stagedCommand, storeNew } from './staged.js';

/**
 * An employee's private details (docs/HRMS.md §6): personal and statutory
 * details (orgs/{o}/employees/{e}/private/profile), the full Aadhaar and bank
 * account numbers (private/aadhaar, private/bank: no client reads them), and
 * the profile picture.
 */

const bankRef = (orgId: string, employeeId: string) => db.doc(`orgs/${orgId}/employees/${employeeId}/private/bank`);
const aadhaarRef = (orgId: string, employeeId: string) => db.doc(`orgs/${orgId}/employees/${employeeId}/private/aadhaar`);

/**
 * Self-onboarding: people fill in their own personal details and, once, their
 * salary account (a later change goes through HR, so a taken-over sign-in
 * can't redirect salary). Otherwise the HR permission is needed. Returns
 * whether the caller is the employee.
 */
async function requireSelfOr(actor: Actor, perm: 'employees.privateData' | 'employees.bank' | 'employees.edit', orgId: string, snap: DocumentSnapshot, tx: Transaction) {
  if (snap.get('uid') && snap.get('uid') === actor.uid && snap.get('status') !== 'OFFBOARDED') return true;
  await requireFor(actor, perm, orgId, snap.get('branchId'), tx);
  return false;
}

/** While joining, ticks the checklist items the details now cover (HR can still untick them). */
function checklistTicks(snap: DocumentSnapshot, keys: string[], by: string): { onboarding: ChecklistItem[] } | null {
  if (snap.get('status') !== 'ONBOARDING' || !keys.length) return null;
  const items = (snap.get('onboarding') ?? []) as ChecklistItem[];
  if (!items.some((i) => keys.includes(i.key) && !i.done)) return null;
  const at = new Date().toISOString();
  return { onboarding: items.map((i) => (keys.includes(i.key) && !i.done ? { ...i, done: true, doneBy: by, doneAt: at } : i)) };
}

function tickFromDetails(tx: Transaction, snap: DocumentSnapshot, keys: string[], by: string) {
  const ticks = checklistTicks(snap, keys, by);
  if (ticks) tx.update(snap.ref, { ...ticks, updatedAt: FieldValue.serverTimestamp() });
}

const pan = z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'must be a valid PAN (ABCDE1234F)')]).default('');
const text = (max: number) => z.string().trim().max(max).default('');

/** Personal and statutory details (orgs/{o}/employees/{e}/private/profile). */
export const setPrivate = command(
  'employees-setPrivate',
  z.strictObject({
    orgId: id,
    employeeId: id,
    dob: z.union([z.literal(''), date]).default(''),
    gender: z.enum(['', 'FEMALE', 'MALE', 'OTHER']).default(''),
    bloodGroup: text(4),
    personalEmail: optionalEmail,
    personalPhone: phone,
    currentAddress: text(300),
    permanentAddress: text(300),
    emergencyName: text(80),
    emergencyRelation: text(40),
    emergencyPhone: phone,
    pan,
    /** '' keeps the Aadhaar number on file; only its last four digits are readable (private/aadhaar holds it). */
    aadhaar: aadhaarInput,
    uan: z.union([z.literal(''), z.string().trim().regex(/^\d{12}$/, 'must be 12 digits')]).default(''),
    esiNumber: z.union([z.literal(''), z.string().trim().regex(/^\d{10,17}$/, 'must be 10–17 digits')]).default(''),
  }),
  async ({ actor, input, requestId }, tx) => {
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    const self = await requireSelfOr(actor, 'employees.privateData', input.orgId, snap, tx);
    const { orgId, employeeId, aadhaar, ...profile } = input;
    if (aadhaar) tx.set(aadhaarRef(orgId, employeeId), { number: aadhaar, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    tx.set(
      db.doc(`orgs/${orgId}/employees/${employeeId}/private/profile`),
      { ...profile, ...(aadhaar ? { aadhaarLast4: aadhaar.slice(-4) } : {}), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid },
      { merge: true },
    );
    tickFromDetails(tx, snap, [...(profile.pan ? ['pan'] : []), ...(profile.emergencyName && profile.emergencyPhone ? ['emergency-contact'] : [])], actor.email ?? actor.uid);
    // The audit trail records that personal data changed, not the data itself.
    recordAudit(tx, auditCtx(actor, requestId), orgId, {
      action: 'employee.setPrivate', entityType: 'employee', entityId: employeeId, branchId: snap.get('branchId'),
      after: { fields: [...Object.keys(profile).filter((k) => (profile as Record<string, string>)[k] !== ''), ...(aadhaar ? ['aadhaar'] : [])], self },
    });
    return { employeeId };
  },
);

/** Largest profile picture accepted; the console shrinks photos to ~50 KB before sending. */
export const MAX_PHOTO_BYTES = 1_000_000;

/**
 * Sets (image: base64 JPEG/PNG/WebP) or removes (image: null) an employee's
 * profile picture: the person themselves (self-service) or HR who may edit
 * employees at the branch. Stored at employee-photos/{orgId}/{employeeId}/…
 * under a random name (uploaded before the transaction, deleted if the change
 * does not commit) and shown through a download-token URL on the employee
 * record; the old file is deleted once the change commits. While joining, it
 * ticks "Photo collected".
 */
export const setPhoto = stagedCommand(
  'employees-setPhoto',
  z.strictObject({
    orgId: id,
    employeeId: id,
    image: z.string().max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4).nullable(),
  }),
  async ({ actor, input }) => {
    if (input.image === null) return { value: null, discard: async () => {} };
    await db.runTransaction(async (tx) => requireSelfOr(actor, 'employees.edit', input.orgId, await loadEmployee(tx, input.orgId, input.employeeId), tx), { readOnly: true });
    const bytes = Buffer.from(input.image, 'base64');
    const kind = IMAGE_TYPES.find((t) => t.matches(bytes));
    if (!kind) throw errors.invalid('The photo must be a JPEG, PNG or WebP image.');
    if (bytes.length > MAX_PHOTO_BYTES) throw errors.invalid('The photo is too large (1 MB at most).');
    const token = randomUUID();
    const file = await storeNew(`employee-photos/${input.orgId}/${input.employeeId}/${randomUUID()}.${kind.ext}`, bytes, kind.type, {
      cacheControl: 'private, max-age=31536000, immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    });
    return { value: { photoUrl: downloadUrl(file.bucket.name, file.name, token), photoPath: file.name }, discard: () => deleteFile(file) };
  },
  async ({ actor, input, requestId }, tx, photo) => {
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    const self = await requireSelfOr(actor, 'employees.edit', input.orgId, snap, tx);
    const previousPath = (snap.get('photoPath') as string | undefined) ?? null;
    if (!photo && !previousPath) return { employeeId: input.employeeId, photoUrl: null, previousPath: null };
    tx.update(snap.ref, {
      photoUrl: photo?.photoUrl ?? null,
      photoPath: photo?.photoPath ?? null,
      ...(photo ? checklistTicks(snap, ['photo'], actor.email ?? actor.uid) : null),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: photo ? 'employee.photo.set' : 'employee.photo.remove',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: snap.get('branchId'),
      after: { self },
    });
    return { employeeId: input.employeeId, photoUrl: photo?.photoUrl ?? null, previousPath: previousPath === photo?.photoPath ? null : previousPath };
  },
  async ({ previousPath }) => {
    if (previousPath) await bucket().file(previousPath).delete({ ignoreNotFound: true });
  },
);

/**
 * Shows the full Aadhaar number to HR with access to personal data, or to the
 * employee, and records that they did. A query, not a command: a command's
 * result is kept for replays, which would keep the number too.
 */
export const revealAadhaar = query('employees-revealAadhaar', z.strictObject({ orgId: id, employeeId: id }), async ({ actor, input }) => {
  const { employee, doc } = await db.runTransaction(async (tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireSelfOr(actor, 'employees.privateData', input.orgId, employee, tx);
    return { employee, doc: await tx.get(aadhaarRef(input.orgId, input.employeeId)) };
  });
  if (!doc.exists) throw errors.notFound('Aadhaar number');
  await recordAuditNow(auditCtx(actor), input.orgId, { action: 'employee.revealAadhaar', entityType: 'employee', entityId: input.employeeId, branchId: employee.get('branchId') ?? null });
  return { aadhaar: doc.get('number') as string };
});

/**
 * Salary account. The full number is kept in private/bank (no client can read
 * it); the profile shows it masked, and revealing it is audited.
 */
export const setBank = command(
  'employees-setBank',
  z.strictObject({
    orgId: id,
    employeeId: id,
    accountHolder: name,
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'must be 9–18 digits'),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'must be a valid IFSC (e.g. HDFC0001234)'),
    bankName: name,
  }),
  async ({ actor, input, requestId }, tx) => {
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    const self = await requireSelfOr(actor, 'employees.bank', input.orgId, snap, tx);
    if (self && (await tx.get(bankRef(input.orgId, input.employeeId))).exists) {
      throw errors.conflict('BANK_ON_FILE', 'Your salary account is already recorded. Ask HR to change it.');
    }
    const { orgId, employeeId, ...bank } = input;
    const masked = { accountHolder: bank.accountHolder, bankName: bank.bankName, ifsc: bank.ifsc, last4: bank.accountNumber.slice(-4) };
    tx.set(bankRef(orgId, employeeId), { ...bank, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    tx.set(db.doc(`orgs/${orgId}/employees/${employeeId}/private/profile`), { bank: masked, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tickFromDetails(tx, snap, ['bank'], actor.email ?? actor.uid);
    recordAudit(tx, auditCtx(actor, requestId), orgId, { action: 'employee.setBank', entityType: 'employee', entityId: employeeId, branchId: snap.get('branchId'), after: { ...masked, self } });
    return { employeeId };
  },
);

/** Shows the full account number to someone allowed to see it, and records that they did. A query, like revealAadhaar. */
export const revealBank = query('employees-revealBank', z.strictObject({ orgId: id, employeeId: id }), async ({ actor, input }) => {
  const { employee, bank } = await db.runTransaction(async (tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'employees.bank', input.orgId, employee.get('branchId'), tx);
    return { employee, bank: await tx.get(bankRef(input.orgId, input.employeeId)) };
  });
  if (!bank.exists) throw errors.notFound('Bank account');
  await recordAuditNow(auditCtx(actor), input.orgId, { action: 'employee.revealBank', entityType: 'employee', entityId: input.employeeId, branchId: employee.get('branchId') ?? null });
  return { accountNumber: bank.get('accountNumber') as string };
});
