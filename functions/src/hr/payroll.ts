import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit, recordAuditNow } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { LINKS, notify } from '../core/notify.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import { lockId } from './attendance.js';
import { datesOfMonth } from './attendanceRules.js';
import { canFor, loadEmployee, requireFor } from './model.js';
import { computePay, DEFAULT_SETTINGS, inForce, type MonthInputs, monthlyGross, NO_INPUTS, type SalaryStructure, type StatutorySettings } from './payrollRules.js';
import { payslipPdf } from './payslipPdf.js';

/**
 * Payroll (docs/HRMS.md §10). Salary structures and statutory settings are
 * effective-dated versions; TDS and one-off earnings or deductions are entered
 * per employee per month. A run covers one branch (or head office staff) for
 * a month whose attendance is finalized: one person prepares and submits it,
 * someone else approves it, and approval publishes the payslips.
 */

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month (YYYY-MM)');
const rupees = z.number().int('must be whole rupees').min(0).max(10_000_000);
const adjustment = z.strictObject({ name: z.string().trim().min(2).max(60), amount: rupees.min(1) });
const note = z.string().trim().max(500).default('');
/** 'September 2026'. */
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const auditCtx = (actor: Actor, requestId?: string) => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });
const salaryRef = (orgId: string, employeeId: string, from: string) => db.doc(`orgs/${orgId}/salaries/${employeeId}_${from}`);
const settingsRef = (orgId: string, from: string) => db.doc(`orgs/${orgId}/payrollSettings/${from}`);
const inputsRef = (orgId: string, employeeId: string, m: string) => db.doc(`orgs/${orgId}/payrollInputs/${employeeId}_${m}`);
export const runRef = (orgId: string, m: string, branchId: string | null) => db.doc(`orgs/${orgId}/payrollRuns/${lockId(m, branchId)}`);
const payslipRef = (orgId: string, employeeId: string, m: string) => db.doc(`orgs/${orgId}/payslips/${employeeId}_${m}`);

/** Runs past these states are fixed: nothing that feeds them may change. */
const LOCKED = ['SUBMITTED', 'APPROVED'];
/** Approval publishes every payslip in one transaction. */
const MAX_RUN = 450;

