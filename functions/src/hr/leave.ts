import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';

import { recordAudit, recordAuditNow } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { LINKS, notify } from '../core/notify.js';
import { db, REGION } from '../core/firebase.js';
import { readAll } from '../core/reads.js';
import { id, name, reason } from '../core/schemas.js';
import { inChunks, JOB_OPTIONS, sweep } from '../core/sweep.js';
import { contextFrom, ensureWorking, isClosed, lockRef, ms, ownEmployee, recordFor, recordRef } from './attendance.js';
import { businessDate, datesOfMonth, type DayLeave, monthOf } from './attendanceRules.js';
import { auditCtx, date, holidayApplies, month, WORKING, weeklyOffsOf, year } from './common.js';
import { DEFAULT_LEAVE_TYPES, days2, type LeaveType, leaveDays, monthlyCredit, yearlyCredit } from './leaveRules.js';
import { canFor, employeesCol, loadEmployee, requireFor } from './model.js';

/**
 * Leave (docs/HRMS.md §9). Types are defaults overridden or added to by
 * orgs/{o}/leaveTypes. Each employee has a balance per calendar year
 * (orgs/{o}/leaveBalances/{employeeId}_{year}: credited, adjusted, used and
 * pending days per type) backed by an append-only ledger
 * (orgs/{o}/leaveLedger). Requests (orgs/{o}/leaveRequests) reserve days while
 * pending; approval uses them and marks the days on attendance, cancelling
 * gives them back. Days carried into a new year leave the old year's balance
 * (`carriedOut`), so they can be spent only once.
 */

const note = z.string().trim().max(500).default('');

const typeRef = (orgId: string, typeId: string) => db.doc(`orgs/${orgId}/leaveTypes/${typeId}`);
export const balanceRef = (orgId: string, employeeId: string, y: string) => db.doc(`orgs/${orgId}/leaveBalances/${employeeId}_${y}`);
const ledgerRef = (orgId: string, entryId: string) => db.doc(`orgs/${orgId}/leaveLedger/${entryId}`);
const requestsCol = (orgId: string) => db.collection(`orgs/${orgId}/leaveRequests`);

/** Longest request, in calendar days (a request touches each of its days on approval). */
const MAX_SPAN = 45;
const span_ = (from: string, to: string) => (from === to ? from : `${from} – ${to}`);

/** The org's leave types: defaults, overridden or added to by its own. */
export async function leaveTypes(orgId: string, tx?: Transaction): Promise<Record<string, LeaveType>> {
  const col = db.collection(`orgs/${orgId}/leaveTypes`);
  const snap = tx ? await tx.get(col) : await col.get();
  const own = Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as LeaveType]));
  return { ...DEFAULT_LEAVE_TYPES, ...own };
}

async function loadType(tx: Transaction, orgId: string, typeId: string): Promise<LeaveType> {
  const snap = await tx.get(typeRef(orgId, typeId));
  const t = snap.exists ? (snap.data() as LeaveType) : DEFAULT_LEAVE_TYPES[typeId];
  if (!t) throw errors.notFound('Leave type');
  return t;
}

/** The fields a balance document carries besides its per-type numbers. */
const balanceBase = (orgId: string, employee: DocumentSnapshot, y: string) => ({
  orgId,
  employeeId: employee.id,
  employeeName: employee.get('fullName'),
  employeeCode: employee.get('code'),
  employeeUid: employee.get('uid') ?? null,
  branchId: employee.get('branchId') ?? null,
  year: y,
  updatedAt: FieldValue.serverTimestamp(),
});

/** Adds to a type's numbers in a balance (created on first use). */
function bump(tx: Transaction, orgId: string, employee: DocumentSnapshot, y: string, typeId: string, delta: Partial<Record<'credited' | 'adjusted' | 'used' | 'pending' | 'carriedOut', number>>) {
  const inc = Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, FieldValue.increment(v)]));
  tx.set(balanceRef(orgId, employee.id, y), { ...balanceBase(orgId, employee, y), types: { [typeId]: inc } }, { merge: true });
}

