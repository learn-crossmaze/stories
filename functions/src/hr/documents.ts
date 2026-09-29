import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';

import { recordAudit, recordAuditNow } from '../core/audit.js';
import { bucket } from '../catalogue/covers.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { LINKS, notify } from '../core/notify.js';
import { db, REGION } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, name, reason } from '../core/schemas.js';
import { dateKeyIST } from '../core/time.js';
import { type ChecklistItem, canFor, loadEmployee } from './model.js';

/**
 * Employee documents (docs/HRMS.md §7). Files are private: they live in
 * Storage under hr/{orgId}/{employeeId}/, which no client can read or write;
 * they go up and come down only through these callables, which check
 * permissions and record every opening in the audit log.
 */

/** Largest file accepted (a callable request carries at most 10 MB, and base64 adds a third). */
export const MAX_DOCUMENT_BYTES = 5_000_000;

const FILE_TYPES: { type: string; ext: string; matches: (b: Buffer) => boolean }[] = [
  { type: 'application/pdf', ext: 'pdf', matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'image/jpeg', ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];

export const DOCUMENT_CATEGORIES = ['IDENTITY', 'ADDRESS', 'STATUTORY', 'CONTRACT', 'EDUCATION', 'EMPLOYMENT', 'OTHER'] as const;
export type DocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED' | 'REMOVED';

export interface DocumentType {
  name: string;
  category: (typeof DOCUMENT_CATEGORIES)[number];
  /** Every employee should have one on file (shown as missing on the profile). */
  required: boolean;
  /** The document carries an expiry date (licences, police verification…). */
  hasExpiry: boolean;
  /** How many days before expiry it shows as "expiring soon". */
  reminderDays: number;
  /** Employees may upload it themselves (HR then verifies it). */
  selfUpload: boolean;
  /** Onboarding checklist item ticked when this document is verified. */
  checklistKey: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

/** Types every organization starts with; an org's own documentTypes/{id} overrides the default with the same id. */
export const DEFAULT_DOCUMENT_TYPES: Record<string, DocumentType> = {
  aadhaar: { name: 'Aadhaar card', category: 'IDENTITY', required: true, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'id-proof', status: 'ACTIVE' },
  'pan-card': { name: 'PAN card', category: 'STATUTORY', required: true, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'pan', status: 'ACTIVE' },
  'bank-proof': { name: 'Cancelled cheque or bank passbook', category: 'STATUTORY', required: true, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'bank', status: 'ACTIVE' },
  'address-proof': { name: 'Address proof', category: 'ADDRESS', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'address-proof', status: 'ACTIVE' },
  photo: { name: 'Photograph', category: 'IDENTITY', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: 'photo', status: 'ACTIVE' },
  'offer-letter': { name: 'Signed offer letter', category: 'CONTRACT', required: true, hasExpiry: false, reminderDays: 30, selfUpload: false, checklistKey: 'offer-letter', status: 'ACTIVE' },
  education: { name: 'Education certificate', category: 'EDUCATION', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  'previous-employment': { name: 'Previous employment letter', category: 'EMPLOYMENT', required: false, hasExpiry: false, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  'driving-licence': { name: 'Driving licence', category: 'IDENTITY', required: false, hasExpiry: true, reminderDays: 30, selfUpload: true, checklistKey: null, status: 'ACTIVE' },
  'police-verification': { name: 'Police verification', category: 'OTHER', required: false, hasExpiry: true, reminderDays: 45, selfUpload: false, checklistKey: null, status: 'ACTIVE' },
};

const typeRef = (orgId: string, typeId: string) => db.doc(`orgs/${orgId}/documentTypes/${typeId}`);
const documentsCol = (orgId: string, employeeId: string) => db.collection(`orgs/${orgId}/employees/${employeeId}/documents`);

async function loadType(tx: Transaction, orgId: string, typeId: string): Promise<DocumentType> {
  const snap = await tx.get(typeRef(orgId, typeId));
  const type = snap.exists ? (snap.data() as DocumentType) : DEFAULT_DOCUMENT_TYPES[typeId];
  if (!type || type.status !== 'ACTIVE') throw errors.notFound('Document type');
  return type;
}

/** HR staff who may manage an employee's documents (upload, open, remove). */
async function isDocumentStaff(actor: Actor, orgId: string, employee: DocumentSnapshot, tx: Transaction) {
  const branchId = employee.get('branchId') as string | null;
  return (await canFor(actor, 'documents.verify', orgId, branchId, tx)) || (await canFor(actor, 'employees.edit', orgId, branchId, tx));
}

const isSelf = (actor: Actor, employee: DocumentSnapshot) => !!employee.get('uid') && employee.get('uid') === actor.uid;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const auditCtx = (actor: Actor, requestId?: string) => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });

/**
 * On verification: older verified or expired copies of the same type are
 * superseded, and the matching onboarding checklist item is ticked.
 */
async function verifyEffects(tx: Transaction, actor: Actor, orgId: string, employee: DocumentSnapshot, typeId: string, type: DocumentType, keepId: string) {
  const older = await tx.get(documentsCol(orgId, employee.id).where('typeId', '==', typeId).where('status', 'in', ['VERIFIED', 'EXPIRED']));
  return () => {
    for (const d of older.docs) if (d.id !== keepId) tx.update(d.ref, { status: 'SUPERSEDED', supersededBy: keepId, updatedAt: FieldValue.serverTimestamp() });
    const items = (employee.get('onboarding') ?? null) as ChecklistItem[] | null;
    if (type.checklistKey && employee.get('status') === 'ONBOARDING' && items?.some((i) => i.key === type.checklistKey && !i.done)) {
      const next = items.map((i) => (i.key === type.checklistKey ? { ...i, done: true, doneBy: actor.email ?? actor.uid, doneAt: new Date().toISOString() } : i));
      tx.update(employee.ref, { onboarding: next, updatedAt: FieldValue.serverTimestamp() });
    }
  };
}

/**
 * Uploads a document (base64 PDF, JPEG or PNG, 5 MB at most). Uploaded by a
 * verifier for someone else it is verified at once (they saw the original);
 * uploaded by the employee (types marked self-upload, or any type for HR staff
 * themselves) it waits for another verifier.
 */
export const upload = command(
  'documents-upload',
  z.strictObject({
    orgId: id,
    employeeId: id,
    typeId: id,
    fileName: z.string().trim().min(1).max(120),
    content: z.string().min(8).max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 4),
    number: z.string().trim().max(40).default(''),
    issuedOn: z.union([z.literal(''), date]).default(''),
    expiresOn: z.union([z.literal(''), date]).default(''),
  }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    const type = await loadType(tx, input.orgId, input.typeId);
    const staff = await isDocumentStaff(actor, input.orgId, employee, tx);
    if (!staff && !(isSelf(actor, employee) && type.selfUpload)) throw errors.forbidden();
    if (employee.get('status') === 'OFFBOARDED' && !staff) throw errors.forbidden();
    if (type.hasExpiry && !input.expiresOn) throw errors.invalid('Enter the expiry date.');
    const today = dateKeyIST(new Date());
    if (input.expiresOn && input.expiresOn <= today) throw errors.invalid('This document has already expired.');
    if (input.issuedOn && input.issuedOn > today) throw errors.invalid('The issue date is in the future.');

    const bytes = Buffer.from(input.content, 'base64');
    const kind = FILE_TYPES.find((t) => t.matches(bytes));
    if (!kind) throw errors.invalid('Upload a PDF, JPEG or PNG file.');
    if (bytes.length > MAX_DOCUMENT_BYTES) throw errors.invalid('The file is too large (5 MB at most).');

    // One file per request (a retried request overwrites the same file).
    const ref = documentsCol(input.orgId, input.employeeId).doc(requestId ?? documentsCol(input.orgId, input.employeeId).doc().id);
    const storagePath = `hr/${input.orgId}/${input.employeeId}/${ref.id}.${kind.ext}`;
    // Documents about yourself always wait for someone else to verify them.
    const verified = staff && !isSelf(actor, employee) && (await canFor(actor, 'documents.verify', input.orgId, employee.get('branchId'), tx));
    const effects = verified ? await verifyEffects(tx, actor, input.orgId, employee, input.typeId, type, ref.id) : null;
    const b = bucket();
    await b.file(storagePath).save(bytes, { resumable: false, contentType: kind.type, metadata: { cacheControl: 'private, no-store' } });

    const record = {
      orgId: input.orgId,
      employeeId: input.employeeId,
      employeeName: employee.get('fullName'),
      employeeCode: employee.get('code'),
      employeeUid: employee.get('uid') ?? null,
      branchId: employee.get('branchId') ?? null,
      typeId: input.typeId,
      typeName: type.name,
      category: type.category,
      fileName: input.fileName,
      contentType: kind.type,
      size: bytes.length,
      storagePath,
      storageBucket: b.name,
      number: input.number,
      issuedOn: input.issuedOn || null,
      expiresOn: input.expiresOn || null,
      status: (verified ? 'VERIFIED' : 'PENDING') as DocumentStatus,
      uploadedBy: actor.uid,
      uploadedByEmail: actor.email,
      selfUploaded: !staff,
      verifiedBy: verified ? actor.uid : null,
      verifiedByEmail: verified ? actor.email : null,
      verifiedAt: verified ? FieldValue.serverTimestamp() : null,
      rejectReason: null,
    };
    tx.set(ref, { ...record, uploadedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    effects?.();
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'employee.document.upload',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: record.branchId,
      after: { documentId: ref.id, type: type.name, status: record.status, fileName: input.fileName },
    });
    return { documentId: ref.id, status: record.status };
  },
);

/** HR verifies or rejects a document an employee uploaded. */
export const review = command(
  'documents-review',
  z.strictObject({ orgId: id, employeeId: id, documentId: id, decision: z.enum(['VERIFY', 'REJECT']), reason: z.string().trim().max(500).default('') }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    if (!(await canFor(actor, 'documents.verify', input.orgId, employee.get('branchId'), tx))) throw errors.forbidden();
    const ref = documentsCol(input.orgId, input.employeeId).doc(input.documentId);
    const doc = await tx.get(ref);
    if (!doc.exists) throw errors.notFound('Document');
    if (doc.get('status') !== 'PENDING') throw errors.conflict('NOT_PENDING', 'This document has already been reviewed.');
    if (doc.get('uploadedBy') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden("You can't verify a document you uploaded yourself.");
    if (input.decision === 'REJECT' && input.reason.length < 3) throw errors.invalid('Say why the document is rejected, so the employee can fix it.');
    const type = await loadType(tx, input.orgId, doc.get('typeId')).catch(() => null);
    const effects = input.decision === 'VERIFY' && type ? await verifyEffects(tx, actor, input.orgId, employee, doc.get('typeId'), type, doc.id) : null;
    const status: DocumentStatus = input.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
    tx.update(ref, {
      status,
      verifiedBy: actor.uid,
      verifiedByEmail: actor.email,
      verifiedAt: FieldValue.serverTimestamp(),
      rejectReason: input.decision === 'REJECT' ? input.reason : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    effects?.();
    notify(
      tx,
      employee.get('uid'),
      {
        orgId: input.orgId,
        kind: status === 'VERIFIED' ? 'document.verified' : 'document.rejected',
        title: status === 'VERIFIED' ? `${doc.get('typeName')} verified` : `${doc.get('typeName')} was not accepted`,
        body: input.decision === 'REJECT' ? `${input.reason} Upload it again from My profile.` : undefined,
        link: LINKS.me,
      },
      actor.uid,
    );
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: input.decision === 'VERIFY' ? 'employee.document.verify' : 'employee.document.reject',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: employee.get('branchId') ?? null,
      after: { documentId: doc.id, type: doc.get('typeName'), status },
      reason: input.reason || null,
    });
    return { documentId: doc.id, status };
  },
);

/** Removes a document from the employee's file (kept for the record, no longer counted). */
export const remove = command(
  'documents-remove',
  z.strictObject({ orgId: id, employeeId: id, documentId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    const ref = documentsCol(input.orgId, input.employeeId).doc(input.documentId);
    const doc = await tx.get(ref);
    if (!doc.exists || doc.get('status') === 'REMOVED') throw errors.notFound('Document');
    const staff = await isDocumentStaff(actor, input.orgId, employee, tx);
    // Employees may withdraw their own upload until HR has accepted it.
    const ownDraft = isSelf(actor, employee) && doc.get('uploadedBy') === actor.uid && ['PENDING', 'REJECTED'].includes(doc.get('status'));
    if (!staff && !ownDraft) throw errors.forbidden();
    tx.update(ref, { status: 'REMOVED', removedBy: actor.uid, removedReason: input.reason, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'employee.document.remove',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: employee.get('branchId') ?? null,
      before: { documentId: doc.id, status: doc.get('status') },
      after: { status: 'REMOVED' },
      reason: input.reason,
    });
    return { documentId: doc.id };
  },
);

/**
 * Returns the file (base64) to someone allowed to see it, and records that they
 * opened it. A query, not a command: the file is too large to keep as a replay result.
 */
export const open = query('documents-open', z.strictObject({ orgId: id, employeeId: id, documentId: id }), async ({ actor, input }) => {
  const { employee, doc } = await db.runTransaction(async (tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    const doc = await tx.get(documentsCol(input.orgId, input.employeeId).doc(input.documentId));
    if (!doc.exists) throw errors.notFound('Document');
    if (!(await isDocumentStaff(actor, input.orgId, employee, tx)) && !isSelf(actor, employee)) throw errors.forbidden();
    return { employee, doc };
  });
  const stored = doc.get('storageBucket') as string | undefined;
  const [bytes] = await (stored ? getStorage().bucket(stored) : bucket()).file(doc.get('storagePath')).download();
  await recordAuditNow(auditCtx(actor), input.orgId, {
    action: 'employee.document.open',
    entityType: 'employee',
    entityId: input.employeeId,
    branchId: employee.get('branchId') ?? null,
    after: { documentId: doc.id, type: doc.get('typeName') },
  });
  return { fileName: doc.get('fileName') as string, contentType: doc.get('contentType') as string, content: bytes.toString('base64') };
});

/** Creates or changes a document type (a default type is overridden under its own id). */
export const saveType = command(
  'documentTypes-save',
  z.strictObject({
    orgId: id,
    typeId: id.optional(),
    name,
    category: z.enum(DOCUMENT_CATEGORIES),
    required: z.boolean(),
    hasExpiry: z.boolean(),
    reminderDays: z.number().int().min(1).max(365).default(30),
    selfUpload: z.boolean(),
    checklistKey: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).nullable().default(null),
  }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const { orgId, typeId, ...fields } = input;
    const ref = typeId ? typeRef(orgId, typeId) : db.collection(`orgs/${orgId}/documentTypes`).doc();
    const before = typeId ? await tx.get(ref) : null;
    if (typeId && !before?.exists && !DEFAULT_DOCUMENT_TYPES[typeId]) throw errors.notFound('Document type');
    const type: DocumentType = { ...fields, status: 'ACTIVE' };
    tx.set(ref, { ...type, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    recordAudit(tx, auditCtx(actor, requestId), orgId, {
      action: typeId ? 'documentType.update' : 'documentType.create',
      entityType: 'documentType',
      entityId: ref.id,
      before: before?.exists ? before.data() : typeId ? DEFAULT_DOCUMENT_TYPES[typeId] : null,
      after: type,
    });
    return { typeId: ref.id };
  },
);

/** Stops offering a document type for new uploads (documents already on file keep it). */
export const archiveType = command(
  'documentTypes-archive',
  z.strictObject({ orgId: id, typeId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const ref = typeRef(input.orgId, input.typeId);
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() as DocumentType) : DEFAULT_DOCUMENT_TYPES[input.typeId];
    if (!current) throw errors.notFound('Document type');
    if (current.status === 'ARCHIVED') throw errors.conflict('ARCHIVED', 'This document type is already archived.');
    const { updatedAt: _u, updatedBy: _b, ...rest } = current as DocumentType & { updatedAt?: unknown; updatedBy?: unknown };
    tx.set(ref, { ...rest, status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'documentType.archive',
      entityType: 'documentType',
      entityId: input.typeId,
      before: { status: 'ACTIVE' },
      after: { status: 'ARCHIVED' },
      reason: input.reason,
    });
    return { typeId: input.typeId };
  },
);

/** Marks verified documents whose expiry date has passed as EXPIRED. Safe to repeat. */
export async function expireDocuments(now = new Date(), batch = 300): Promise<number> {
  const today = dateKeyIST(now);
  const due = await db.collectionGroup('documents').where('status', '==', 'VERIFIED').where('expiresOn', '<', today).limit(batch).get();
  let expired = 0;
  for (const d of due.docs) {
    const done = await db.runTransaction(async (tx) => {
      const snap = await tx.get(d.ref);
      if (snap.get('status') !== 'VERIFIED' || !(snap.get('expiresOn') < today)) return false;
      tx.update(d.ref, { status: 'EXPIRED', expiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      recordAudit(tx, { actorUid: 'system' }, snap.get('orgId'), {
        action: 'employee.document.expire',
        entityType: 'employee',
        entityId: snap.get('employeeId'),
        branchId: snap.get('branchId') ?? null,
        after: { documentId: d.id, type: snap.get('typeName'), expiresOn: snap.get('expiresOn') },
      });
      return true;
    });
    if (done) expired += 1;
  }
  return expired;
}

export const expireSweep = onSchedule({ schedule: 'every day 00:30', timeZone: 'Asia/Kolkata', region: REGION }, async () => {
  const n = await expireDocuments();
  logger.info(`Expired ${n} employee documents`);
});