function notOwn(actor: Actor, employee: DocumentSnapshot, what: string) {
  if (employee.get('uid') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden(`You can't change your own ${what}.`);
}

// ---------------------------------------------------------------- settings

const settingsSchema = z.strictObject({
  orgId: id,
  effectiveFrom: month,
  pf: z.strictObject({
    enabled: z.boolean(),
    employeeRate: z.number().min(0).max(25),
    employerRate: z.number().min(0).max(25),
    epsRate: z.number().min(0).max(25),
    wageCeiling: rupees,
    capAtCeiling: z.boolean(),
  }),
  esi: z.strictObject({ enabled: z.boolean(), employeeRate: z.number().min(0).max(10), employerRate: z.number().min(0).max(10), grossLimit: rupees }),
  pt: z.strictObject({
    enabled: z.boolean(),
    slabs: z
      .array(z.strictObject({ from: rupees, amount: rupees.max(2500) }))
      .min(1)
      .max(12)
      .refine((s) => new Set(s.map((x) => x.from)).size === s.length, 'has two slabs starting at the same amount'),
    februaryAmount: rupees.max(2500).nullable(),
  }),
});

/** A new version of PF, ESI and PT settings from a month on (org-wide). */
export const saveSettings = command('payrollSettings-save', settingsSchema, async ({ actor, input, requestId }, tx) => {
  await requireFor(actor, 'salary.edit', input.orgId, null, tx);
  const { orgId, ...settings } = input;
  if (settings.pf.epsRate > settings.pf.employerRate) throw errors.invalid('The pension share cannot be more than the employer PF rate.');
  const ref = settingsRef(orgId, settings.effectiveFrom);
  const before = await tx.get(ref);
  tx.set(ref, { ...settings, pt: { ...settings.pt, slabs: [...settings.pt.slabs].sort((a, b) => a.from - b.from) }, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  recordAudit(tx, auditCtx(actor, requestId), orgId, {
    action: 'payroll.settings',
    entityType: 'payrollSettings',
    entityId: settings.effectiveFrom,
    before: before.exists ? before.data() : null,
    after: settings,
  });
  return { effectiveFrom: settings.effectiveFrom };
});

async function settingsVersions(orgId: string): Promise<StatutorySettings[]> {
  const snap = await db.collection(`orgs/${orgId}/payrollSettings`).get();
  return snap.docs.map((d) => d.data() as StatutorySettings);
}

// ---------------------------------------------------------------- salaries

/** A salary structure from a month on; a later version replaces it from its own month. Never your own. */
export const saveSalary = command(
  'salary-save',
  z.strictObject({
    orgId: id,
    employeeId: id,
    effectiveFrom: month,
    earnings: z
      .array(z.strictObject({ code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,15}$/, 'must be a short code like HRA'), name: z.string().trim().min(2).max(60), amount: rupees }))
      .min(1)
      .max(12)
      .refine((e) => e.some((c) => c.code === 'BASIC'), 'needs a BASIC component')
      .refine((e) => new Set(e.map((c) => c.code)).size === e.length, 'has a component twice'),
    pf: z.boolean(),
    esi: z.boolean(),
    pt: z.boolean(),
    reason,
  }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'salary.edit', input.orgId, employee.get('branchId') ?? null, tx);
    notOwn(actor, employee, 'salary');
    const ref = salaryRef(input.orgId, employee.id, input.effectiveFrom);
    const before = await tx.get(ref);
    const gross = monthlyGross(input);
    tx.set(ref, {
      orgId: input.orgId,
      employeeId: employee.id,
      employeeName: employee.get('fullName'),
      employeeUid: employee.get('uid') ?? null,
      branchId: employee.get('branchId') ?? null,
      effectiveFrom: input.effectiveFrom,
      earnings: input.earnings,
      pf: input.pf,
      esi: input.esi,
      pt: input.pt,
      monthlyGross: gross,
      reason: input.reason,
      updatedBy: actor.uid,
      updatedByEmail: actor.email,
      updatedAt: FieldValue.serverTimestamp(),
    });
    // The audit log keeps the gross, not the breakup.
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'salary.save',
      entityType: 'employee',
      entityId: employee.id,
      branchId: employee.get('branchId') ?? null,
      before: before.exists ? { effectiveFrom: input.effectiveFrom, monthlyGross: before.get('monthlyGross') } : null,
      after: { effectiveFrom: input.effectiveFrom, monthlyGross: gross },
      reason: input.reason,
    });
    return { effectiveFrom: input.effectiveFrom, monthlyGross: gross };
  },
);

// ---------------------------------------------------------------- monthly inputs

async function openRun(tx: Transaction, orgId: string, m: string, branchId: string | null) {
  const run = await tx.get(runRef(orgId, m, branchId));
  if (run.exists && LOCKED.includes(run.get('status'))) throw errors.conflict('RUN_LOCKED', `Payroll for ${m} is ${run.get('status') === 'APPROVED' ? 'approved' : 'waiting for approval'}. It can no longer change.`);
  return run;
}

/** TDS and one-off earnings or deductions for an employee's month. A prepared run must be prepared again. */
export const setInputs = command(
  'payroll-setInputs',
  z.strictObject({ orgId: id, employeeId: id, month, tds: rupees, otherEarnings: z.array(adjustment).max(10).default([]), otherDeductions: z.array(adjustment).max(10).default([]) }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    const branchId = (employee.get('branchId') as string | null) ?? null;
    await requireFor(actor, 'payroll.run', input.orgId, branchId, tx);
    notOwn(actor, employee, 'payroll inputs');
    const run = await openRun(tx, input.orgId, input.month, branchId);
    const inputs: MonthInputs = { tds: input.tds, otherEarnings: input.otherEarnings, otherDeductions: input.otherDeductions };
    tx.set(inputsRef(input.orgId, employee.id, input.month), {
      orgId: input.orgId,
      employeeId: employee.id,
      employeeUid: employee.get('uid') ?? null,
      branchId,
      month: input.month,
      ...inputs,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (run.exists) tx.update(run.ref, { stale: true });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'payroll.inputs',
      entityType: 'employee',
      entityId: employee.id,
      branchId,
      after: { month: input.month, tds: input.tds, otherEarnings: input.otherEarnings.length, otherDeductions: input.otherDeductions.length },
    });
    return { month: input.month };
  },
);

// ---------------------------------------------------------------- runs

