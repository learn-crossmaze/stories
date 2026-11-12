import { randomUUID } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as att from '../../src/hr/attendance.js';
import { businessDate, datesOfMonth, weekdayOf } from '../../src/hr/attendanceRules.js';
import * as leave from '../../src/hr/leave.js';
import * as schedule from '../../src/hr/schedule.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// Faster attendance and leave: the punch answers with the day it wrote, several decisions run side by side,
// leave is recorded and approved in one step, and finalizing reads and writes a month in batches.

let sa: TestUser, hr: TestUser, bm: TestUser, lib: TestUser, worker: TestUser;
let org: string, central: string, workerId: string, libId: string;

const DAY = 86_400_000;
const today = businessDate(Date.now());
const yesterday = businessDate(Date.now() - DAY);
const thisMonth = today.slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const lastMonth = shift(thisMonth, -1);
const nextMonth = shift(thisMonth, 1);
const workdays = (month: string) => datesOfMonth(month).filter((d) => weekdayOf(d) !== 'SUN');
const [f1, f2, f3, f4] = workdays(nextMonth);
const futureYear = nextMonth.slice(0, 4);
const [p1, p2, p3] = workdays(lastMonth);

type Punch = { date: string; status: string; late: boolean; lateMinutes: number; earlyExit: boolean; missedCheckout: boolean; workedMinutes: number; checkIn: number | null; checkOut: number | null };

