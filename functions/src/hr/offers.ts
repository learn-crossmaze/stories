import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { z } from 'zod';

import { recordAudit, recordAuditNow } from '../core/audit.js';
import { bucket } from '../catalogue/covers.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { LINKS, notify } from '../core/notify.js';
import type { Actor } from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import { dateKeyIST } from '../core/time.js';
import { ROLES, type Role } from '../generated/rbac.js';
import { EMPLOYMENT_TYPES, canFor, employeesCol, loadEmployee } from './model.js';
import { offerLetterPdf, type OfferLetter } from './offerLetterPdf.js';

/**
 * Offer letters (docs/HRMS.md §12). HR and branch managers (`offers.release`
 * at the employee's branch; head-office staff need all branches) prepare a
 * letter, preview it, and release it. Releasing stores the PDF in the
 * employee's private documents as a verified "Offer letter", so the employee
 * finds it under My documents. Nobody releases or withdraws their own offer.
 */

/** Document type the released letter is filed under (the signed copy stays under "Signed offer letter"). */
export const OFFER_DOCUMENT_TYPE = { id: 'offer-letter-issued', name: 'Offer letter', category: 'CONTRACT' } as const;
/** Employees who can still be made an offer. */
const OFFERABLE = ['DRAFT', 'ONBOARDING', 'ACTIVE'];

const offersCol = (orgId: string) => db.collection(`orgs/${orgId}/offerLetters`);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const auditCtx = (actor: Actor, requestId?: string) => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });

const terms = z.strictObject({
  orgId: id,
  employeeId: id,
  designation: z.string().trim().min(2).max(80),
  department: z.string().trim().max(80).default(''),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  joiningDate: date,
  annualCtc: z.number().int().min(1000).max(100_000_000),
  probationMonths: z.number().int().min(0).max(24).default(6),
  noticeDays: z.number().int().min(0).max(180).default(30),
  acceptBy: date,
  reportingTo: z.string().trim().max(80).default(''),
  terms: z.string().trim().max(2000).default(''),
});
type Terms = z.infer<typeof terms>;

/** The record is the caller's own: linked to their account, or unlinked but under their email. */
const isOwnRecord = (actor: Actor, employee: DocumentSnapshot) =>
  (!!employee.get('uid') && employee.get('uid') === actor.uid) ||
  (!employee.get('uid') && !!actor.email && employee.get('emailLower') === actor.email.toLowerCase());

/** Checks the caller may release or withdraw an offer for this employee. */
async function requireReleaser(actor: Actor, orgId: string, employee: DocumentSnapshot, tx: Transaction) {
  if (!(await canFor(actor, 'offers.release', orgId, employee.get('branchId') ?? null, tx))) throw errors.forbidden();
  if (isOwnRecord(actor, employee)) throw errors.forbidden("You can't release or withdraw your own offer letter. Ask HR or another manager.");
}

function checkTerms(input: Terms, employee: DocumentSnapshot) {
  if (!OFFERABLE.includes(employee.get('status'))) throw errors.conflict('NOT_OFFERABLE', 'Offer letters can only be released to employees who are in draft, onboarding or active.');
  const today = dateKeyIST(new Date());
  if (input.acceptBy < today) throw errors.invalid('The date to accept by has passed.');
  if (input.acceptBy > input.joiningDate) throw errors.invalid('The date to accept by must be on or before the joining date.');
}