interface Problem {
  employeeId: string;
  employeeName: string;
  message: string;
}

/**
 * Works out a branch's month (`branchId: null` = head office staff) from the
 * finalized attendance summaries: one payslip per employee, published only
 * when the run is approved. Safe to repeat while the run is a draft.
 */
export const prepare = query('payroll-prepare', z.strictObject({ orgId: id, month, branchId: id.nullable() }), async ({ actor, input }) => {
  const { orgId, branchId } = input;
  const m = input.month;
  await db.runTransaction(async (tx) => requireFor(actor, 'payroll.run', orgId, branchId, tx));
  const [lock, run, org] = await Promise.all([db.doc(`orgs/${orgId}/attendanceLocks/${lockId(m, branchId)}`).get(), runRef(orgId, m, branchId).get(), db.doc(`orgs/${orgId}`).get()]);
  if (!lock.exists || lock.get('status') !== 'FINALIZED') throw errors.conflict('ATTENDANCE_NOT_FINALIZED', `Finalize attendance for ${m} first; payroll is worked out from payable days.`);
  if (run.exists && LOCKED.includes(run.get('status'))) throw errors.conflict('RUN_LOCKED', `Payroll for ${m} is ${run.get('status') === 'APPROVED' ? 'approved' : 'waiting for approval'}.`);

  const [summaries, versions, inputs, existing] = await Promise.all([
    db.collection(`orgs/${orgId}/attendanceSummaries`).where('month', '==', m).where('branchId', '==', branchId).get(),
    settingsVersions(orgId),
    db.collection(`orgs/${orgId}/payrollInputs`).where('month', '==', m).get(),
    db.collection(`orgs/${orgId}/payslips`).where('month', '==', m).where('branchId', '==', branchId).get(),
  ]);
  if (summaries.size > MAX_RUN) throw errors.invalid(`A run covers at most ${MAX_RUN} people.`);
  const settings = inForce(versions, m) ?? DEFAULT_SETTINGS;
  const inputsOf = new Map(inputs.docs.map((d) => [d.get('employeeId') as string, d.data() as MonthInputs]));
  const daysInMonth = datesOfMonth(m).length;
  const runId = lockId(m, branchId);

  const lines = await Promise.all(
    summaries.docs.map(async (s) => {
      const employeeId = s.get('employeeId') as string;
      const [employee, profile, salaries] = await Promise.all([
        db.doc(`orgs/${orgId}/employees/${employeeId}`).get(),
        db.doc(`orgs/${orgId}/employees/${employeeId}/private/profile`).get(),
        db.collection(`orgs/${orgId}/salaries`).where('employeeId', '==', employeeId).get(),
      ]);
      const structure = inForce(
        salaries.docs.map((d) => d.data() as SalaryStructure),
        m,
      );
      const base = {
        orgId,
        runId,
        month: m,
        branchId,
        employeeId,
        employeeName: s.get('employeeName'),
        employeeCode: s.get('employeeCode'),
        employeeUid: employee.get('uid') ?? s.get('employeeUid') ?? null,
        designation: employee.get('designationName') ?? null,
        department: employee.get('departmentName') ?? null,
        joiningDate: employee.get('joiningDate') ?? null,
        pan: profile.get('pan') || null,
        uan: profile.get('uan') || null,
        bank: profile.get('bank') ? { bankName: profile.get('bank.bankName') ?? null, last4: profile.get('bank.last4') ?? null } : null,
        days: { inMonth: daysInMonth, payable: s.get('payableDays') ?? 0, present: s.get('present') ?? 0, leave: s.get('leaveDays') ?? 0, absent: s.get('absent') ?? 0 },
        settingsFrom: settings.effectiveFrom,
        published: false,
      };
      if (!structure) {
        return { ...base, structureFrom: null, missingSalary: true, earnings: [], otherEarnings: [], otherDeductions: [], gross: 0, deductions: 0, net: 0, employerCost: 0, problems: ['No salary structure for this month.'] };
      }
      const line = computePay({ structure, settings, month: m, payableDays: base.days.payable, daysInMonth, inputs: inputsOf.get(employeeId) ?? NO_INPUTS });
      return { ...base, structureFrom: structure.effectiveFrom, missingSalary: false, ...line };
    }),
  );

  const total = (k: string) => lines.reduce((n, l) => n + (((l as unknown as Record<string, number>)[k] as number | undefined) ?? 0), 0);
  const problems: Problem[] = lines.flatMap((l) => l.problems.map((message) => ({ employeeId: l.employeeId, employeeName: l.employeeName as string, message })));
  const keep = new Set(lines.map((l) => l.employeeId));
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops) await batch.commit();
    batch = db.batch();
    ops = 0;
  };
  for (const old of existing.docs) {
    if (!keep.has(old.get('employeeId'))) {
      batch.delete(old.ref);
      if (++ops >= 400) await flush();
    }
  }
  for (const l of lines) {
    batch.set(payslipRef(orgId, l.employeeId, m), { ...l, preparedAt: FieldValue.serverTimestamp() });
    if (++ops >= 400) await flush();
  }
  const totals = {
    gross: total('gross'),
    deductions: total('deductions'),
    net: total('net'),
    employerCost: total('employerCost'),
    pfEmployee: total('pfEmployee'),
    pfEmployer: total('pfEmployer'),
    esiEmployee: total('esiEmployee'),
    esiEmployer: total('esiEmployer'),
    pt: total('pt'),
    tds: total('tds'),
  };
  batch.set(runRef(orgId, m, branchId), {
    orgId,
    orgName: org.get('name') ?? null,
    month: m,
    branchId,
    status: 'DRAFT',
    stale: false,
    employees: lines.length,
    totals,
    problems: problems.slice(0, 50),
    problemCount: problems.length,
    settingsFrom: settings.effectiveFrom,
    preparedBy: actor.uid,
    preparedByEmail: actor.email,
    preparedAt: FieldValue.serverTimestamp(),
    submittedBy: null,
    submittedByEmail: null,
    approvedBy: null,
    approvedByEmail: null,
    rejectNote: null,
  });
  ops++;
  await flush();
  await recordAuditNow(auditCtx(actor), orgId, {
    action: 'payroll.prepare',
    entityType: 'payrollRun',
    entityId: runId,
    branchId,
    after: { month: m, employees: lines.length, net: totals.net, problems: problems.length },
  });
  return { runId, employees: lines.length, problems: problems.length };
});

