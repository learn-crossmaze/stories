import { randomUUID } from 'node:crypto';

import { FieldValue, type DocumentReference, type DocumentSnapshot, Timestamp, type Transaction, type WriteBatch } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { recordAudit, recordAuditNow } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { LINKS, notify } from '../core/notify.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import { atIST, businessDate, datesOfMonth, type DayLeave, DEFAULT_RULES, evaluateDay, monthOf, type ShiftRules, summarize, weekdayOf } from './attendanceRules.js';
import { auditCtx, date, holidayApplies, month, time, WORKING, weeklyOffsOf } from './common.js';
import { canFor, employeesCol, loadEmployee, requireFor } from './model.js';

/**
 * Attendance (docs/HRMS.md §8). One record per employee per business day:
 * orgs/{o}/attendance/{employeeId}_{date}. The server sets check-in and
 * check-out times; managers adjust with a reason; employees ask for
 * corrections; a finalized month (orgs/{o}/attendanceLocks/{month}_{branch})
 * no longer changes until it is reopened.
 */

export const recordRef = (orgId: string, employeeId: string, day: string) => db.doc(`orgs/${orgId}/attendance/${employeeId}_${day}`);
export const lockId = (m: string, branchId: string | null) => `${m}_${branchId ?? 'HO'}`;
export const lockRef = (orgId: string, m: string, branchId: string | null) => db.doc(`orgs/${orgId}/attendanceLocks/${lockId(m, branchId)}`);

/**
 * A month no longer changes while it is being finalized (FINALIZING, set
 * before finalization reads anything) and once it is finalized.
 */
const CLOSED = ['FINALIZING', 'FINALIZED'];
export const isClosed = (lock: DocumentSnapshot) => lock.exists && CLOSED.includes(lock.get('status'));
/** A finalization that has not finished in this long is taken to have failed; finalizing again takes over. */
const FINALIZING_TIMEOUT_MS = 15 * 60_000;

export interface DayContext {
  rules: ShiftRules;
  shiftId: string | null;
  shiftName: string | null;
  weeklyOff: boolean;
  holiday: boolean;
  locked: boolean;
}