/** Everything the letter needs besides the terms: organization, place of work, who signs it. */
async function letterContext(tx: Transaction, actor: Actor, orgId: string, employee: DocumentSnapshot) {
  const branchId = employee.get('branchId') as string | null;
  const [org, branch, signer, membership] = await Promise.all([
    tx.get(db.doc(`orgs/${orgId}`)),
    branchId ? tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`)) : Promise.resolve(null),
    tx.get(employeesCol(orgId).where('uid', '==', actor.uid).limit(1)),
    actor.membership(orgId, tx),
  ]);
  const orgName = (org.get('name') as string | undefined) ?? 'Stories';
  const address = branch?.get('address') as { line1: string; line2?: string; city: string; state: string; postalCode: string } | undefined;
  const branchLines = branch?.exists
    ? [String(branch.get('name')), ...(address ? [[address.line1, address.line2].filter(Boolean).join(', '), `${address.city}, ${address.state} ${address.postalCode}`] : [])]
    : ['Head office'];
  const workLocation = branch?.exists ? [branch.get('name'), address?.city].filter(Boolean).join(', ') : 'Head office';
  const me = signer.docs[0];
  const role = (membership?.roles ?? []).find((r: Role) => ['HR_ADMIN', 'FRANCHISE_OWNER', 'BRANCH_MANAGER'].includes(r));
  return {
    orgName,
    branchLines,
    workLocation,
    signatoryName: (me?.get('fullName') as string | undefined) ?? membership?.displayName ?? actor.profile?.displayName ?? actor.email ?? 'Authorised signatory',
    signatoryTitle: (me?.get('designationName') as string | undefined) ?? (role ? ROLES[role].label : actor.isSuperAdmin ? 'Administrator' : 'Authorised signatory'),
  };
}

function letter(input: Terms, employee: DocumentSnapshot, ctx: Awaited<ReturnType<typeof letterContext>>, number: string, issuedOn: string): OfferLetter {
  return {
    number,
    issuedOn,
    candidateName: employee.get('fullName'),
    candidateCode: employee.get('code'),
    designation: input.designation,
    department: input.department || null,
    employmentType: input.employmentType,
    joiningDate: input.joiningDate,
    annualCtc: input.annualCtc,
    probationMonths: input.probationMonths,
    noticeDays: input.noticeDays,
    acceptBy: input.acceptBy,
    reportingTo: input.reportingTo || null,
    workLocation: ctx.workLocation,
    terms: input.terms,
    signatoryName: ctx.signatoryName,
    signatoryTitle: ctx.signatoryTitle,
  };
}

const fileName = (code: string, number: string) => `offer-letter-${code}-${number.split('/').pop()}.pdf`;

/** The letter as it would be released, marked PREVIEW. Nothing is stored. */
export const preview = query('offers-preview', terms, async ({ actor, input }) => {
  const { employee, ctx } = await db.runTransaction(async (tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireReleaser(actor, input.orgId, employee, tx);
    checkTerms(input, employee);
    return { employee, ctx: await letterContext(tx, actor, input.orgId, employee) };
  });
  const today = dateKeyIST(new Date());
  const number = `OL/${employee.get('code')}/${today.slice(0, 4)}/PREVIEW`;
  const pdf = await offerLetterPdf(letter(input, employee, ctx, number, today), { orgName: ctx.orgName, branchLines: ctx.branchLines, preview: true });
  return { fileName: `offer-letter-${employee.get('code')}-preview.pdf`, contentType: 'application/pdf', content: Buffer.from(pdf).toString('base64') };
});

/**
 * Releases an offer letter: numbers it, generates the PDF, files it in the
 * employee's documents (verified), replaces any earlier released offer, and
 * tells the employee.
 */
export const release = command('offers-release', terms, async ({ actor, input, requestId }, tx) => {
  const employee = await loadEmployee(tx, input.orgId, input.employeeId);
  await requireReleaser(actor, input.orgId, employee, tx);
  checkTerms(input, employee);
  const ctx = await letterContext(tx, actor, input.orgId, employee);
  const earlier = await tx.get(offersCol(input.orgId).where('employeeId', '==', input.employeeId));

  const today = dateKeyIST(new Date());
  const number = `OL/${employee.get('code')}/${today.slice(0, 4)}/${earlier.size + 1}`;
  const content = letter(input, employee, ctx, number, today);
  const pdf = Buffer.from(await offerLetterPdf(content, { orgName: ctx.orgName, branchLines: ctx.branchLines, preview: false }));

  // One offer and one file per request (a retried request overwrites the same file).
  const offerRef = offersCol(input.orgId).doc(requestId ?? offersCol(input.orgId).doc().id);
  const docRef = db.collection(`orgs/${input.orgId}/employees/${input.employeeId}/documents`).doc(offerRef.id);
  const storagePath = `hr/${input.orgId}/${input.employeeId}/${docRef.id}.pdf`;
  const b = bucket();
  await b.file(storagePath).save(pdf, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store' } });

  const copies = {
    orgId: input.orgId,
    employeeId: input.employeeId,
    employeeName: employee.get('fullName'),
    employeeCode: employee.get('code'),
    employeeUid: employee.get('uid') ?? null,
    branchId: employee.get('branchId') ?? null,
  };
  for (const old of earlier.docs.filter((d) => d.get('status') === 'RELEASED')) {
    tx.update(old.ref, { status: 'SUPERSEDED', supersededBy: offerRef.id, updatedAt: FieldValue.serverTimestamp() });
    const oldDoc = db.doc(`orgs/${input.orgId}/employees/${input.employeeId}/documents/${old.get('documentId')}`);
    tx.update(oldDoc, { status: 'SUPERSEDED', supersededBy: docRef.id, updatedAt: FieldValue.serverTimestamp() });
  }
  tx.set(docRef, {
    ...copies,
    typeId: OFFER_DOCUMENT_TYPE.id,
    typeName: OFFER_DOCUMENT_TYPE.name,
    category: OFFER_DOCUMENT_TYPE.category,
    fileName: fileName(content.candidateCode, number),
    contentType: 'application/pdf',
    size: pdf.length,
    storagePath,
    storageBucket: b.name,
    number,
    issuedOn: today,
    expiresOn: null,
    status: 'VERIFIED',
    uploadedBy: actor.uid,
    uploadedByEmail: actor.email,
    selfUploaded: false,
    verifiedBy: actor.uid,
    verifiedByEmail: actor.email,
    verifiedAt: FieldValue.serverTimestamp(),
    rejectReason: null,
    offerId: offerRef.id,
    uploadedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.set(offerRef, {
    ...copies,
    ...content,
    status: 'RELEASED',
    documentId: docRef.id,
    releasedBy: actor.uid,
    releasedByEmail: actor.email,
    releasedAt: FieldValue.serverTimestamp(),
    withdrawnBy: null,
    withdrawnReason: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  notify(
    tx,
    employee.get('uid'),
    { orgId: input.orgId, kind: 'offer.released', title: 'Your offer letter is ready', body: `${input.designation}, joining on ${input.joiningDate}. Find it under My documents.`, link: LINKS.me },
    actor.uid,
  );
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'employee.offer.release',
    entityType: 'employee',
    entityId: input.employeeId,
    branchId: copies.branchId,
    after: { offerId: offerRef.id, number, designation: input.designation, joiningDate: input.joiningDate, annualCtc: input.annualCtc, replaced: earlier.docs.filter((d) => d.get('status') === 'RELEASED').map((d) => d.id) },
  });
  return { offerId: offerRef.id, documentId: docRef.id, number };
});

/** Withdraws a released offer: the letter leaves the employee's documents (kept for the record). */
export const withdraw = command('offers-withdraw', z.strictObject({ orgId: id, offerId: id, reason }), async ({ actor, input, requestId }, tx) => {
  const ref = offersCol(input.orgId).doc(input.offerId);
  const offer = await tx.get(ref);
  if (!offer.exists) throw errors.notFound('Offer letter');
  const employee = await loadEmployee(tx, input.orgId, offer.get('employeeId'));
  await requireReleaser(actor, input.orgId, employee, tx);
  if (offer.get('status') !== 'RELEASED') throw errors.conflict('NOT_RELEASED', 'Only a released offer letter can be withdrawn.');
  tx.update(ref, { status: 'WITHDRAWN', withdrawnBy: actor.uid, withdrawnReason: input.reason, withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  tx.update(db.doc(`orgs/${input.orgId}/employees/${employee.id}/documents/${offer.get('documentId')}`), {
    status: 'REMOVED',
    removedBy: actor.uid,
    removedReason: `Offer withdrawn: ${input.reason}`,
    updatedAt: FieldValue.serverTimestamp(),
  });
  notify(tx, employee.get('uid'), { orgId: input.orgId, kind: 'offer.withdrawn', title: 'Your offer letter was withdrawn', body: input.reason, link: LINKS.me }, actor.uid);
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'employee.offer.withdraw',
    entityType: 'employee',
    entityId: employee.id,
    branchId: employee.get('branchId') ?? null,
    before: { offerId: ref.id, status: 'RELEASED' },
    after: { status: 'WITHDRAWN' },
    reason: input.reason,
  });
  return { offerId: ref.id };
});

/** The released letter (base64 PDF) for those who may release offers at the branch, or the employee. Audited. */
export const open = query('offers-open', z.strictObject({ orgId: id, offerId: id }), async ({ actor, input }) => {
  const offer = await offersCol(input.orgId).doc(input.offerId).get();
  if (!offer.exists) throw errors.notFound('Offer letter');
  const own = !!offer.get('employeeUid') && offer.get('employeeUid') === actor.uid;
  const staff = await db.runTransaction((tx) => canFor(actor, 'offers.release', input.orgId, offer.get('branchId') ?? null, tx));
  if (!own && !staff) throw errors.notFound('Offer letter');
  const file = await db.doc(`orgs/${input.orgId}/employees/${offer.get('employeeId')}/documents/${offer.get('documentId')}`).get();
  const stored = file.get('storageBucket') as string | undefined;
  const [bytes] = await (stored ? getStorage().bucket(stored) : bucket()).file(file.get('storagePath')).download();
  await recordAuditNow(auditCtx(actor), input.orgId, {
    action: 'employee.offer.open',
    entityType: 'employee',
    entityId: offer.get('employeeId'),
    branchId: offer.get('branchId') ?? null,
    after: { offerId: offer.id, number: offer.get('number') },
  });
  return { fileName: file.get('fileName') as string, contentType: 'application/pdf', content: bytes.toString('base64') };
});
