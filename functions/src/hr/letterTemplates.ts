import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, name, reason } from '../core/schemas.js';
import { dateKeyIST } from '../core/time.js';
import { letterPdf, longDate } from './letterPdf.js';
import { inWords, rupees } from './payrollRules.js';

/**
 * Letter templates (docs/HRMS.md §13): the wording of offer, appointment and
 * custom letters (experience, relieving, …). A template applies to every
 * branch (branchId null) or to one branch, and is a DRAFT until published;
 * only published templates are used. For offer and appointment letters a
 * branch's published template overrides the organization's, which overrides
 * the built-in wording. Templates hold plain text with {{placeholders}}.
 */

export const LETTER_KINDS = ['OFFER', 'APPOINTMENT', 'CUSTOM'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

/** Placeholders a template may use, and the letter value each needs (if it must be entered). */
export const PLACEHOLDERS: Record<string, string> = {
  name: "employee's full name",
  firstName: "employee's first name",
  employeeId: 'employee ID',
  designation: 'position (job title)',
  department: 'department',
  employmentType: 'full-time, part-time, contract or internship',
  workLocation: 'branch and city (or Head office)',
  joiningDate: 'date of joining',
  exitDate: 'last working day (from the employee record)',
  ctc: 'annual cost to company, e.g. Rs. 2,64,000',
  ctcWords: 'annual cost to company in words',
  probationMonths: 'probation in months',
  noticeDays: 'notice period in days',
  acceptBy: 'date to accept by',
  reportingTo: 'reporting manager',
  terms: 'other terms typed when issuing',
  date: 'date of the letter',
  org: 'organization name',
  signatory: 'name of the person issuing the letter',
  signatoryTitle: 'job title of the person issuing the letter',
};

const TOKEN = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** Placeholders a text uses. */
export const usedPlaceholders = (text: string) => [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))];

/** Placeholder names in `text` that don't exist. */
export const unknownPlaceholders = (text: string) => usedPlaceholders(text).filter((p) => !(p in PLACEHOLDERS));

export function fill(text: string, values: Record<string, string>) {
  return text.replace(TOKEN, (_, key: string) => values[key] ?? '');
}

/**
 * Fills a letter body. A facts row (`* Label: …`) with an empty placeholder is
 * left out, and so is a line made only of placeholders that are all empty
 * (e.g. `{{terms}}` when there are no other terms).
 */
export function fillBody(body: string, values: Record<string, string>) {
  return body
    .split('\n')
    .filter((line) => {
      const used = usedPlaceholders(line);
      if (!used.length) return true;
      if (line.trim().startsWith('* ')) return used.every((p) => values[p]);
      return line.replace(TOKEN, '').trim() !== '' || used.some((p) => values[p]);
    })
    .map((line) => fill(line, values))
    .join('\n');
}