const loadRun = async (tx: Transaction, orgId: string, m: string, branchId: string | null) => {
  const run = await tx.get(runRef(orgId, m, branchId));
  if (!run.exists) throw errors.notFound('Payroll run');
  return run;
};

/** The preparer sends a clean, up-to-date draft for approval. */
export const submit = command('payroll-submit', z.strictObject({ orgId: id, month, branchId: id.nullable() }), async ({ actor, input, requestId }, tx) => {
  await requireFor(actor, 'payroll.run', input.orgId, input.branchId, tx);
  const run = await loadRun(tx, input.orgId, input.month, input.branchId);
  if (run.get('status') !== 'DRAFT') throw errors.conflict('NOT_DRAFT', 'Only a draft run can be submitted.');
  if (run.get('stale')) throw errors.conflict('RUN_STALE', 'Something changed since this run was prepared. Prepare it again first.');
  if (run.get('problemCount')) throw errors.conflict('RUN_PROBLEMS', `Fix the ${run.get('problemCount')} problem${run.get('problemCount') === 1 ? '' : 's'} listed and prepare the run again.`);
  tx.update(run.ref, { status: 'SUBMITTED', submittedBy: actor.uid, submittedByEmail: actor.email, submittedAt: FieldValue.serverTimestamp(), rejectNote: null });
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'payroll.submit',
    entityType: 'payrollRun',
    entityId: run.id,
    branchId: input.branchId,
    after: { month: input.month, net: run.get('totals.net') },
  });
  return { runId: run.id };
});

/**
 * An approver who neither prepared nor submitted the run approves it, which
 * publishes the payslips, or sends it back with a reason.
 */