/** Days available of a type: credited + adjusted − used − pending − carried into the next year. */
export function available(balance: DocumentSnapshot, typeId: string): number {
  const t = (balance.get(`types.${typeId}`) as Record<string, number> | undefined) ?? {};
  return days2((t.credited ?? 0) + (t.adjusted ?? 0) - (t.used ?? 0) - (t.pending ?? 0) - (t.carriedOut ?? 0));
}

function ledger(tx: Transaction, entryId: string, orgId: string, employee: DocumentSnapshot, entry: { year: string; typeId: string; kind: string; days: number; by: string; note?: string | null; requestId?: string | null; period?: string | null }) {
  tx.set(ledgerRef(orgId, entryId), {
    orgId,
    employeeId: employee.id,
    employeeUid: employee.get('uid') ?? null,
    branchId: employee.get('branchId') ?? null,
    note: null,
    requestId: null,
    period: null,
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------- types

const typeFields = z
  .strictObject({
    orgId: id,
    typeId: id.optional(),
    name,
    code: z.string().trim().regex(/^[A-Z0-9]{1,5}$/, 'must be 1–5 capital letters or digits'),
    paid: z.boolean(),
    annualQuota: z.number().min(0).max(365),
    accrual: z.enum(['MONTHLY', 'YEARLY', 'MANUAL']),
    carryForwardMax: z.number().min(0).max(365).default(0),
    allowHalfDay: z.boolean(),
    unlimited: z.boolean().default(false),
  })
  .refine((t) => t.unlimited || t.accrual === 'MANUAL' || t.annualQuota > 0, { message: 'needs a yearly quota unless it is unlimited or granted by hand', path: ['annualQuota'] });

/** Creates or changes a leave type (a default is overridden under its own id). Changes apply to future accruals and requests. */
export const saveType = command('leaveTypes-save', typeFields, async ({ actor, input, requestId }, tx) => {
  await actor.require('hr.config', input.orgId, undefined, tx);
  const { orgId, typeId, ...fields } = input;
  const ref = typeId ? typeRef(orgId, typeId) : db.collection(`orgs/${orgId}/leaveTypes`).doc();
  const before = typeId ? await tx.get(ref) : null;
  if (typeId && !before?.exists && !DEFAULT_LEAVE_TYPES[typeId]) throw errors.notFound('Leave type');
  const type: LeaveType = { ...fields, annualQuota: fields.unlimited || fields.accrual === 'MANUAL' ? 0 : fields.annualQuota, status: 'ACTIVE' };
  tx.set(ref, { ...type, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  recordAudit(tx, auditCtx(actor, requestId), orgId, {
    action: typeId ? 'leaveType.update' : 'leaveType.create',
    entityType: 'leaveType',
    entityId: ref.id,
    before: before?.exists ? before.data() : typeId ? DEFAULT_LEAVE_TYPES[typeId] : null,
    after: type,
  });
  return { typeId: ref.id };
});

/** Stops offering a leave type for new requests and accruals (balances and past leave stay). */
export const archiveType = command('leaveTypes-archive', z.strictObject({ orgId: id, typeId: id, reason }), async ({ actor, input, requestId }, tx) => {
  await actor.require('hr.config', input.orgId, undefined, tx);
  const current = await loadType(tx, input.orgId, input.typeId);
  if (current.status === 'ARCHIVED') throw errors.conflict('ARCHIVED', 'This leave type is already archived.');
  const { updatedAt: _u, updatedBy: _b, ...rest } = current as LeaveType & { updatedAt?: unknown; updatedBy?: unknown };
  tx.set(typeRef(input.orgId, input.typeId), { ...rest, status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'leaveType.archive',
    entityType: 'leaveType',
    entityId: input.typeId,
    before: { status: 'ACTIVE' },
    after: { status: 'ARCHIVED' },
    reason: input.reason,
  });
  return { typeId: input.typeId };
});

// ---------------------------------------------------------------- balances

/** HR adds or removes days by hand (opening balances, corrections), with a reason; never their own. */
export const adjust = command(
  'leave-adjust',
  z.strictObject({ orgId: id, employeeId: id, typeId: id, year, days: z.number().min(-365).max(365).refine((n) => n !== 0, 'cannot be zero'), reason }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'leave.adjust', input.orgId, employee.get('branchId') ?? null, tx);
    if (employee.get('uid') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden("You can't change your own leave balance.");
    const type = await loadType(tx, input.orgId, input.typeId);
    if (type.unlimited) throw errors.invalid(`${type.name} has no balance to adjust.`);
    const balance = await tx.get(balanceRef(input.orgId, employee.id, input.year));
    const days = days2(input.days);
    if (days < 0 && available(balance, input.typeId) + days < 0) throw errors.conflict('INSUFFICIENT_BALANCE', `Only ${available(balance, input.typeId)} days of ${type.name} are left to remove.`);
    ledger(tx, db.collection('_').doc().id, input.orgId, employee, { year: input.year, typeId: input.typeId, kind: 'ADJUST', days, by: actor.uid, note: input.reason });
    bump(tx, input.orgId, employee, input.year, input.typeId, { adjusted: days });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'leave.adjust',
      entityType: 'employee',
      entityId: employee.id,
      branchId: employee.get('branchId') ?? null,
      after: { typeId: input.typeId, year: input.year, days },
      reason: input.reason,
    });
    return { days };
  },
);

/**
 * The credits due to one employee for a month (idempotent: ledger ids are
 * fixed per period). Someone still joining without a joining date gets
 * nothing yet: a yearly credit is worked out from the joining date, and its
 * ledger entry is written once.
 */
async function accrueEmployee(orgId: string, employeeId: string, m: string, types: Record<string, LeaveType>): Promise<number> {
  const y = m.slice(0, 4);
  const prevYear = String(Number(y) - 1);
  return db.runTransaction(async (tx) => {
    const employee = await tx.get(db.doc(`orgs/${orgId}/employees/${employeeId}`));
    if (!employee.exists) return 0;
    const joined = (employee.get('joiningDate') as string | null) ?? null;
    if (!joined && employee.get('status') === 'ONBOARDING') return 0;
    const due: { entryId: string; typeId: string; kind: string; period: string; days: (prev: DocumentSnapshot) => number }[] = [];
    for (const [typeId, t] of Object.entries(types)) {
      if (t.status !== 'ACTIVE' || t.unlimited || t.accrual === 'MANUAL') continue;
      if (t.accrual === 'MONTHLY') due.push({ entryId: `${employeeId}_${typeId}_${m}_monthly`, typeId, kind: 'ACCRUAL', period: m, days: () => monthlyCredit(t) });
      else due.push({ entryId: `${employeeId}_${typeId}_${y}_yearly`, typeId, kind: 'ACCRUAL', period: y, days: () => yearlyCredit(t, y, joined) });
      // Carried days come from last year's balance, if the employee had one.
      if (t.carryForwardMax > 0 && (!joined || joined.slice(0, 4) < y))
        due.push({ entryId: `${employeeId}_${typeId}_${y}_carry`, typeId, kind: 'CARRY', period: y, days: (prev) => Math.min(t.carryForwardMax, Math.max(0, available(prev, typeId))) });
    }
    const [prev, ...entries] = await Promise.all([tx.get(balanceRef(orgId, employeeId, prevYear)), ...due.map((d) => tx.get(ledgerRef(orgId, d.entryId)))]);
    let credited = 0;
    due.forEach((d, i) => {
      if (entries[i].exists) return;
      const days = days2(d.days(prev));
      // A zero entry still marks the period done, so a later run doesn't recompute it.
      ledger(tx, d.entryId, orgId, employee, { year: y, typeId: d.typeId, kind: d.kind, days, by: 'system', period: d.period });
      if (days) bump(tx, orgId, employee, y, d.typeId, { credited: days });
      if (days && d.kind === 'CARRY') {
        // The carried days leave last year's balance, so a backdated request there can't spend them again.
        ledger(tx, `${employeeId}_${d.typeId}_${prevYear}_carryout`, orgId, employee, { year: prevYear, typeId: d.typeId, kind: 'CARRY_OUT', days: -days, by: 'system', period: y });
        bump(tx, orgId, employee, prevYear, d.typeId, { carriedOut: days });
      }
      credited += days;
    });
    return credited;
  });
}

/** Employees accrued at the same time within one organization. */
const ACCRUAL_CONCURRENCY = 8;

/**
 * Credits leave for a month to everyone employed that month. One employee's
 * failure is logged and skipped (the next run retries it). Returns employees
 * credited, days credited and employees that failed.
 */
export async function accrueMonth(orgId: string, m: string): Promise<{ employees: number; days: number; failed: number }> {
  const [types, staff] = await Promise.all([leaveTypes(orgId), employeesCol(orgId).where('status', 'in', WORKING).get()]);
  const last = datesOfMonth(m).at(-1)!;
  const due = staff.docs.filter((e) => {
    const joined = (e.get('joiningDate') as string | null) ?? null;
    return !joined || joined <= last;
  });
  let employees = 0;
  let days = 0;
  let failed = 0;
  await inChunks(due, ACCRUAL_CONCURRENCY, async (e) => {
    try {
      const credited = await accrueEmployee(orgId, e.id, m, types);
      if (credited) employees += 1;
      days += credited;
    } catch (err) {
      failed += 1;
      logger.error(`leave accrual: ${e.ref.path} failed`, { job: 'leave-accrual', orgId, employeeId: e.id, month: m, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return { employees, days: days2(days), failed };
}

/** HR runs accrual for a month by hand (a past month, or after adding staff); safe to repeat. */
export const accrue = query('leave-accrue', z.strictObject({ orgId: id, month }), async ({ actor, input }) => {
  await db.runTransaction(async (tx) => requireFor(actor, 'leave.adjust', input.orgId, null, tx));
  if (input.month > monthOf(businessDate(Date.now()))) throw errors.invalid('Leave can be credited once the month has started.');
  const result = await accrueMonth(input.orgId, input.month);
  await recordAuditNow(auditCtx(actor), input.orgId, { action: 'leave.accrue', entityType: 'leaveMonth', entityId: input.month, after: result });
  return result;
});

/**
 * Daily: credits the current month (and year) to the staff of every active
 * organization; new joiners are picked up the next day. Organizations are
 * swept a couple at a time; one that fails is logged and retried the next day.
 */
export async function accrueAll(now = Date.now()): Promise<{ orgs: number; employees: number; days: number; failedEmployees: number; failedOrgs: number }> {
  const m = monthOf(businessDate(now));
  const total = { employees: 0, days: 0, failedEmployees: 0 };
  const swept = await sweep(
    'leave-accrual',
    db.collection('orgs').where('status', '==', 'ACTIVE'),
    async (org) => {
      const r = await accrueMonth(org.id, m);
      total.employees += r.employees;
      total.days += r.days;
      total.failedEmployees += r.failed;
      return r.employees > 0;
    },
    { concurrency: 2 },
  );
  const summary = { month: m, orgs: swept.processed, ...total, days: days2(total.days), failedOrgs: swept.failed };
  (summary.failedEmployees || summary.failedOrgs ? logger.warn : logger.info)(`leave-accrual: credited ${summary.employees} employees in ${summary.orgs} organizations`, { job: 'leave-accrual', ...summary });
  return summary;
}

export const accrueSweep = onSchedule({ schedule: 'every day 00:45', timeZone: 'Asia/Kolkata', region: REGION, ...JOB_OPTIONS }, async () => {
  await accrueAll();
});

// ---------------------------------------------------------------- requests

/** Holidays that apply to an employee's branch between two dates (reads only). */
async function holidaysBetween(tx: Transaction, orgId: string, branchId: string | null, from: string, to: string): Promise<Set<string>> {
  const snap = await tx.get(db.collection(`orgs/${orgId}/holidays`).where('date', '>=', from).where('date', '<=', to));
  return new Set(snap.docs.filter((h) => holidayApplies(h.get('branchIds') as string[] | undefined, branchId)).map((h) => h.id));
}

/** Refuses dates in a month that is finalized (or being finalized). */
async function ensureOpen(tx: Transaction, orgId: string, branchId: string | null, dates: string[]) {
  const months = [...new Set(dates.map(monthOf))];
  const locks = await Promise.all(months.map((mm) => tx.get(lockRef(orgId, mm, branchId))));
  const shut = locks.find(isClosed);
  if (shut) throw errors.conflict('MONTH_FINALIZED', `Attendance for ${shut.get('month')} is finalized. Ask HR to reopen it.`);
}

/**
 * Applies for leave: the caller's own, or with `employeeId` on someone's
 * behalf (a leave approver for their branch). Days exclude weekly offs and
 * holidays; the balance must cover them unless the type is unlimited.
 *
 * With `approve`, leave recorded for someone else is approved in the same
 * step (recording it already needs `leave.approve` at their branch): the days
 * are used at once and marked on attendance, as `leave-decide` would. Never
 * for the caller's own leave.
 */
export const apply = command(
  'leave-apply',
  z
    .strictObject({ orgId: id, employeeId: id.optional(), typeId: id, from: date, to: date, halfDay: z.enum(['NONE', 'FIRST', 'SECOND']).default('NONE'), reason, approve: z.boolean().default(false) })
    .refine((r) => r.from <= r.to, { message: 'must not be before the start', path: ['to'] })
    .refine((r) => r.from.slice(0, 4) === r.to.slice(0, 4), { message: 'must be in the same year as the start (apply twice across the new year)', path: ['to'] })
    .refine((r) => r.halfDay === 'NONE' || r.from === r.to, { message: 'a half day is a single date', path: ['halfDay'] }),
  async ({ actor, input, requestId }, tx) => {
    const employee = input.employeeId ? await loadEmployee(tx, input.orgId, input.employeeId) : await ownEmployee(tx, input.orgId, actor);
    const self = employee.get('uid') === actor.uid;
    // The caller's own leave needs no permission, so it can never be approved in the same step.
    if (input.approve && self) throw errors.forbidden("You can't approve your own leave.");
    const branchId = (employee.get('branchId') as string | null) ?? null;
    if (!self) await requireFor(actor, 'leave.approve', input.orgId, branchId, tx);
    ensureWorking(employee);
    const type = await loadType(tx, input.orgId, input.typeId);
    if (type.status !== 'ACTIVE') throw errors.conflict('ARCHIVED', `${type.name} is no longer offered.`);
    if (input.halfDay !== 'NONE' && !type.allowHalfDay) throw errors.invalid(`${type.name} can't be taken for half a day.`);
    const joined = (employee.get('joiningDate') as string | null) ?? null;
    if (joined && input.from < joined) throw errors.invalid('Leave cannot start before the joining date.');
    const span = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000 + 1;
    if (span > MAX_SPAN) throw errors.invalid(`Apply for at most ${MAX_SPAN} days at a time.`);
    const y = input.from.slice(0, 4);

    const [branch, holidays, balance, mine] = await Promise.all([
      branchId ? tx.get(db.doc(`orgs/${input.orgId}/branches/${branchId}`)) : null,
      holidaysBetween(tx, input.orgId, branchId, input.from, input.to),
      tx.get(balanceRef(input.orgId, employee.id, y)),
      tx.get(requestsCol(input.orgId).where('employeeId', '==', employee.id).where('year', '==', y)),
    ]);
    const { dates, days } = leaveDays(input.from, input.to, weeklyOffsOf(employee, branch), holidays, input.halfDay !== 'NONE');
    if (!days) throw errors.invalid('Those dates are all weekly offs or holidays.');
    const clash = mine.docs.find((r) => ['PENDING', 'APPROVED'].includes(r.get('status')) && (r.get('dates') as string[]).some((d) => dates.includes(d)));
    if (clash) throw errors.conflict('OVERLAPS', `Leave from ${clash.get('from')} to ${clash.get('to')} already covers some of these dates.`);
    await ensureOpen(tx, input.orgId, branchId, dates);
    if (!type.unlimited && available(balance, input.typeId) < days)
      throw errors.conflict('INSUFFICIENT_BALANCE', `Only ${available(balance, input.typeId)} days of ${type.name} are available for ${y}.`);

    // Approving now: the days' attendance is read here, before the first write.
    const markLeave = input.approve ? await markDays(tx, input.orgId, employee, dates, { paid: type.paid, half: input.halfDay !== 'NONE', typeId: input.typeId }) : null;

    const ref = requestsCol(input.orgId).doc();
    const approved = input.approve;
    markLeave?.();
    tx.set(ref, {
      orgId: input.orgId,
      employeeId: employee.id,
      employeeName: employee.get('fullName'),
      employeeCode: employee.get('code'),
      employeeUid: employee.get('uid') ?? null,
      branchId,
      typeId: input.typeId,
      typeName: type.name,
      typeCode: type.code,
      paid: type.paid,
      from: input.from,
      to: input.to,
      halfDay: input.halfDay,
      dates,
      months: [...new Set(dates.map(monthOf))],
      days,
      year: y,
      reason: input.reason,
      status: approved ? 'APPROVED' : 'PENDING',
      appliedBy: actor.uid,
      appliedAt: FieldValue.serverTimestamp(),
      decidedBy: approved ? actor.uid : null,
      decidedByEmail: approved ? actor.email : null,
      ...(approved ? { decidedAt: FieldValue.serverTimestamp() } : {}),
      decisionNote: null,
    });
    const request = { id: ref.id, typeId: input.typeId, year: y, from: input.from, to: input.to, days };
    if (!approved) bump(tx, input.orgId, employee, y, input.typeId, { pending: days });
    // One notice either way (each is also a WhatsApp staff alert).
    notify(
      tx,
      employee.get('uid'),
      approved
        ? { orgId: input.orgId, kind: 'leave.approved', title: `${type.name} recorded for you and approved: ${span_(input.from, input.to)}`, link: LINKS.myLeave }
        : { orgId: input.orgId, kind: 'leave.recorded', title: `${type.name} recorded for you: ${span_(input.from, input.to)}`, body: 'It is waiting for approval.', link: LINKS.myLeave },
      actor.uid,
    );
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'leave.apply',
      entityType: 'employee',
      entityId: employee.id,
      branchId,
      after: { requestId: ref.id, typeId: input.typeId, from: input.from, to: input.to, days, self, ...(approved ? { approved: true } : {}) },
      reason: input.reason,
    });
    if (approved) writeApproval(tx, auditCtx(actor, requestId), actor.uid, input.orgId, employee, request, { held: false, note: null });
    return { leaveId: ref.id, days, status: approved ? 'APPROVED' : 'PENDING' };
  },
);

/**
 * What approving writes besides the request and the attendance days: the days
 * become used (`held`: they were waiting as pending until now), a TAKEN ledger
 * entry, and the audit entry. Shared by `leave-decide` and by leave recorded
 * and approved in one step, so the two cannot drift apart.
 */
function writeApproval(
  tx: Transaction,
  ctx: ReturnType<typeof auditCtx>,
  byUid: string,
  orgId: string,
  employee: DocumentSnapshot,
  request: { id: string; typeId: string; year: string; from: string; to: string; days: number },
  opts: { held: boolean; note: string | null },
) {
  const { id: leaveId, typeId, year: y, days } = request;
  bump(tx, orgId, employee, y, typeId, opts.held ? { pending: -days, used: days } : { used: days });
  ledger(tx, `${leaveId}_taken`, orgId, employee, { year: y, typeId, kind: 'TAKEN', days: -days, by: byUid, requestId: leaveId });
  recordAudit(tx, ctx, orgId, {
    action: 'leave.approve',
    entityType: 'employee',
    entityId: employee.id,
    branchId: employee.get('branchId') ?? null,
    after: { requestId: leaveId, typeId, from: request.from, to: request.to, days },
    reason: opts.note,
  });
}

/**
 * Sets (or clears) leave on each day's attendance record. Reads first; returns the writer.
 *
 * The caller must have called `ensureOpen` for these dates in the same
 * transaction: the month locks are not read again here (that read is what
 * makes a finalization running at the same time conflict). The shift and the
 * branch are read once, and the day records and holidays in one read.
 */
async function markDays(tx: Transaction, orgId: string, employee: DocumentSnapshot, dates: string[], leave: DayLeave | null) {
  const today = businessDate(Date.now());
  const branchId = (employee.get('branchId') as string | null) ?? null;
  const shiftId = (employee.get('shiftId') as string | null | undefined) ?? null;
  const [shift, branch, snaps] = await Promise.all([
    shiftId ? tx.get(db.doc(`orgs/${orgId}/shifts/${shiftId}`)) : null,
    branchId ? tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`)) : null,
    readAll(tx, [...dates.map((day) => recordRef(orgId, employee.id, day)), ...dates.map((day) => db.doc(`orgs/${orgId}/holidays/${day}`))]),
  ]);
  const days = dates.map((day, i) => ({ day, current: snaps[i], ctx: contextFrom(employee, day, shift, branch, snaps[dates.length + i], false) }));
  return () => {
    for (const { day, current, ctx } of days) {
      const checkIn = ms(current.get('checkIn'));
      if (!leave && !checkIn && day > today) {
        // Nothing left on a future day: the record goes away.
        if (current.exists) tx.delete(current.ref);
        continue;
      }
      const record = recordFor(orgId, employee, day, ctx, checkIn, ms(current.get('checkOut')), (current.get('source') as string | undefined) ?? 'LEAVE', leave);
      tx.set(current.ref, record, { merge: true });
    }
  };
}

const loadRequest = async (tx: Transaction, orgId: string, leaveId: string) => {
  const snap = await tx.get(requestsCol(orgId).doc(leaveId));
  if (!snap.exists) throw errors.notFound('Leave request');
  return snap;
};

/** A leave approver for the employee's branch approves or rejects a pending request; never their own. */
export const decide = command(
  'leave-decide',
  z.strictObject({ orgId: id, leaveId: id, decision: z.enum(['APPROVE', 'REJECT']), note }),
  async ({ actor, input, requestId }, tx) => {
    const req = await loadRequest(tx, input.orgId, input.leaveId);
    if (req.get('status') !== 'PENDING') throw errors.conflict('NOT_PENDING', 'This leave request has already been decided.');
    if (req.get('employeeUid') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden("You can't approve your own leave.");
    const employee = await loadEmployee(tx, input.orgId, req.get('employeeId'));
    if (!(await canFor(actor, 'leave.approve', input.orgId, employee.get('branchId') ?? null, tx))) throw errors.forbidden();
    if (input.decision === 'REJECT' && input.note.length < 3) throw errors.invalid('Say why the leave is rejected.');
    const approve = input.decision === 'APPROVE';
    const dates = req.get('dates') as string[];
    const days = req.get('days') as number;
    const [y, typeId] = [req.get('year') as string, req.get('typeId') as string];
    let write: (() => void) | null = null;
    if (approve) {
      await ensureOpen(tx, input.orgId, employee.get('branchId') ?? null, dates);
      write = await markDays(tx, input.orgId, employee, dates, { paid: req.get('paid'), half: req.get('halfDay') !== 'NONE', typeId });
    }
    write?.();
    tx.update(req.ref, {
      status: approve ? 'APPROVED' : 'REJECTED',
      decidedBy: actor.uid,
      decidedByEmail: actor.email,
      decidedAt: FieldValue.serverTimestamp(),
      decisionNote: input.note || null,
    });
    if (!approve) bump(tx, input.orgId, employee, y, typeId, { pending: -days });
    notify(
      tx,
      req.get('employeeUid'),
      {
        orgId: input.orgId,
        kind: approve ? 'leave.approved' : 'leave.rejected',
        title: `${req.get('typeName')} ${span_(req.get('from'), req.get('to'))} ${approve ? 'approved' : 'not approved'}`,
        body: input.note || undefined,
        link: LINKS.myLeave,
      },
      actor.uid,
    );
    if (approve) {
      writeApproval(tx, auditCtx(actor, requestId), actor.uid, input.orgId, employee, { id: req.id, typeId, year: y, from: req.get('from'), to: req.get('to'), days }, { held: true, note: input.note || null });
    } else {
      recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
        action: 'leave.reject',
        entityType: 'employee',
        entityId: employee.id,
        branchId: employee.get('branchId') ?? null,
        after: { requestId: req.id, typeId, from: req.get('from'), to: req.get('to'), days },
        reason: input.note || null,
      });
    }
    return { leaveId: req.id, status: approve ? 'APPROVED' : 'REJECTED' };
  },
);

/**
 * Cancels a request. Employees cancel their own pending leave, or approved
 * leave that hasn't started; HR (leave.adjust) can cancel any leave outside
 * a finalized month, with a reason. The days go back to the balance and the
 * attendance days are recomputed.
 */
export const cancel = command('leave-cancel', z.strictObject({ orgId: id, leaveId: id, note }), async ({ actor, input, requestId }, tx) => {
  const req = await loadRequest(tx, input.orgId, input.leaveId);
  const status = req.get('status') as string;
  if (!['PENDING', 'APPROVED'].includes(status)) throw errors.conflict('NOT_OPEN', 'This leave request is already closed.');
  const employee = await loadEmployee(tx, input.orgId, req.get('employeeId'));
  const branchId = (employee.get('branchId') as string | null) ?? null;
  const self = req.get('employeeUid') === actor.uid;
  const started = (req.get('from') as string) <= businessDate(Date.now());
  const hr = await canFor(actor, 'leave.adjust', input.orgId, branchId, tx);
  if (!(self && (status === 'PENDING' || !started)) && !(hr && !self)) {
    if (self) throw errors.forbidden('This leave has started. Ask HR to cancel it.');
    throw errors.forbidden();
  }
  if (!self && input.note.length < 3) throw errors.invalid("Say why you're cancelling this leave.");
  const dates = req.get('dates') as string[];
  const days = req.get('days') as number;
  const [y, typeId] = [req.get('year') as string, req.get('typeId') as string];
  let write: (() => void) | null = null;
  if (status === 'APPROVED') {
    await ensureOpen(tx, input.orgId, branchId, dates);
    write = await markDays(tx, input.orgId, employee, dates, null);
  }
  write?.();
  tx.update(req.ref, { status: 'CANCELLED', cancelledBy: actor.uid, cancelledAt: FieldValue.serverTimestamp(), cancelNote: input.note || null });
  bump(tx, input.orgId, employee, y, typeId, status === 'APPROVED' ? { used: -days } : { pending: -days });
  notify(
    tx,
    req.get('employeeUid'),
    { orgId: input.orgId, kind: 'leave.cancelled', title: `${req.get('typeName')} ${span_(req.get('from'), req.get('to'))} was cancelled`, body: input.note || undefined, link: LINKS.myLeave },
    actor.uid,
  );
  if (status === 'APPROVED') ledger(tx, `${req.id}_returned`, input.orgId, employee, { year: y, typeId, kind: 'RETURNED', days, by: actor.uid, requestId: req.id, note: input.note || null });
  recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
    action: 'leave.cancel',
    entityType: 'employee',
    entityId: employee.id,
    branchId,
    before: { status },
    after: { requestId: req.id, typeId, from: req.get('from'), to: req.get('to'), days, self },
    reason: input.note || null,
  });
  return { leaveId: req.id };
});