export interface LetterTemplate {
  id: string | null;
  name: string;
  kind: LetterKind;
  branchId: string | null;
  subject: string;
  body: string;
  /** Adds an acceptance block for the employee to sign. */
  acceptance: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

/** The wording used until an organization publishes its own. */
export const BUILT_IN: Record<'OFFER' | 'APPOINTMENT', Omit<LetterTemplate, 'id' | 'branchId' | 'status'>> = {
  OFFER: {
    name: 'Offer letter',
    kind: 'OFFER',
    subject: 'Offer of employment',
    acceptance: true,
    body: [
      'Dear {{firstName}},',
      '',
      'We are pleased to offer you the position of {{designation}} at {{org}}, on a {{employmentType}} basis. The terms of this offer are set out below.',
      '',
      '* Position: {{designation}}',
      '* Department: {{department}}',
      '* Place of work: {{workLocation}}',
      '* Date of joining: {{joiningDate}}',
      '* Reporting to: {{reportingTo}}',
      '* Annual cost to company: {{ctc}} (Rupees {{ctcWords}} only)',
      '* Probation: {{probationMonths}} months',
      '* Notice period: {{noticeDays}} days',
      '',
      'Your salary will be paid monthly, after deductions required by law (provident fund, ESI, professional tax and income tax, where they apply). The break-up of your salary will be shared with you on joining.',
      '',
      "You will be on probation for the first {{probationMonths}} months. On confirmation, either side may end the employment by giving {{noticeDays}} days' notice.",
      '',
      'This offer depends on the documents you share with us being genuine, and on your joining on the date above.',
      '',
      '{{terms}}',
      '',
      'Please accept this offer by signing a copy of this letter and returning it to us by {{acceptBy}}. After that date the offer lapses.',
      '',
      'We look forward to welcoming you to the team.',
    ].join('\n'),
  },
  APPOINTMENT: {
    name: 'Appointment letter',
    kind: 'APPOINTMENT',
    subject: 'Letter of appointment',
    acceptance: true,
    body: [
      'Dear {{firstName}},',
      '',
      'Further to your acceptance of our offer, we are pleased to appoint you as {{designation}} at {{org}} with effect from {{joiningDate}}, on the terms below.',
      '',
      '* Employee ID: {{employeeId}}',
      '* Position: {{designation}}',
      '* Department: {{department}}',
      '* Place of work: {{workLocation}}',
      '* Reporting to: {{reportingTo}}',
      '* Annual cost to company: {{ctc}}',
      '* Probation: {{probationMonths}} months',
      '* Notice period: {{noticeDays}} days',
      '',
      '# Terms of employment',
      '- You will follow the policies and working hours of the organization, as updated from time to time.',
      '- You will keep information about the organization, its members and its staff confidential, during and after your employment.',
      "- After confirmation, either side may end the employment with {{noticeDays}} days' notice, or salary in place of notice.",
      '',
      '{{terms}}',
      '',
      'Please sign a copy of this letter to confirm that you accept these terms. We wish you a long and rewarding association with us.',
    ].join('\n'),
  },
};

// ---------------------------------------------------------------- values

export interface LetterInputs {
  designation?: string;
  department?: string;
  employmentType?: string;
  joiningDate?: string | null;
  annualCtc?: number | null;
  probationMonths?: number | null;
  noticeDays?: number | null;
  acceptBy?: string | null;
  reportingTo?: string;
  terms?: string;
}

const EMPLOYMENT: Record<string, string> = { FULL_TIME: 'full-time', PART_TIME: 'part-time', CONTRACT: 'contract', INTERN: 'internship' };

/** Values for every placeholder ('' where nothing is known). */
export function placeholderValues(
  inputs: LetterInputs,
  person: { fullName: string; code: string; exitDate?: string | null },
  ctx: { orgName: string; workLocation: string; signatoryName: string; signatoryTitle: string },
  issuedOn: string,
): Record<string, string> {
  const d = (v?: string | null) => (v ? longDate(v) : '');
  const n = (v?: number | null) => (v === null || v === undefined ? '' : String(v));
  return {
    name: person.fullName,
    firstName: person.fullName.split(/\s+/)[0],
    employeeId: person.code,
    designation: inputs.designation ?? '',
    department: inputs.department ?? '',
    employmentType: EMPLOYMENT[inputs.employmentType ?? ''] ?? '',
    workLocation: ctx.workLocation,
    joiningDate: d(inputs.joiningDate),
    exitDate: d(person.exitDate),
    ctc: inputs.annualCtc ? rupees(inputs.annualCtc) : '',
    ctcWords: inputs.annualCtc ? inWords(inputs.annualCtc) : '',
    probationMonths: n(inputs.probationMonths),
    noticeDays: n(inputs.noticeDays),
    acceptBy: d(inputs.acceptBy),
    reportingTo: inputs.reportingTo ?? '',
    terms: inputs.terms ?? '',
    date: longDate(issuedOn),
    org: ctx.orgName,
    signatory: ctx.signatoryName,
    signatoryTitle: ctx.signatoryTitle,
  };
}

/** Placeholders that must be entered when issuing, with what to ask for. */
const NEEDS_INPUT: Record<string, string> = {
  designation: 'the position',
  joiningDate: 'the date of joining',
  ctc: 'the annual cost to company',
  ctcWords: 'the annual cost to company',
  acceptBy: 'the date to accept by',
  exitDate: "the employee's last working day (set it on their record)",
};

/** Refuses a letter whose template uses a value that is missing (facts rows are optional: they are left out). */
export function requireValues(template: Pick<LetterTemplate, 'subject' | 'body'>, values: Record<string, string>) {
  const text = [template.subject, ...template.body.split('\n').filter((l) => !l.trim().startsWith('* '))].join('\n');
  for (const p of usedPlaceholders(text)) {
    if (NEEDS_INPUT[p] && !values[p]) throw errors.invalid(`This letter needs ${NEEDS_INPUT[p]}.`);
  }
}

// ---------------------------------------------------------------- storage

export const templatesCol = (orgId: string) => db.collection(`orgs/${orgId}/letterTemplates`);

/**
 * The template to use for an employee at `branchId`: a named published
 * template (custom letters, which must apply to the branch), or for offer and
 * appointment letters the branch's, else the organization's, else built-in.
 */
export async function resolveTemplate(tx: Transaction, orgId: string, kind: LetterKind, branchId: string | null, templateId?: string): Promise<LetterTemplate> {
  if (templateId) {
    const snap = await tx.get(templatesCol(orgId).doc(templateId));
    if (!snap.exists || snap.get('status') !== 'PUBLISHED') throw errors.notFound('Published letter template');
    const t = { id: snap.id, ...(snap.data() as Omit<LetterTemplate, 'id'>) };
    if (t.kind !== kind) throw errors.invalid(`This template is for ${t.kind.toLowerCase()} letters.`);
    if (t.branchId && t.branchId !== branchId) throw errors.invalid("This template is for another branch's staff.");
    return t;
  }
  if (kind === 'CUSTOM') throw errors.invalid('Choose a letter template.');
  const published = await tx.get(templatesCol(orgId).where('kind', '==', kind).where('status', '==', 'PUBLISHED'));
  const pick = published.docs.find((d) => branchId && d.get('branchId') === branchId) ?? published.docs.find((d) => !d.get('branchId'));
  if (pick) return { id: pick.id, ...(pick.data() as Omit<LetterTemplate, 'id'>) };
  return { id: null, branchId: null, status: 'PUBLISHED', ...BUILT_IN[kind] };
}

// ---------------------------------------------------------------- commands

const templateFields = {
  name,
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(8000),
  acceptance: z.boolean().default(false),
};

function checkText(subject: string, body: string) {
  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  if (unknown.length) throw errors.invalid(`Unknown placeholder ${unknown.map((u) => `{{${u}}}`).join(', ')}. See the list under the editor.`);
}

const auditCtx = (actor: { uid: string; email: string | null }, requestId?: string) => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });

/** Creates a template (as a draft), or changes one. Kind and branch can only change while it is a draft. */
export const save = command(
  'letterTemplates-save',
  z.strictObject({ orgId: id, templateId: id.optional(), kind: z.enum(LETTER_KINDS), branchId: id.nullable().default(null), ...templateFields }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    checkText(input.subject, input.body);
    const ref = input.templateId ? templatesCol(input.orgId).doc(input.templateId) : templatesCol(input.orgId).doc();
    const before = input.templateId ? await tx.get(ref) : null;
    if (input.templateId && !before?.exists) throw errors.notFound('Letter template');
    if (input.branchId) {
      const branch = await tx.get(db.doc(`orgs/${input.orgId}/branches/${input.branchId}`));
      if (!branch.exists) throw errors.notFound('Branch');
    }
    if (before?.exists && before.get('status') !== 'DRAFT' && (before.get('kind') !== input.kind || (before.get('branchId') ?? null) !== input.branchId)) {
      throw errors.conflict('TEMPLATE_PUBLISHED', 'The letter type and branch of a published template are fixed. Make a new template instead.');
    }
    if (before?.get('status') === 'ARCHIVED') throw errors.conflict('TEMPLATE_ARCHIVED', 'Archived templates cannot be changed.');
    const fields = { kind: input.kind, branchId: input.branchId, name: input.name, subject: input.subject, body: input.body, acceptance: input.acceptance };
    tx.set(ref, {
      ...fields,
      status: before?.get('status') ?? 'DRAFT',
      updatedBy: actor.uid,
      updatedByEmail: actor.email,
      updatedAt: FieldValue.serverTimestamp(),
      ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), publishedAt: null }),
    }, { merge: true });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: before ? 'letterTemplate.update' : 'letterTemplate.create',
      entityType: 'letterTemplate',
      entityId: ref.id,
      branchId: input.branchId,
      before: before?.exists ? { name: before.get('name'), subject: before.get('subject'), status: before.get('status') } : null,
      after: { name: input.name, kind: input.kind, subject: input.subject },
    });
    return { templateId: ref.id };
  },
);

/**
 * Publishes a draft. An offer or appointment template replaces the one
 * published for the same branch (or the whole organization), which is archived.
 */