export const decide = command(
  'payroll-decide',
  z.strictObject({ orgId: id, month, branchId: id.nullable(), decision: z.enum(['APPROVE', 'REJECT']), note }),
  async ({ actor, input, requestId }, tx) => {
    await requireFor(actor, 'payroll.approve', input.orgId, input.branchId, tx);
    const run = await loadRun(tx, input.orgId, input.month, input.branchId);
    if (run.get('status') !== 'SUBMITTED') throw errors.conflict('NOT_SUBMITTED', 'This run is not waiting for approval.');
    if ((run.get('preparedBy') === actor.uid || run.get('submittedBy') === actor.uid) && !actor.isSuperAdmin)
      throw errors.forbidden('Someone other than the person who prepared or submitted the run must approve it.');
    const approve = input.decision === 'APPROVE';
    if (!approve && input.note.length < 3) throw errors.invalid('Say what needs to change.');
    const slips = approve ? await tx.get(db.collection(`orgs/${input.orgId}/payslips`).where('runId', '==', run.id)) : null;
    const when = monthLabel(input.month);
    for (const uid of new Set([run.get('preparedBy'), run.get('submittedBy')] as string[])) {
      notify(
        tx,
        uid,
        { orgId: input.orgId, kind: approve ? 'payroll.approved' : 'payroll.rejected', title: `Payroll for ${when} ${approve ? 'approved' : 'sent back'}`, body: input.note || undefined, link: LINKS.payroll },
        actor.uid,
      );
    }
    if (approve) {
      for (const s of slips!.docs) tx.update(s.ref, { published: true, publishedAt: FieldValue.serverTimestamp() });
      tx.update(run.ref, { status: 'APPROVED', approvedBy: actor.uid, approvedByEmail: actor.email, approvedAt: FieldValue.serverTimestamp() });
    } else {
      tx.update(run.ref, { status: 'DRAFT', rejectNote: input.note, submittedBy: null, submittedByEmail: null });
    }
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: approve ? 'payroll.approve' : 'payroll.reject',
      entityType: 'payrollRun',
      entityId: run.id,
      branchId: input.branchId,
      after: { month: input.month, net: run.get('totals.net'), payslips: slips?.size ?? 0 },
      reason: input.note || null,
    });
    return { runId: run.id, status: approve ? 'APPROVED' : 'DRAFT' };
  },
  // Tells each employee their payslip is ready (after the commit: a run can hold more payslips than one transaction can also notify).
  async (result, { actor, input }) => {
    if (result.status !== 'APPROVED') return;
    const slips = await db.collection(`orgs/${input.orgId}/payslips`).where('runId', '==', result.runId).get();
    const when = monthLabel(input.month);
    for (let i = 0; i < slips.docs.length; i += 400) {
      const batch = db.batch();
      for (const s of slips.docs.slice(i, i + 400)) {
        notify(batch, s.get('employeeUid'), { orgId: input.orgId, kind: 'payslip.published', title: `Your payslip for ${when} is ready`, body: `Net pay Rs. ${Number(s.get('net')).toLocaleString('en-IN')}.`, link: LINKS.myPayslips }, actor.uid);
      }
      await batch.commit();
    }
  },
);

// ---------------------------------------------------------------- payslips

/** A payslip as a PDF: the employee's own once published, or anyone who may see all payslips at the branch (audited). */
export const downloadPayslip = query('payslips-download', z.strictObject({ orgId: id, employeeId: id, month }), async ({ actor, input }) => {
  const slip = await payslipRef(input.orgId, input.employeeId, input.month).get();
  if (!slip.exists) throw errors.notFound('Payslip');
  const own = slip.get('employeeUid') === actor.uid;
  const staff = await db.runTransaction((tx) => canFor(actor, 'payslips.viewAll', input.orgId, slip.get('branchId') ?? null, tx));
  if (!(own && slip.get('published')) && !staff) throw errors.notFound('Payslip');
  const run = await runRef(input.orgId, input.month, slip.get('branchId') ?? null).get();
  const branch = slip.get('branchId') ? await db.doc(`orgs/${input.orgId}/branches/${slip.get('branchId')}`).get() : null;
  const pdf = await payslipPdf(slip.data()!, { orgName: (run.get('orgName') as string | null) ?? '', branchName: (branch?.get('name') as string | undefined) ?? 'Head office', draft: !slip.get('published') });
  if (!own) {
    await recordAuditNow(auditCtx(actor), input.orgId, {
      action: 'payslip.open',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: slip.get('branchId') ?? null,
      after: { month: input.month },
    });
  }
  return { fileName: `payslip-${slip.get('employeeCode')}-${input.month}.pdf`, contentType: 'application/pdf', content: Buffer.from(pdf).toString('base64') };
});
