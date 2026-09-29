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
import { ROLES, type Permission, type Role } from '../generated/rbac.js';
import { letterPdf } from './letterPdf.js';
import { fill, fillBody, type LetterInputs, type LetterKind, type LetterTemplate, placeholderValues, requireValues, resolveTemplate } from './letterTemplates.js';
import { EMPLOYMENT_TYPES, canFor, employeesCol, loadEmployee } from './model.js';

/**
 * Letters to employees (docs/HRMS.md §12–13): offer letters, appointment
 * letters and custom letters, each worded by the template in force for the
 * employee's branch. HR and branch managers prepare a letter, preview it, and
 * release it: the PDF is filed in the employee's private documents as a
 * verified document, so the employee finds it under My documents. Offers need
 * `offers.release`; other letters `letters.issue`. Nobody issues or withdraws
 * a letter to themselves. Records live in orgs/{o}/offerLetters (with `kind`).
 */

/** Document types letters are filed under (a custom letter gets one per template). */
const DOCUMENT_TYPES: Record<'OFFER' | 'APPOINTMENT', { id: string; name: string }> = {
  OFFER: { id: 'offer-letter-issued', name: 'Offer letter' },
  APPOINTMENT: { id: 'appointment-letter', name: 'Appointment letter' },
};
export const OFFER_DOCUMENT_TYPE = { ...DOCUMENT_TYPES.OFFER, category: 'CONTRACT' } as const;
const PREFIX: Record<LetterKind, string> = { OFFER: 'OL', APPOINTMENT: 'AL', CUSTOM: 'LT' };
/** Employees who can still be made an offer. */
const OFFERABLE = ['DRAFT', 'ONBOARDING', 'ACTIVE'];

const offersCol = (orgId: string) => db.collection(`orgs/${orgId}/offerLetters`);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const auditCtx = (actor: Actor, requestId?: string) => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });
const kindOf = (letter: DocumentSnapshot) => ((letter.get('kind') as LetterKind | undefined) ?? 'OFFER');
const permissionFor = (kind: LetterKind): Permission => (kind === 'OFFER' ? 'offers.release' : 'letters.issue');

