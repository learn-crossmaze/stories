import { FieldValue, type DocumentSnapshot, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit, recordAuditNow } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import {
  atIST,
  businessDate,
  datesOfMonth,
  DEFAULT_RULES,
  evaluateDay,
  monthOf,
  type ShiftRules,
  summarize,
  type Weekday,
  weekdayOf,
} from './attendanceRules.js';
import { canFor, employeesCol, loadEmployee, requireFor } from './model.js';

/**
 * Attendance (docs/HRMS.md §8). One record per employee per business day:
 * orgs/{o}/attendance/{employeeId}_{date}. The server sets check-in and
 * check-out times; managers adjust with a reason; employees ask for
 * corrections; a finalized month (orgs/{o}/attendanceLocks/{month}_{branch})
 * no longer changes until it is reopened.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month (YYYY-MM)');

const recordRef = (orgId: string, employeeId: string, day: string) => db.doc(`orgs/${orgId}/attendance/${employeeId}_${day}`);
export const lockId = (m: string, branchId: string | null) => `${m}_${branchId ?? 'HO'}`;
const lockRef = (orgId: string, m: string, branchId: string | null) => db.doc(`orgs/${orgId}/attendanceLocks/${lockId(m, branchId)}`);
const auditCtx = (actor: Actor, requestId?: string) => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });

const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

interface DayContext {
  rules: ShiftRules;
  shiftId: string | null;
  shiftName: string | null;
  weeklyOff: boolean;
  holiday: boolean;
  locked: boolean;
}

/** Everything needed to evaluate a day (reads only). */
async function dayContext(tx: Transaction, orgId: string, employee: DocumentSnapshot, day: string): Promise<DayContext> {
  const branchId = (employee.get('branchId') as string | null) ?? null;
  const shiftId = (employee.get('shiftId') as string | null | undefined) ?? null;
  const [shift, branch, holiday, lock] = await Promise.all([
    shiftId ? tx.get(db.doc(`orgs/${orgId}/shifts/${shiftId}`)) : null,
    branchId ? tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`)) : null,
    tx.get(db.doc(`orgs/${orgId}/holidays/${day}`)),
    tx.get(lockRef(orgId, monthOf(day), branchId)),
  ]);
  const offs = ((employee.get('weeklyOffs') as Weekday[] | null | undefined) ?? (branch?.get('weeklyOffs') as Weekday[] | undefined) ?? []) as Weekday[];
  const hb = holiday.exists ? ((holiday.get('branchIds') as string[]) ?? []) : null;
  return {
    rules: shift?.exists ? (shift.data() as ShiftRules) : DEFAULT_RULES,
    shiftId: shift?.exists ? shiftId : null,
    shiftName: shift?.exists ? (shift.get('name') as string) : null,
    weeklyOff: offs.includes(weekdayOf(day)),
    holiday: hb !== null && (hb.length === 0 || (!!branchId && hb.includes(branchId))),
    locked: lock.exists && lock.get('status') === 'FINALIZED',
  };
}

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);

/** The full record for a day from its punches. */
function recordFor(orgId: string, employee: DocumentSnapshot, day: string, ctx: DayContext, checkIn: number | null, checkOut: number | null, source: string, closing = false) {
  const result = evaluateDay({ date: day, rules: ctx.rules, checkIn, checkOut, weeklyOff: ctx.weeklyOff, holiday: ctx.holiday, closing });
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
    ...result,
    source,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** The employee record linked to the caller (for their own punches and requests). */
async function ownEmployee(tx: Transaction, orgId: string, actor: Actor) {
  const snap = await tx.get(employeesCol(orgId).where('uid', '==', actor.uid).limit(1));
  if (snap.empty) throw errors.conflict('NO_EMPLOYEE_RECORD', "You don't have an employee record in this organization. Ask HR to add you.");
  return snap.docs[0];
}

function ensureWorking(employee: DocumentSnapshot) {
  if (!WORKING.includes(employee.get('status'))) throw errors.conflict('NOT_WORKING', `${employee.get('fullName')} is not currently employed here.`);
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

    const record = recordFor(input.orgId, employee, day, ctx, input.punch === 'IN' ? now : checkIn, input.punch === 'OUT' ? now : null, self ? 'SELF' : 'DESK');
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
  const record = recordFor(orgId, employee, day, ctx, inMs, outMs, source);
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

/**
 * Closes a month for a branch (`branchId: null` = head office staff): every
 * employed day gets a final record (missing days become absent, weekly off or
 * holiday; a missing check-out counts as a half day), each employee gets a
 * monthly summary with payable days, and the month is locked. Refused while
 * corrections wait for a decision. Safe to repeat after a reopen: record ids
 * are fixed and each run rewrites them.
 */
export const finalize = query(
  'attendance-finalize',
  z.strictObject({ orgId: id, month, branchId: id.nullable() }),
  async ({ actor, input }) => {
    const { orgId, branchId } = input;
    const m = input.month;
    await db.runTransaction(async (tx) => requireFor(actor, 'attendance.finalize', orgId, branchId, tx));
    if (m >= monthOf(businessDate(Date.now()))) throw errors.invalid('A month can be finalized once it is over.');
    const lock = await lockRef(orgId, m, branchId).get();
    if (lock.exists && lock.get('status') === 'FINALIZED') throw errors.conflict('MONTH_FINALIZED', 'This month is already finalized.');
    const pending = await db
      .collection(`orgs/${orgId}/attendanceCorrections`)
      .where('month', '==', m)
      .where('branchId', '==', branchId)
      .where('status', '==', 'PENDING')
      .get();
    if (!pending.empty) throw errors.conflict('CORRECTIONS_PENDING', `Decide the ${pending.size} correction${pending.size === 1 ? '' : 's'} waiting for approval first.`);

    const days = datesOfMonth(m);
    const [employees, shifts, holidays, branch, records] = await Promise.all([
      employeesFor(orgId, branchId, m),
      db.collection(`orgs/${orgId}/shifts`).get(),
      db.collection(`orgs/${orgId}/holidays`).where('date', '>=', days[0]).where('date', '<=', days.at(-1)!).get(),
      branchId ? db.doc(`orgs/${orgId}/branches/${branchId}`).get() : null,
      db.collection(`orgs/${orgId}/attendance`).where('month', '==', m).where('branchId', '==', branchId).get(),
    ]);
    const shiftById = new Map(shifts.docs.map((s) => [s.id, s]));
    const holidayOn = new Map(holidays.docs.map((h) => [h.id, (h.get('branchIds') as string[]) ?? []]));
    const existing = new Map(records.docs.map((r) => [r.id, r]));
    const branchOffs = ((branch?.get('weeklyOffs') as Weekday[] | undefined) ?? []) as Weekday[];

    let batch = db.batch();
    let ops = 0;
    const put = async (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => {
      batch.set(ref, data, { merge: true });
      if (++ops >= BATCH) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };
    let totalPayable = 0;
    for (const e of employees) {
      const shift = e.get('shiftId') ? shiftById.get(e.get('shiftId')) : undefined;
      const offs = ((e.get('weeklyOffs') as Weekday[] | null | undefined) ?? branchOffs) as Weekday[];
      const joined = (e.get('joiningDate') as string | null) ?? null;
      const exit = (e.get('exitDate') as string | null) ?? null;
      const results = [];
      for (const day of days) {
        if ((joined && day < joined) || (exit && day > exit)) continue;
        const hb = holidayOn.get(day);
        const ctx: DayContext = {
          rules: shift ? (shift.data() as ShiftRules) : DEFAULT_RULES,
          shiftId: shift ? shift.id : null,
          shiftName: shift ? (shift.get('name') as string) : null,
          weeklyOff: offs.includes(weekdayOf(day)),
          holiday: hb !== undefined && (hb.length === 0 || (!!branchId && hb.includes(branchId))),
          locked: false,
        };
        const prior = existing.get(`${e.id}_${day}`);
        const record = recordFor(orgId, e, day, ctx, ms(prior?.get('checkIn')), ms(prior?.get('checkOut')), (prior?.get('source') as string | undefined) ?? 'FINALIZE', true);
        results.push(record);
        await put(recordRef(orgId, e.id, day), { ...record, finalized: true });
      }
      const summary = summarize(results);
      totalPayable += summary.payableDays;
      await put(db.doc(`orgs/${orgId}/attendanceSummaries/${e.id}_${m}`), {
        orgId,
        employeeId: e.id,
        employeeName: e.get('fullName'),
        employeeCode: e.get('code'),
        employeeUid: e.get('uid') ?? null,
        branchId,
        month: m,
        ...summary,
        stale: false,
        finalizedAt: FieldValue.serverTimestamp(),
      });
    }
    await put(lockRef(orgId, m, branchId), {
      orgId,
      month: m,
      branchId,
      status: 'FINALIZED',
      employees: employees.length,
      finalizedBy: actor.uid,
      finalizedByEmail: actor.email,
      finalizedAt: FieldValue.serverTimestamp(),
    });
    if (ops) await batch.commit();
    await recordAuditNow(auditCtx(actor), orgId, {
      action: 'attendance.finalize',
      entityType: 'attendanceMonth',
      entityId: lockId(m, branchId),
      branchId,
      after: { month: m, employees: employees.length, payableDays: totalPayable },
    });
    return { month: m, employees: employees.length };
  },
);

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