const path = (p: string) => db.doc(`orgs/${org}/${p}`);
const rec = async (employeeId: string, day: string) => (await path(`attendance/${employeeId}_${day}`).get()).data();
const balance = async (y: string) => (await path(`leaveBalances/${workerId}_${y}`).get()).data()!;
const kinds = async (u: TestUser) => (await db.collection(`users/${u.uid}/notifications`).get()).docs.map((d) => d.get('kind') as string).sort();
const audits = async (action: string) => (await db.collection(`orgs/${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());
const opening = (typeId: string, y: string, days: number) => call(leave.adjust, hr, { orgId: org, employeeId: workerId, typeId, year: y, days, reason: 'Opening balance' });
const lock = (month: string) => path(`attendanceLocks/${month}_${central}`);
const close = (month: string) => lock(month).set({ orgId: org, month, branchId: central, status: 'FINALIZED' });
const apply = (by: TestUser, input: Record<string, unknown>) => call<{ leaveId: string; days: number; status: string }>(leave.apply, by, { orgId: org, typeId: 'casual', ...input });

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, bm, lib, worker] = await Promise.all(['hr', 'bm', 'lib', 'worker'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  for (const [u, roles, b] of [
    [hr, ['HR_ADMIN'], ['*']],
    [bm, ['SENIOR_LIBRARIAN'], [central]],
    [lib, ['LIBRARIAN'], [central]],
    [worker, ['EMPLOYEE'], [central]],
  ] as const) {
    await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds: b });
  }
  const idOf = async (u: TestUser) => (await db.collection(`orgs/${org}/employees`).where('uid', '==', u.uid).get()).docs[0].id;
  [workerId, libId] = await Promise.all([idOf(worker), idOf(lib)]);
  const { shiftId } = await call<{ shiftId: string }>(schedule.saveShift, hr, { orgId: org, name: 'Morning', start: '09:30', end: '18:00', breakMinutes: 30, graceMinutes: 10 });
  await call(schedule.assignShift, bm, { orgId: org, employeeId: workerId, shiftId, weeklyOffs: ['SUN'] });
});

describe('the punch answers with the day it wrote', () => {
  it('returns the times and flags on check-in and check-out, and the same answer when replayed', async () => {
    const before = Date.now();
    const requestId = randomUUID();
    const inRes = await call<Punch>(att.punch, worker, { orgId: org, punch: 'IN' }, requestId);
    expect(inRes).toMatchObject({ date: today, status: 'IN_PROGRESS', checkOut: null, workedMinutes: 0, earlyExit: false, missedCheckout: false });
    expect(inRes.checkIn).toBeGreaterThanOrEqual(before);
    expect(inRes.checkIn).toBeLessThanOrEqual(Date.now());
    expect(typeof inRes.lateMinutes).toBe('number');
    expect(typeof inRes.late).toBe('boolean');
    // What was stored is what was answered.
    const stored = (await rec(workerId, today))!;
    expect((stored.checkIn as Timestamp).toMillis()).toBe(inRes.checkIn);
    expect(stored).toMatchObject({ late: inRes.late, lateMinutes: inRes.lateMinutes, status: 'IN_PROGRESS' });

    // The same request again: the stored answer, not a second punch.
    expect(await call<Punch>(att.punch, worker, { orgId: org, punch: 'IN' }, requestId)).toEqual(inRes);
    expect(await audits('attendance.checkIn')).toHaveLength(1);

    const outRes = await call<Punch>(att.punch, worker, { orgId: org, punch: 'OUT' });
    expect(outRes).toMatchObject({ date: today, checkIn: inRes.checkIn, lateMinutes: inRes.lateMinutes, late: inRes.late, missedCheckout: false });
    expect(outRes.checkOut).toBeGreaterThanOrEqual(inRes.checkIn!);
    const after = (await rec(workerId, today))!;
    expect((after.checkOut as Timestamp).toMillis()).toBe(outRes.checkOut);
    expect(after).toMatchObject({ status: outRes.status, workedMinutes: outRes.workedMinutes, earlyExit: outRes.earlyExit });
  });

  it('a desk punch answers the same way; a check-out that closes yesterday says so', async () => {
    const desk = await call<Punch>(att.punch, bm, { orgId: org, employeeId: libId, punch: 'IN' });
    expect(desk).toMatchObject({ date: today, status: 'IN_PROGRESS', checkOut: null });
    expect((await rec(libId, today))!.source).toBe('DESK');

    // An overnight day left open yesterday: the check-out belongs to it, not to today.
    const startedAt = Date.now() - 20 * 60 * 60_000;
    await path(`attendance/${workerId}_${yesterday}`).set({ orgId: org, employeeId: workerId, employeeUid: worker.uid, branchId: central, date: yesterday, month: yesterday.slice(0, 7), checkIn: Timestamp.fromMillis(startedAt), checkOut: null, status: 'IN_PROGRESS', source: 'SELF' });
    const out = await call<Punch>(att.punch, worker, { orgId: org, punch: 'OUT' });
    expect(out).toMatchObject({ date: yesterday, checkIn: startedAt });
    expect(out.checkOut).toBeGreaterThan(startedAt);
    expect(await rec(workerId, today)).toBeUndefined();
    expect(((await rec(workerId, yesterday))!.checkOut as Timestamp).toMillis()).toBe(out.checkOut);
  });

  it("refuses a check-out into yesterday when yesterday's month is finalized", async () => {
    await path(`attendance/${workerId}_${yesterday}`).set({ orgId: org, employeeId: workerId, employeeUid: worker.uid, branchId: central, date: yesterday, month: yesterday.slice(0, 7), checkIn: Timestamp.fromMillis(Date.now() - 20 * 60 * 60_000), checkOut: null, status: 'IN_PROGRESS', source: 'SELF' });
    await close(yesterday.slice(0, 7));
    expect(await failure(call(att.punch, worker, { orgId: org, punch: 'OUT' }))).toBe('MONTH_FINALIZED');
    expect((await rec(workerId, yesterday))!.checkOut).toBeNull();
  });
});

describe('several decisions at once', () => {
  it('two approvals for one employee run side by side: both land and the balance adds up', async () => {
    await opening('casual', futureYear, 5);
    const a = await apply(worker, { from: f1, to: f2, reason: 'Family wedding' });
    const b = await apply(worker, { from: f4, to: f4, reason: 'Errand' });
    expect((await balance(futureYear)).types.casual).toMatchObject({ pending: 3 });
    await Promise.all([a, b].map((r) => call(leave.decide, bm, { orgId: org, leaveId: r.leaveId, decision: 'APPROVE' })));
    expect((await balance(futureYear)).types.casual).toMatchObject({ pending: 0, used: 3 });
    for (const day of [f1, f2, f4]) expect(await rec(workerId, day)).toMatchObject({ status: 'ON_LEAVE', payable: 1 });
    expect(await rec(workerId, f3)).toBeUndefined();
    expect(await audits('leave.approve')).toHaveLength(2);
    expect(await kinds(worker)).toEqual(['leave.approved', 'leave.approved']);
  });

  it('one request decided twice at the same moment is approved once', async () => {
    await opening('casual', futureYear, 5);
    const { leaveId } = await apply(worker, { from: f1, to: f1, reason: 'Errand' });
    const results = await Promise.allSettled([bm, hr].map((by) => call(leave.decide, by, { orgId: org, leaveId, decision: 'APPROVE' })));
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(await failure(Promise.reject(refused[0].reason))).toBe('NOT_PENDING');
    expect((await balance(futureYear)).types.casual).toMatchObject({ pending: 0, used: 1 });
    expect(await audits('leave.approve')).toHaveLength(1);
  });

  it('leave across two months is refused while either month is finalized', async () => {
    // Two months of the same year, the first of them not in the future for a lock to make sense.
    const [first, second] = thisMonth.endsWith('-12') ? [lastMonth, thisMonth] : [thisMonth, nextMonth];
    const from = workdays(first).at(-1)!;
    const to = workdays(second)[0];
    const { leaveId } = await apply(worker, { typeId: 'lop', from, to, reason: 'Travel' });
    for (const month of [first, second]) {
      await close(month);
      expect(await failure(call(leave.decide, bm, { orgId: org, leaveId, decision: 'APPROVE' }))).toBe('MONTH_FINALIZED');
      await lock(month).delete();
    }
    await call(leave.decide, bm, { orgId: org, leaveId, decision: 'APPROVE' });
    expect(await rec(workerId, from)).toMatchObject({ status: 'ON_LEAVE', month: first });
    expect(await rec(workerId, to)).toMatchObject({ status: 'ON_LEAVE', month: second });
  });

  it('approving and cancelling work each day out from the shift, the days off and holidays as they are then', async () => {
    const { leaveId } = await apply(worker, { typeId: 'lop', from: p1, to: p3, reason: 'Personal' });
    // A holiday declared after the request was made.
    await call(schedule.saveHoliday, hr, { orgId: org, date: p2, name: 'Founders day' });
    await call(leave.decide, bm, { orgId: org, leaveId, decision: 'APPROVE' });
    for (const day of [p1, p2, p3]) expect(await rec(workerId, day)).toMatchObject({ status: 'ON_LEAVE', payable: 0, shiftName: 'Morning', shiftStart: '09:30', leave: { typeId: 'lop', paid: false, half: false } });
    // Without the leave, each past day is what it would have been.
    await call(leave.cancel, hr, { orgId: org, leaveId, note: 'Entered by mistake' });
    expect(await rec(workerId, p1)).toMatchObject({ status: 'ABSENT', leave: null });
    expect(await rec(workerId, p2)).toMatchObject({ status: 'HOLIDAY', payable: 1, leave: null });
    expect(await rec(workerId, p3)).toMatchObject({ status: 'ABSENT', shiftName: 'Morning' });
  });

  it('two corrections of one employee are approved side by side', async () => {
    const ask = (date: string) => call<{ correctionId: string }>(att.requestCorrection, worker, { orgId: org, date, checkIn: '09:30', checkOut: '18:00', reason: 'Forgot to check in' });
    const [a, b] = [await ask(p1), await ask(p2)];
    await Promise.all([a, b].map((c) => call(att.decideCorrection, bm, { orgId: org, correctionId: c.correctionId, decision: 'APPROVE' })));
    for (const day of [p1, p2]) expect(await rec(workerId, day)).toMatchObject({ status: 'PRESENT', source: 'CORRECTION' });
    expect(await audits('attendance.approveCorrection')).toHaveLength(2);
    expect(await kinds(worker)).toEqual(['correction.approved', 'correction.approved']);
  });
});

describe('leave recorded and approved in one step', () => {
  it('is approved at once: days used, attendance marked, one notice, both audit entries', async () => {
    await opening('casual', futureYear, 5);
    const res = await apply(bm, { employeeId: workerId, from: f1, to: f2, reason: 'Called in sick', approve: true });
    expect(res).toMatchObject({ days: 2, status: 'APPROVED' });
    const req = (await path(`leaveRequests/${res.leaveId}`).get()).data()!;
    expect(req).toMatchObject({ status: 'APPROVED', appliedBy: bm.uid, decidedBy: bm.uid, decidedByEmail: bm.email, decisionNote: null, days: 2 });
    expect(req.decidedAt).toBeInstanceOf(Timestamp);
    const casual = (await balance(futureYear)).types.casual;
    expect(casual).toMatchObject({ adjusted: 5, used: 2 });
    expect(casual.pending ?? 0).toBe(0);
    for (const day of [f1, f2]) expect(await rec(workerId, day)).toMatchObject({ status: 'ON_LEAVE', payable: 1, leave: { typeId: 'casual', paid: true, half: false } });
    const taken = (await path(`leaveLedger/${res.leaveId}_taken`).get()).data()!;
    expect(taken).toMatchObject({ kind: 'TAKEN', days: -2, typeId: 'casual', by: bm.uid, requestId: res.leaveId });
    // Told once, not once for recording and once for approving.
    expect(await kinds(worker)).toEqual(['leave.approved']);
    const notice = (await db.collection(`users/${worker.uid}/notifications`).get()).docs[0].data();
    expect(notice).toMatchObject({ title: `Casual leave recorded for you and approved: ${f1} – ${f2}`, body: null, link: '/me/leave' });
    expect((await audits('leave.apply')).map((a) => a.after)).toEqual([expect.objectContaining({ requestId: res.leaveId, days: 2, self: false, approved: true })]);
    expect((await audits('leave.approve')).map((a) => a.after)).toEqual([expect.objectContaining({ requestId: res.leaveId, days: 2 })]);
    // Nothing is left to decide.
    expect(await failure(call(leave.decide, hr, { orgId: org, leaveId: res.leaveId, decision: 'APPROVE' }))).toBe('NOT_PENDING');

    // Cancelling gives the days back, as for any approved leave.
    await call(leave.cancel, hr, { orgId: org, leaveId: res.leaveId, note: 'Came in after all' });
    const after = (await balance(futureYear)).types.casual;
    expect(after).toMatchObject({ adjusted: 5, used: 0 });
    expect(after.pending ?? 0).toBe(0);
    expect(await rec(workerId, f1)).toBeUndefined();
    expect((await path(`leaveLedger/${res.leaveId}_returned`).get()).get('days')).toBe(2);
  });

  it('without the option it still waits for a decision, as before', async () => {
    await opening('casual', futureYear, 5);
    const res = await apply(bm, { employeeId: workerId, from: f1, to: f1, reason: 'Called in sick' });
    expect(res.status).toBe('PENDING');
    expect((await balance(futureYear)).types.casual).toMatchObject({ pending: 1 });
    expect(await rec(workerId, f1)).toBeUndefined();
    expect(await kinds(worker)).toEqual(['leave.recorded']);
  });

  it('never for your own leave, never without leave.approve, never in a finalized month', async () => {
    await opening('casual', futureYear, 5);
    const bmId = (await db.collection(`orgs/${org}/employees`).where('uid', '==', bm.uid).get()).docs[0].id;
    expect(await failure(apply(worker, { from: f1, to: f1, reason: 'Errand', approve: true }))).toBe('FORBIDDEN');
    expect(await failure(apply(bm, { from: f1, to: f1, typeId: 'lop', reason: 'Errand', approve: true }))).toBe('FORBIDDEN');
    expect(await failure(apply(bm, { employeeId: bmId, from: f1, to: f1, typeId: 'lop', reason: 'Errand', approve: true }))).toBe('FORBIDDEN');
    expect(await failure(apply(lib, { employeeId: workerId, from: f1, to: f1, reason: 'Called in', approve: true }))).toBe('FORBIDDEN');
    await close(lastMonth);
    expect(await failure(apply(bm, { employeeId: workerId, typeId: 'lop', from: p1, to: p1, reason: 'Called in', approve: true }))).toBe('MONTH_FINALIZED');
    expect((await db.collection(`orgs/${org}/leaveRequests`).get()).empty).toBe(true);
    expect(await rec(workerId, p1)).toBeUndefined();
  });
});

describe('finalizing a month in batches', () => {
  const person = (n: number) => path(`employees/extra${n}`);
  const addPeople = (count: number) =>
    Promise.all(
      Array.from({ length: count }, (_, i) =>
        person(i).set({ orgId: org, code: `X${i}`, fullName: `Extra ${String(i).padStart(2, '0')}`, status: 'ACTIVE', joiningDate: null, exitDate: null, uid: null, branchId: central, shiftId: null, weeklyOffs: ['SUN'] }),
      ),
    );

  it('writes every day and every summary when the month needs more than one batch', async () => {
    await addPeople(13); // 16 people with bm, lib and the worker: more than 400 day records
    await call(att.adjust, bm, { orgId: org, employeeId: workerId, date: p1, checkIn: '09:30', checkOut: '18:00', reason: 'Register entry' });
    const res = await call<{ employees: number }>(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    expect(res.employees).toBe(16);
    const days = datesOfMonth(lastMonth);
    expect(res.employees * days.length).toBeGreaterThan(400);
    const records = await db.collection(`orgs/${org}/attendance`).where('month', '==', lastMonth).where('branchId', '==', central).get();
    expect(records.size).toBe(res.employees * days.length);
    expect(records.docs.every((d) => d.get('finalized') === true)).toBe(true);
    const summaries = await db.collection(`orgs/${org}/attendanceSummaries`).where('month', '==', lastMonth).where('branchId', '==', central).get();
    expect(summaries.size).toBe(res.employees);
    expect(summaries.docs.every((s) => s.get('days') === days.length && s.get('stale') === false)).toBe(true);
    expect(new Set(summaries.docs.map((s) => s.get('finalizeId'))).size).toBe(1);
    expect((await rec(workerId, p1))!).toMatchObject({ status: 'PRESENT', finalized: true, source: 'ADJUSTED' });
    expect((await lock(lastMonth).get()).data()).toMatchObject({ status: 'FINALIZED', employees: 16 });
  });

  it('a run that fails puts the month back as it was', async () => {
    // A damaged record (no employee code) cannot be written.
    await path('employees/broken').set({ orgId: org, fullName: 'Broken', status: 'ACTIVE', joiningDate: null, exitDate: null, uid: null, branchId: central });
    await expect(call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null)).rejects.toBeTruthy();
    expect((await lock(lastMonth).get()).exists).toBe(false);
    expect((await db.collection(`orgs/${org}/attendanceSummaries`).where('month', '==', lastMonth).get()).empty).toBe(true);
    // The month is open again: days can still be changed, and finalizing works once the record is mended.
    await call(att.adjust, bm, { orgId: org, employeeId: workerId, date: p1, checkIn: '09:30', checkOut: '18:00', reason: 'Register entry' });
    await path('employees/broken').update({ code: 'B1' });
    expect((await call<{ employees: number }>(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null)).employees).toBe(4);
    expect((await lock(lastMonth).get()).get('status')).toBe('FINALIZED');
  });
});