export const publish = command('letterTemplates-publish', z.strictObject({ orgId: id, templateId: id }), async ({ actor, input, requestId }, tx) => {
  await actor.require('hr.config', input.orgId, undefined, tx);
  const ref = templatesCol(input.orgId).doc(input.templateId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw errors.notFound('Letter template');
  if (snap.get('status') !== 'DRAFT') throw errors.conflict('NOT_DRAFT', 'Only a draft can be published.');
  const kind = snap.get('kind') as LetterKind;
  const branchId = (snap.get('branchId') as string | null) ?? null;
  const current = kind === 'CUSTOM' ? null : await tx.get(templatesCol(input.orgId).where('kind', '==', kind).where('status', '==', 'PUBLISHED'));
  const replaced = (current?.docs ?? []).filter((d) => (d.get('branchId') ?? null) === branchId);
  for (const d of replaced) tx.update(d.ref, { status: 'ARCHIVED', replacedBy: ref.id, updatedAt: FieldValue.serverTimestamp() });
  tx.update(ref, { status: 'PUBLISHED', publishedAt: FieldValue.serverTimestamp(), publishedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'letterTemplate.publish',
    entityType: 'letterTemplate',
    entityId: ref.id,
    branchId,
    after: { name: snap.get('name'), kind, replaced: replaced.map((d) => d.id) },
  });
  return { templateId: ref.id, replaced: replaced.map((d) => d.id) };
});

/** Stops using a template (letters already issued keep their wording). */
export const archive = command('letterTemplates-archive', z.strictObject({ orgId: id, templateId: id, reason }), async ({ actor, input, requestId }, tx) => {
  await actor.require('hr.config', input.orgId, undefined, tx);
  const ref = templatesCol(input.orgId).doc(input.templateId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw errors.notFound('Letter template');
  if (snap.get('status') === 'ARCHIVED') throw errors.conflict('ARCHIVED', 'This template is already archived.');
  tx.update(ref, { status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'letterTemplate.archive',
    entityType: 'letterTemplate',
    entityId: ref.id,
    branchId: snap.get('branchId') ?? null,
    before: { status: snap.get('status') },
    after: { status: 'ARCHIVED' },
    reason: input.reason,
  });
  return { templateId: ref.id };
});

/** The built-in wording and the placeholder list, for the template editor and the issue form (any member of the org). */
export const defaults = query('letterTemplates-defaults', z.strictObject({ orgId: id }), async ({ actor, input }) => {
  if (!actor.isSuperAdmin && !(await actor.membership(input.orgId))) throw errors.forbidden();
  return { builtIn: BUILT_IN, placeholders: PLACEHOLDERS };
});

/** A template (saved or being edited) as a PDF with sample values, marked PREVIEW. */
export const preview = query(
  'letterTemplates-preview',
  z.strictObject({ orgId: id, branchId: id.nullable().default(null), ...templateFields }),
  async ({ actor, input }) => {
    const { org, branch } = await db.runTransaction(async (tx) => {
      await actor.require('hr.config', input.orgId, undefined, tx);
      return {
        org: await tx.get(db.doc(`orgs/${input.orgId}`)),
        branch: input.branchId ? await tx.get(db.doc(`orgs/${input.orgId}/branches/${input.branchId}`)) : null,
      };
    });
    checkText(input.subject, input.body);
    const today = dateKeyIST(new Date());
    const inAMonth = dateKeyIST(new Date(Date.now() + 30 * 86_400_000));
    const orgName = (org.get('name') as string | undefined) ?? 'Stories';
    const branchName = (branch?.get('name') as string | undefined) ?? 'Head office';
    const values = placeholderValues(
      { designation: 'Library Assistant', department: 'Operations', employmentType: 'FULL_TIME', joiningDate: inAMonth, annualCtc: 264000, probationMonths: 6, noticeDays: 30, acceptBy: dateKeyIST(new Date(Date.now() + 7 * 86_400_000)), reportingTo: 'Priya Shah', terms: 'You will work alternate Saturdays.' },
      { fullName: 'Asha Verma', code: 'CEN-E0042', exitDate: dateKeyIST(new Date(Date.now() + 730 * 86_400_000)) },
      { orgName, workLocation: branchName, signatoryName: 'Hema Rao', signatoryTitle: 'HR Manager' },
      today,
    );
    const pdf = await letterPdf(
      { number: 'SAMPLE/PREVIEW', issuedOn: today, recipientName: 'Asha Verma', recipientCode: 'CEN-E0042', subject: fill(input.subject, values), body: fillBody(input.body, values), acceptance: input.acceptance, signatoryName: 'Hema Rao', signatoryTitle: 'HR Manager' },
      { orgName, branchLines: [branchName], preview: true },
    );
    return { fileName: 'letter-template-preview.pdf', contentType: 'application/pdf', content: Buffer.from(pdf).toString('base64') };
  },
);