/** Everything needed to evaluate a day (reads only). */
export async function dayContext(tx: Transaction, orgId: string, employee: DocumentSnapshot, day: string): Promise<DayContext> {
  const branchId = (employee.get('branchId') as string | null) ?? null;
  const shiftId = (employee.get('shiftId') as string | null | undefined) ?? null;
  const [shift, branch, holiday, lock] = await Promise.all([
    shiftId ? tx.get(db.doc(`orgs/${orgId}/shifts/${shiftId}`)) : null,
    branchId ? tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`)) : null,
    tx.get(db.doc(`orgs/${orgId}/holidays/${day}`)),
    tx.get(lockRef(orgId, monthOf(day), branchId)),
  ]);
  return {
    rules: shift?.exists ? (shift.data() as ShiftRules) : DEFAULT_RULES,
    shiftId: shift?.exists ? shiftId : null,
    shiftName: shift?.exists ? (shift.get('name') as string) : null,
    weeklyOff: weeklyOffsOf(employee, branch).includes(weekdayOf(day)),
    holiday: holiday.exists && holidayApplies(holiday.get('branchIds') as string[] | undefined, branchId),
    locked: isClosed(lock),
  };
}

export const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);

/** Approved leave kept on a day's record (set and cleared by leave decisions, docs/HRMS.md §9). */
export const leaveOf = (record: DocumentSnapshot | undefined) => (record?.get('leave') as DayLeave | null | undefined) ?? null;

/** The full record for a day from its punches and any approved leave. */
export function recordFor(
  orgId: string,
  employee: DocumentSnapshot,
  day: string,
  ctx: DayContext,
  checkIn: number | null,
  checkOut: number | null,
  source: string,
  leave: DayLeave | null,
  closing = false,
) {
  const result = evaluateDay({ date: day, rules: ctx.rules, checkIn, checkOut, weeklyOff: ctx.weeklyOff, holiday: ctx.holiday, closing, leave });
  return {
    orgId,
    employeeId: employee.id,
    employeeName: employee.get('fullName'),
    employeeCode: employee.get('code'),
    employeeUid: employee.get('uid') ?? null,
    branchId: employee.get('branchId') ?? null,
    date: day,
    month: monthOf(day),
    shiftId: ctx.shiftId,
    shiftName: ctx.shiftName,
    shiftStart: ctx.rules.start,
    shiftEnd: ctx.rules.end,
    checkIn: checkIn === null ? null : Timestamp.fromMillis(checkIn),
    checkOut: checkOut === null ? null : Timestamp.fromMillis(checkOut),
    leave,
    ...result,
    source,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** The employee record linked to the caller (for their own punches and requests). */
export async function ownEmployee(tx: Transaction, orgId: string, actor: Actor) {
  const snap = await tx.get(employeesCol(orgId).where('uid', '==', actor.uid).limit(1));
  if (snap.empty) throw errors.conflict('NO_EMPLOYEE_RECORD', "You don't have an employee record in this organization. Ask HR to add you.");
  return snap.docs[0];
}

export function ensureWorking(employee: DocumentSnapshot) {
  if (!WORKING.includes(employee.get('status') as string)) throw errors.conflict('NOT_WORKING', `${employee.get('fullName')} is not currently employed here.`);
}

/**
 * Check in or out now (server time). Without `employeeId` it is the caller's
 * own punch; with one, a manager records it at the desk. A check-out closes
 * yesterday's open day for overnight shifts.
 */
export const punch = command(
  'attendance-punch',
  // `punch`, not `action`: the router uses `action` for the action name.
  z.strictObject({ orgId: id, employeeId: id.optional(), punch: z.enum(['IN', 'OUT']) }),
  async ({ actor, input, requestId }, tx) => {
    const employee = input.employeeId ? await loadEmployee(tx, input.orgId, input.employeeId) : await ownEmployee(tx, input.orgId, actor);
    const self = employee.get('uid') === actor.uid;
    if (!self) await requireFor(actor, 'attendance.manage', input.orgId, employee.get('branchId'), tx);
    ensureWorking(employee);
    const now = Date.now();
    const today = businessDate(now);
    const yesterday = businessDate(now - 86_400_000);

    let day = today;
    let current = await tx.get(recordRef(input.orgId, employee.id, today));
    if (input.punch === 'OUT' && !ms(current.get('checkIn'))) {
      const prev = await tx.get(recordRef(input.orgId, employee.id, yesterday));
      if (ms(prev.get('checkIn')) && !ms(prev.get('checkOut'))) {
        day = yesterday;
        current = prev;
      }
    }
    const ctx = await dayContext(tx, input.orgId, employee, day);
    if (ctx.locked) throw errors.conflict('MONTH_FINALIZED', 'Attendance for this month is finalized. Ask HR to reopen it.');
    const checkIn = ms(current.get('checkIn'));
    const checkOut = ms(current.get('checkOut'));
    if (input.punch === 'IN' && checkIn) throw errors.conflict('ALREADY_IN', 'Already checked in today.');
    if (input.punch === 'OUT' && !checkIn) throw errors.conflict('NOT_IN', 'Check in first.');
    if (input.punch === 'OUT' && checkOut) throw errors.conflict('ALREADY_OUT', 'Already checked out today.');

    const record = recordFor(input.orgId, employee, day, ctx, input.punch === 'IN' ? now : checkIn, input.punch === 'OUT' ? now : null, self ? 'SELF' : 'DESK', leaveOf(current));
    tx.set(current.ref, { ...record, ...(self ? {} : { recordedBy: actor.uid }) }, { merge: true });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: input.punch === 'IN' ? 'attendance.checkIn' : 'attendance.checkOut',
      entityType: 'employee',
      entityId: employee.id,
      branchId: record.branchId,
      after: { date: day, at: new Date(now).toISOString(), self },
    });
    return { date: day, status: record.status, late: record.late };
  },
);

/** Turns 'HH:MM' times on a day into instants; a check-out earlier than the check-in is the next morning. */
function instants(day: string, checkIn: string | null, checkOut: string | null) {
  if (checkOut && !checkIn) throw errors.invalid('A check-out needs a check-in.');
  const inMs = checkIn ? atIST(day, checkIn) : null;
  let outMs = checkOut ? atIST(day, checkOut) : null;
  if (inMs !== null && outMs !== null && outMs <= inMs) outMs += 86_400_000;
  if (inMs !== null && inMs > Date.now()) throw errors.invalid('That time has not happened yet.');
  return { inMs, outMs };
}

/** Applies corrected times to a day and returns what changed (reads first; call `write()` after other reads). */
async function correctDay(tx: Transaction, orgId: string, employee: DocumentSnapshot, day: string, checkIn: string | null, checkOut: string | null, source: string) {
  const ref = recordRef(orgId, employee.id, day);
  const [current, ctx] = await Promise.all([tx.get(ref), dayContext(tx, orgId, employee, day)]);
  if (ctx.locked) throw errors.conflict('MONTH_FINALIZED', 'Attendance for this month is finalized. Ask HR to reopen it.');
  const { inMs, outMs } = instants(day, checkIn, checkOut);
  const record = recordFor(orgId, employee, day, ctx, inMs, outMs, source, leaveOf(current));
  const before = { checkIn: ms(current.get('checkIn')), checkOut: ms(current.get('checkOut')), status: current.get('status') ?? null };
  return { record, before, write: (extra: Record<string, unknown>) => tx.set(ref, { ...record, ...extra }, { merge: true }) };
}

/** A manager sets a day's times directly (with a reason; never their own). */
export const adjust = command(
  'attendance-adjust',
  z.strictObject({ orgId: id, employeeId: id, date, checkIn: time.nullable(), checkOut: time.nullable(), reason }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'attendance.manage', input.orgId, employee.get('branchId'), tx);
    if (employee.get('uid') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden("You can't change your own attendance. Ask for a correction instead.");
    if (input.date > businessDate(Date.now())) throw errors.invalid('That day has not happened yet.');
    const { record, before, write } = await correctDay(tx, input.orgId, employee, input.date, input.checkIn, input.checkOut, 'ADJUSTED');
    write({ adjustedBy: actor.uid, adjustReason: input.reason });
    notify(tx, employee.get('uid'), { orgId: input.orgId, kind: 'attendance.adjusted', title: `Your attendance for ${input.date} was changed`, body: input.reason, link: LINKS.myAttendance }, actor.uid);
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'attendance.adjust',
      entityType: 'employee',
      entityId: employee.id,
      branchId: record.branchId,
      before: { date: input.date, ...before },
      after: { date: input.date, checkIn: input.checkIn, checkOut: input.checkOut, status: record.status },
      reason: input.reason,
    });
    return { date: input.date, status: record.status };
  },
);

const correctionRef = (orgId: string, employeeId: string, day: string) => db.doc(`orgs/${orgId}/attendanceCorrections/${employeeId}_${day}`);

/** An employee asks for their own day to be corrected. */
export const requestCorrection = command(
  'attendance-requestCorrection',
  z.strictObject({ orgId: id, date, checkIn: time.nullable(), checkOut: time.nullable(), reason }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await ownEmployee(tx, input.orgId, actor);
    if (input.date > businessDate(Date.now())) throw errors.invalid('That day has not happened yet.');
    instants(input.date, input.checkIn, input.checkOut);
    const ref = correctionRef(input.orgId, employee.id, input.date);
    const [existing, ctx] = await Promise.all([tx.get(ref), dayContext(tx, input.orgId, employee, input.date)]);
    if (ctx.locked) throw errors.conflict('MONTH_FINALIZED', 'Attendance for this month is finalized. Ask HR to reopen it.');
    if (existing.exists && existing.get('status') === 'PENDING') throw errors.conflict('ALREADY_REQUESTED', 'A correction for this day is already waiting for approval.');
    const data = {
      orgId: input.orgId,
      employeeId: employee.id,
      employeeName: employee.get('fullName'),
      employeeCode: employee.get('code'),
      employeeUid: actor.uid,
      branchId: employee.get('branchId') ?? null,
      date: input.date,
      month: monthOf(input.date),
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      reason: input.reason,
      status: 'PENDING',
      requestedAt: FieldValue.serverTimestamp(),
      decidedBy: null,
      decisionNote: null,
    };
    tx.set(ref, data);
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'attendance.requestCorrection',
      entityType: 'employee',
      entityId: employee.id,
      branchId: data.branchId,
      after: { date: input.date, checkIn: input.checkIn, checkOut: input.checkOut },
      reason: input.reason,
    });
    return { correctionId: ref.id };
  },
);

/** A manager approves (the times are applied) or rejects a correction; never their own. */
export const decideCorrection = command(
  'attendance-decideCorrection',
  z.strictObject({ orgId: id, correctionId: id, decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).default('') }),
  async ({ actor, input, requestId }, tx) => {
    const ref = db.doc(`orgs/${input.orgId}/attendanceCorrections/${input.correctionId}`);
    const corr = await tx.get(ref);
    if (!corr.exists) throw errors.notFound('Correction');
    if (corr.get('status') !== 'PENDING') throw errors.conflict('NOT_PENDING', 'This correction has already been decided.');
    if (corr.get('employeeUid') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden("You can't approve your own correction.");
    const employee = await loadEmployee(tx, input.orgId, corr.get('employeeId'));
    if (!(await canFor(actor, 'corrections.approve', input.orgId, employee.get('branchId'), tx))) throw errors.forbidden();
    if (input.decision === 'REJECT' && input.note.length < 3) throw errors.invalid('Say why the correction is rejected.');
    const applied = input.decision === 'APPROVE' ? await correctDay(tx, input.orgId, employee, corr.get('date'), corr.get('checkIn'), corr.get('checkOut'), 'CORRECTION') : null;
    applied?.write({ correctionId: ref.id });
    notify(
      tx,
      corr.get('employeeUid'),
      {
        orgId: input.orgId,
        kind: input.decision === 'APPROVE' ? 'correction.approved' : 'correction.rejected',
        title: `Correction for ${corr.get('date')} ${input.decision === 'APPROVE' ? 'approved' : 'not approved'}`,
        body: input.note || undefined,
        link: LINKS.myAttendance,
      },
      actor.uid,
    );
    tx.update(ref, {
      status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      decidedBy: actor.uid,
      decidedByEmail: actor.email,
      decidedAt: FieldValue.serverTimestamp(),
      decisionNote: input.note || null,
    });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: input.decision === 'APPROVE' ? 'attendance.approveCorrection' : 'attendance.rejectCorrection',
      entityType: 'employee',
      entityId: employee.id,
      branchId: employee.get('branchId') ?? null,
      before: applied?.before ?? null,
      after: { date: corr.get('date'), status: applied?.record.status ?? null },
      reason: input.note || null,
    });
    return { correctionId: ref.id, status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
  },
);

/** Everyone whose attendance a branch's month covers: employed at some point in the month. */
async function employeesFor(orgId: string, branchId: string | null, m: string) {
  const [first, last] = [`${m}-01`, datesOfMonth(m).at(-1)!];
  const snap = await employeesCol(orgId).where('branchId', '==', branchId).get();
  return snap.docs.filter((e) => {
    if (e.get('status') === 'DRAFT') return false;
    const joined = (e.get('joiningDate') as string | null) ?? null;
    const exit = (e.get('exitDate') as string | null) ?? null;
    if (joined && joined > last) return false;
    if (exit && exit < first) return false;
    return e.get('status') !== 'OFFBOARDED' || !!exit;
  });
}

const BATCH = 400;

/** The fields of a day record that finalization sets: its evaluation, never the punches or leave. */
function evaluationOf(record: ReturnType<typeof recordFor>) {
  const { checkIn: _in, checkOut: _out, leave: _leave, ...rest } = record;
  return rest;
}

/**
 * Closes a month for a branch (`branchId: null` = head office staff): every
 * employed day gets a final evaluation (missing days become absent, weekly off
 * or holiday; a missing check-out counts as a half day), each employee gets a
 * monthly summary with payable days, and the month is locked. Refused while
 * corrections or leave wait for a decision.
 *
 * The month is closed first (lock FINALIZING, in the transaction that checks
 * nothing is pending), so punches, corrections and leave decisions for it are
 * refused while records are read and evaluated; a last transaction marks it
 * FINALIZED (a failure puts the lock back as it was). Records are read per
 * employee, so someone who moved here during the month keeps the days
 * recorded at their old branch. Only evaluation fields are written: punches
 * and leave on a record are never touched. Safe to repeat after a reopen:
 * summaries of people the month no longer covers are removed.
 */
export const finalize = query(
  'attendance-finalize',
  z.strictObject({ orgId: id, month, branchId: id.nullable() }),
  async ({ actor, input }) => {
    const { orgId, branchId } = input;
    const m = input.month;
    const ref = lockRef(orgId, m, branchId);
    const finalizeId = randomUUID();
    const previous = await db.runTransaction(async (tx) => {
      await requireFor(actor, 'attendance.finalize', orgId, branchId, tx);
      if (m >= monthOf(businessDate(Date.now()))) throw errors.invalid('A month can be finalized once it is over.');
      const [lock, pending, leave] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection(`orgs/${orgId}/attendanceCorrections`).where('month', '==', m).where('branchId', '==', branchId).where('status', '==', 'PENDING')),
        tx.get(db.collection(`orgs/${orgId}/leaveRequests`).where('months', 'array-contains', m).where('branchId', '==', branchId).where('status', '==', 'PENDING')),
      ]);
      const status = (lock.get('status') as string | undefined) ?? null;
      if (status === 'FINALIZED') throw errors.conflict('MONTH_FINALIZED', 'This month is already finalized.');
      if (status === 'FINALIZING' && Date.now() - (ms(lock.get('finalizingAt')) ?? 0) < FINALIZING_TIMEOUT_MS)
        throw errors.conflict('MONTH_FINALIZING', 'This month is being finalized. Try again in a few minutes.');
      if (!pending.empty) throw errors.conflict('CORRECTIONS_PENDING', `Decide the ${pending.size} correction${pending.size === 1 ? '' : 's'} waiting for approval first.`);
      if (!leave.empty) throw errors.conflict('LEAVE_PENDING', `Decide the ${leave.size} leave request${leave.size === 1 ? '' : 's'} waiting for approval first.`);
      // What to go back to if this run fails (taking over a stalled run: what that run would have gone back to).
      const before = status === 'FINALIZING' ? ((lock.get('previousStatus') as string | null | undefined) ?? null) : status;
      tx.set(ref, { orgId, month: m, branchId, status: 'FINALIZING', finalizeId, previousStatus: before, finalizingBy: actor.uid, finalizingAt: FieldValue.serverTimestamp() }, { merge: true });
      return before;
    });

    let covered = 0;
    let totalPayable = 0;
    try {
      const days = datesOfMonth(m);
      const [employees, shifts, holidays, branch, oldSummaries] = await Promise.all([
        employeesFor(orgId, branchId, m),
        db.collection(`orgs/${orgId}/shifts`).get(),
        db.collection(`orgs/${orgId}/holidays`).where('date', '>=', days[0]).where('date', '<=', days.at(-1)!).get(),
        branchId ? db.doc(`orgs/${orgId}/branches/${branchId}`).get() : null,
        db.collection(`orgs/${orgId}/attendanceSummaries`).where('month', '==', m).where('branchId', '==', branchId).get(),
      ]);
      covered = employees.length;
      const shiftById = new Map(shifts.docs.map((s) => [s.id, s]));
      const holidayOn = new Map(holidays.docs.map((h) => [h.id, h.get('branchIds') as string[] | undefined]));

      let batch = db.batch();
      let ops = 0;
      const flush = async () => {
        if (ops) await batch.commit();
        batch = db.batch();
        ops = 0;
      };
      const put = async (write: (b: WriteBatch) => void) => {
        write(batch);
        if (++ops >= BATCH) await flush();
      };
      for (const e of employees) {
        const shift = e.get('shiftId') ? shiftById.get(e.get('shiftId')) : undefined;
        const offs = weeklyOffsOf(e, branch);
        const joined = (e.get('joiningDate') as string | null) ?? null;
        const exit = (e.get('exitDate') as string | null) ?? null;
        const employed = days.filter((day) => !((joined && day < joined) || (exit && day > exit)));
        const records = employed.length ? await db.getAll(...employed.map((day) => recordRef(orgId, e.id, day))) : [];
        const results = [];
        for (const [i, day] of employed.entries()) {
          const ctx: DayContext = {
            rules: shift ? (shift.data() as ShiftRules) : DEFAULT_RULES,
            shiftId: shift ? shift.id : null,
            shiftName: shift ? (shift.get('name') as string) : null,
            weeklyOff: offs.includes(weekdayOf(day)),
            holiday: holidayOn.has(day) && holidayApplies(holidayOn.get(day), branchId),
            locked: false,
          };
          const prior = records[i].exists ? records[i] : undefined;
          const record = recordFor(orgId, e, day, ctx, ms(prior?.get('checkIn')), ms(prior?.get('checkOut')), (prior?.get('source') as string | undefined) ?? 'FINALIZE', leaveOf(prior), true);
          results.push(record);
          await put((b) => b.set(records[i].ref, { ...evaluationOf(record), finalized: true }, { merge: true }));
        }
        const summary = summarize(results);
        totalPayable += summary.payableDays;
        await put((b) =>
          b.set(db.doc(`orgs/${orgId}/attendanceSummaries/${e.id}_${m}`), {
            orgId,
            employeeId: e.id,
            employeeName: e.get('fullName'),
            employeeCode: e.get('code'),
            employeeUid: e.get('uid') ?? null,
            branchId,
            month: m,
            ...summary,
            stale: false,
            finalizeId,
            finalizedAt: FieldValue.serverTimestamp(),
          }),
        );
      }
      // People this month no longer covers here (moved to another branch, or not employed in it after all).
      const keep = new Set(employees.map((e) => e.id));
      for (const s of oldSummaries.docs) if (!keep.has(s.get('employeeId'))) await put((b) => b.delete(s.ref));
      await flush();

      await db.runTransaction(async (tx) => {
        const lock = await tx.get(ref);
        if (lock.get('status') !== 'FINALIZING' || lock.get('finalizeId') !== finalizeId)
          throw errors.conflict('FINALIZE_INTERRUPTED', 'Someone else finalized this month meanwhile. Check it before trying again.');
        tx.update(ref, {
          status: 'FINALIZED',
          employees: employees.length,
          finalizedBy: actor.uid,
          finalizedByEmail: actor.email,
          finalizedAt: FieldValue.serverTimestamp(),
          previousStatus: FieldValue.delete(),
          finalizingBy: FieldValue.delete(),
          finalizingAt: FieldValue.delete(),
        });
      });
    } catch (e) {
      await restoreLock(ref, finalizeId, previous);
      throw e;
    }
    await recordAuditNow(auditCtx(actor), orgId, {
      action: 'attendance.finalize',
      entityType: 'attendanceMonth',
      entityId: lockId(m, branchId),
      branchId,
      after: { month: m, employees: covered, payableDays: totalPayable },
    });
    return { month: m, employees: covered };
  },
);

/** Puts back the lock of a month whose finalization failed (unless another run has taken it over). */
async function restoreLock(ref: DocumentReference, finalizeId: string, previous: string | null) {
  try {
    await db.runTransaction(async (tx) => {
      const lock = await tx.get(ref);
      if (lock.get('status') !== 'FINALIZING' || lock.get('finalizeId') !== finalizeId) return;
      if (previous === null) tx.delete(ref);
      else tx.update(ref, { status: previous, previousStatus: FieldValue.delete(), finalizingBy: FieldValue.delete(), finalizingAt: FieldValue.delete() });
    });
  } catch (e) {
    logger.error(`attendance-finalize: could not restore ${ref.path} after a failure`, e);
  }
}

/** Reopens a finalized month so days can be corrected; summaries are marked out of date until it is finalized again. */
export const reopen = command(
  'attendance-reopen',
  z.strictObject({ orgId: id, month, branchId: id.nullable(), reason }),
  async ({ actor, input, requestId }, tx) => {
    await requireFor(actor, 'attendance.finalize', input.orgId, input.branchId, tx);
    const ref = lockRef(input.orgId, input.month, input.branchId);
    const lock = await tx.get(ref);
    if (!lock.exists || lock.get('status') !== 'FINALIZED') throw errors.conflict('NOT_FINALIZED', 'This month is not finalized.');
    const summaries = await tx.get(db.collection(`orgs/${input.orgId}/attendanceSummaries`).where('month', '==', input.month).where('branchId', '==', input.branchId));
    // Payroll is worked out from this month: an approved or submitted run fixes it; a draft must be prepared again.
    const run = await tx.get(db.doc(`orgs/${input.orgId}/payrollRuns/${ref.id}`));
    if (run.exists && ['SUBMITTED', 'APPROVED'].includes(run.get('status'))) throw errors.conflict('PAYROLL_LOCKED', `Payroll for ${input.month} is ${run.get('status') === 'APPROVED' ? 'approved' : 'waiting for approval'}, so attendance can no longer change.`);
    if (run.exists) tx.update(run.ref, { stale: true, version: FieldValue.increment(1) });
    tx.update(ref, { status: 'REOPENED', reopenedBy: actor.uid, reopenReason: input.reason, reopenedAt: FieldValue.serverTimestamp() });
    for (const s of summaries.docs) tx.update(s.ref, { stale: true });
    recordAudit(tx, auditCtx(actor, requestId), input.orgId, {
      action: 'attendance.reopen',
      entityType: 'attendanceMonth',
      entityId: ref.id,
      branchId: input.branchId,
      before: { status: 'FINALIZED' },
      after: { status: 'REOPENED' },
      reason: input.reason,
    });
    return { month: input.month };
  },
);