const offerTerms = z.strictObject({
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
type OfferTerms = z.infer<typeof offerTerms>;

/** Any other letter: a template, and whichever values it uses (blank ones come from the employee record). */
const letterInput = z.strictObject({
  orgId: id,
  employeeId: id,
  kind: z.enum(['APPOINTMENT', 'CUSTOM']),
  /** Required for custom letters; for appointment letters, blank = the template in force at the branch. */
  templateId: id.optional(),
  designation: z.string().trim().max(80).default(''),
  department: z.string().trim().max(80).default(''),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  joiningDate: z.union([z.literal(''), date]).default(''),
  annualCtc: z.number().int().min(1000).max(100_000_000).nullable().default(null),
  probationMonths: z.number().int().min(0).max(24).nullable().default(null),
  noticeDays: z.number().int().min(0).max(180).nullable().default(null),
  acceptBy: z.union([z.literal(''), date]).default(''),
  reportingTo: z.string().trim().max(80).default(''),
  terms: z.string().trim().max(2000).default(''),
});
type LetterInput = z.infer<typeof letterInput>;

/** The record is the caller's own: linked to their account, or unlinked but under their email. */
const isOwnRecord = (actor: Actor, employee: DocumentSnapshot) =>
  (!!employee.get('uid') && employee.get('uid') === actor.uid) ||
  (!employee.get('uid') && !!actor.email && employee.get('emailLower') === actor.email.toLowerCase());

/** Checks the caller may issue or withdraw this kind of letter for this employee. */
async function requireIssuer(actor: Actor, orgId: string, employee: DocumentSnapshot, kind: LetterKind, tx: Transaction) {
  if (!(await canFor(actor, permissionFor(kind), orgId, employee.get('branchId') ?? null, tx))) throw errors.forbidden();
  if (isOwnRecord(actor, employee)) throw errors.forbidden("You can't issue or withdraw your own letters. Ask HR or another manager.");
}

function checkOfferTerms(input: OfferTerms, employee: DocumentSnapshot) {
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
type Context = Awaited<ReturnType<typeof letterContext>>;

/** Values a letter uses: what was entered, else the employee record. */
function inputsFor(kind: LetterKind, input: OfferTerms | LetterInput, employee: DocumentSnapshot): LetterInputs {
  if (kind === 'OFFER') return input as OfferTerms;
  const i = input as LetterInput;
  return {
    designation: i.designation || ((employee.get('designationName') as string | null) ?? ''),
    department: i.department || ((employee.get('departmentName') as string | null) ?? ''),
    employmentType: i.employmentType ?? (employee.get('employmentType') as string),
    joiningDate: i.joiningDate || ((employee.get('joiningDate') as string | null) ?? null),
    annualCtc: i.annualCtc,
    probationMonths: i.probationMonths,
    noticeDays: i.noticeDays,
    acceptBy: i.acceptBy || null,
    reportingTo: i.reportingTo || ((employee.get('managerName') as string | null) ?? ''),
    terms: i.terms,
  };
}

/** Reads everything and fills the template (reads only). */
async function prepare(tx: Transaction, actor: Actor, kind: LetterKind, input: OfferTerms | LetterInput) {
  const employee = await loadEmployee(tx, input.orgId, input.employeeId);
  await requireIssuer(actor, input.orgId, employee, kind, tx);
  if (kind === 'OFFER') checkOfferTerms(input as OfferTerms, employee);
  else if (employee.get('status') === 'DRAFT') throw errors.conflict('NOT_STARTED', 'Start onboarding before issuing letters other than the offer.');
  const template = await resolveTemplate(tx, input.orgId, kind, employee.get('branchId') ?? null, kind === 'OFFER' ? undefined : (input as LetterInput).templateId);
  const ctx = await letterContext(tx, actor, input.orgId, employee);
  const inputs = inputsFor(kind, input, employee);
  const today = dateKeyIST(new Date());
  const values = placeholderValues(inputs, { fullName: employee.get('fullName'), code: employee.get('code'), exitDate: employee.get('exitDate') ?? null }, ctx, today);
  requireValues(template, values);
  return { employee, template, ctx, inputs, values, today };
}

function render(p: { employee: DocumentSnapshot; template: LetterTemplate; ctx: Context; values: Record<string, string>; today: string }, number: string) {
  return {
    number,
    issuedOn: p.today,
    recipientName: p.employee.get('fullName') as string,
    recipientCode: p.employee.get('code') as string,
    subject: fill(p.template.subject, p.values),
    body: fillBody(p.template.body, p.values),
    acceptance: p.template.acceptance,
    signatoryName: p.ctx.signatoryName,
    signatoryTitle: p.ctx.signatoryTitle,
  };
}

async function previewPdf(actor: Actor, kind: LetterKind, input: OfferTerms | LetterInput) {
  const p = await db.runTransaction((tx) => prepare(tx, actor, kind, input));
  const pdf = await letterPdf(render(p, `${PREFIX[kind]}/${p.employee.get('code')}/${p.today.slice(0, 4)}/PREVIEW`), { orgName: p.ctx.orgName, branchLines: p.ctx.branchLines, preview: true });
  return { fileName: `${PREFIX[kind].toLowerCase()}-${p.employee.get('code')}-preview.pdf`, contentType: 'application/pdf', content: Buffer.from(pdf).toString('base64') };
}

/**
 * Issues a letter: numbers it, generates the PDF, files it in the employee's
 * documents (verified), replaces the earlier letter of the same kind (and
 * template, for custom letters), and tells the employee.
 */
async function issue(tx: Transaction, actor: Actor, kind: LetterKind, input: OfferTerms | LetterInput, requestId?: string) {
  const p = await prepare(tx, actor, kind, input);
  const { employee, template, inputs, today } = p;
  const earlier = await tx.get(offersCol(input.orgId).where('employeeId', '==', input.employeeId));
  const sameKind = earlier.docs.filter((d) => kindOf(d) === kind && (kind !== 'CUSTOM' || d.get('templateId') === template.id));
  const number = `${PREFIX[kind]}/${employee.get('code')}/${today.slice(0, 4)}/${sameKind.length + 1}`;
  const content = render(p, number);
  const pdf = Buffer.from(await letterPdf(content, { orgName: p.ctx.orgName, branchLines: p.ctx.branchLines, preview: false }));
  const docType = kind === 'CUSTOM' ? { id: `letter-${template.id}`, name: template.name } : DOCUMENT_TYPES[kind];

  // One letter and one file per request (a retried request overwrites the same file).
  const letterRef = offersCol(input.orgId).doc(requestId ?? offersCol(input.orgId).doc().id);
  const docRef = db.collection(`orgs/${input.orgId}/employees/${input.employeeId}/documents`).doc(letterRef.id);
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
  const replaced = sameKind.filter((d) => d.get('status') === 'RELEASED');
  for (const old of replaced) {
    tx.update(old.ref, { status: 'SUPERSEDED', supersededBy: letterRef.id, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`orgs/${input.orgId}/employees/${input.employeeId}/documents/${old.get('documentId')}`), { status: 'SUPERSEDED', supersededBy: docRef.id, updatedAt: FieldValue.serverTimestamp() });
  }
  tx.set(docRef, {
    ...copies,
    typeId: docType.id,
    typeName: docType.name,
    category: 'CONTRACT',
    fileName: `${docType.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${employee.get('code')}-${sameKind.length + 1}.pdf`,
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
    offerId: letterRef.id,
    uploadedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.set(letterRef, {
    ...copies,
    kind,
    templateId: template.id,
    templateName: template.name,
    number,
    issuedOn: today,
    subject: content.subject,
    designation: inputs.designation || null,
    department: inputs.department || null,
    employmentType: inputs.employmentType ?? null,
    joiningDate: inputs.joiningDate || null,
    annualCtc: inputs.annualCtc ?? null,
    probationMonths: inputs.probationMonths ?? null,
    noticeDays: inputs.noticeDays ?? null,
    acceptBy: inputs.acceptBy || null,
    reportingTo: inputs.reportingTo || null,
    terms: inputs.terms ?? '',
    workLocation: p.ctx.workLocation,
    signatoryName: p.ctx.signatoryName,
    signatoryTitle: p.ctx.signatoryTitle,
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
    {
      orgId: input.orgId,
      kind: kind === 'OFFER' ? 'offer.released' : 'letter.issued',
      title: `Your ${template.name.toLowerCase()} is ready`,
      body: kind === 'OFFER' ? `${inputs.designation}, joining on ${inputs.joiningDate}. Find it under My documents.` : 'Find it under My documents.',
      link: LINKS.me,
    },
    actor.uid,
  );
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: kind === 'OFFER' ? 'employee.offer.release' : 'employee.letter.issue',
    entityType: 'employee',
    entityId: input.employeeId,
    branchId: copies.branchId,
    after: { offerId: letterRef.id, kind, template: template.name, templateId: template.id, number, designation: inputs.designation, joiningDate: inputs.joiningDate, annualCtc: inputs.annualCtc ?? null, replaced: replaced.map((d) => d.id) },
  });
  return { offerId: letterRef.id, documentId: docRef.id, number };
}

/** An offer letter as it would be released, marked PREVIEW. Nothing is stored. */
export const preview = query('offers-preview', offerTerms, ({ actor, input }) => previewPdf(actor, 'OFFER', input));

/** Releases an offer letter, worded by the offer template in force at the employee's branch. */
export const release = command('offers-release', offerTerms, ({ actor, input, requestId }, tx) => issue(tx, actor, 'OFFER', input, requestId));

/** Another letter (appointment or custom) as it would be issued, marked PREVIEW. */
export const previewLetter = query('letters-preview', letterInput, ({ actor, input }) => previewPdf(actor, input.kind, input));

/** Issues an appointment letter or a custom letter. */
export const issueLetter = command('letters-issue', letterInput, ({ actor, input, requestId }, tx) => issue(tx, actor, input.kind, input, requestId));

/** Withdraws a released letter: it leaves the employee's documents (kept for the record). */
export const withdraw = command('offers-withdraw', z.strictObject({ orgId: id, offerId: id, reason }), async ({ actor, input, requestId }, tx) => {
  const ref = offersCol(input.orgId).doc(input.offerId);
  const letter = await tx.get(ref);
  if (!letter.exists) throw errors.notFound('Letter');
  const employee = await loadEmployee(tx, input.orgId, letter.get('employeeId'));
  const kind = kindOf(letter);
  await requireIssuer(actor, input.orgId, employee, kind, tx);
  if (letter.get('status') !== 'RELEASED') throw errors.conflict('NOT_RELEASED', 'Only a released letter can be withdrawn.');
  const name = (letter.get('templateName') as string | undefined) ?? 'Offer letter';
  tx.update(ref, { status: 'WITHDRAWN', withdrawnBy: actor.uid, withdrawnReason: input.reason, withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  tx.update(db.doc(`orgs/${input.orgId}/employees/${employee.id}/documents/${letter.get('documentId')}`), {
    status: 'REMOVED',
    removedBy: actor.uid,
    removedReason: `${name} withdrawn: ${input.reason}`,
    updatedAt: FieldValue.serverTimestamp(),
  });
  notify(tx, employee.get('uid'), { orgId: input.orgId, kind: kind === 'OFFER' ? 'offer.withdrawn' : 'letter.withdrawn', title: `Your ${name.toLowerCase()} was withdrawn`, body: input.reason, link: LINKS.me }, actor.uid);
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: kind === 'OFFER' ? 'employee.offer.withdraw' : 'employee.letter.withdraw',
    entityType: 'employee',
    entityId: employee.id,
    branchId: employee.get('branchId') ?? null,
    before: { offerId: ref.id, status: 'RELEASED' },
    after: { status: 'WITHDRAWN' },
    reason: input.reason,
  });
  return { offerId: ref.id };
});

/** A released letter (base64 PDF) for those who may issue that kind at the branch, or the employee. Audited. */
export const open = query('offers-open', z.strictObject({ orgId: id, offerId: id }), async ({ actor, input }) => {
  const letter = await offersCol(input.orgId).doc(input.offerId).get();
  if (!letter.exists) throw errors.notFound('Letter');
  const own = !!letter.get('employeeUid') && letter.get('employeeUid') === actor.uid;
  const staff = await db.runTransaction((tx) => canFor(actor, permissionFor(kindOf(letter)), input.orgId, letter.get('branchId') ?? null, tx));
  if (!own && !staff) throw errors.notFound('Letter');
  const file = await db.doc(`orgs/${input.orgId}/employees/${letter.get('employeeId')}/documents/${letter.get('documentId')}`).get();
  const stored = file.get('storageBucket') as string | undefined;
  const [bytes] = await (stored ? getStorage().bucket(stored) : bucket()).file(file.get('storagePath')).download();
  await recordAuditNow(auditCtx(actor), input.orgId, {
    action: kindOf(letter) === 'OFFER' ? 'employee.offer.open' : 'employee.letter.open',
    entityType: 'employee',
    entityId: letter.get('employeeId'),
    branchId: letter.get('branchId') ?? null,
    after: { offerId: letter.id, number: letter.get('number') },
  });
  return { fileName: file.get('fileName') as string, contentType: 'application/pdf', content: bytes.toString('base64') };
});
