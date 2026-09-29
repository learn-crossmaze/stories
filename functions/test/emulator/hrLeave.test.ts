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

let sa: TestUser, hr: TestUser, bm: TestUser, lib: TestUser, worker: TestUser;
let org: string, central: string, workerId: string;

const today = businessDate(Date.now());
const thisMonth = today.slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const lastMonth = shift(thisMonth, -1);
const nextMonth = shift(thisMonth, 1);
const workdays = (month: string) => datesOfMonth(month).filter((d) => weekdayOf(d) !== 'SUN');
// Future leave: the first working week of next month.
const [f1, f2, f3] = workdays(nextMonth);
const futureYear = nextMonth.slice(0, 4);
const [p1, p2] = workdays(lastMonth);
const pastYear = lastMonth.slice(0, 4);

const kinds = async (u: TestUser) => (await db.collection(`users/${u.uid}/notifications`).get()).docs.map((d) => d.get('kind') as string).sort();
const rec = async (day: string) => (await db.doc(`orgs/${org}/attendance/${workerId}_${day}`).get()).data();
const balance = async (y: string) => (await db.doc(`orgs/${org}/leaveBalances/${workerId}_${y}`).get()).data()!;
const opening = (typeId: string, y: string, days: number) => call(leave.adjust, hr, { orgId: org, employeeId: workerId, typeId, year: y, days, reason: 'Opening balance' });

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, bm, lib, worker] = await Promise.all(['hr', 'bm', 'lib', 'worker'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  for (const [u, roles, b] of [
    [hr, ['HR_ADMIN'], ['*']],
    [bm, ['BRANCH_MANAGER'], [central]],
    [lib, ['LIBRARIAN'], [central]],
    [worker, ['EMPLOYEE'], [central]],
  ] as const) {
    await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds: b });
  }
  workerId = (await db.collection(`orgs/${org}/employees`).where('uid', '==', worker.uid).get()).docs[0].id;
  await call(schedule.assignShift, bm, { orgId: org, employeeId: workerId, shiftId: null, weeklyOffs: ['SUN'] });
});

describe('leave balances', () => {
  it('accrual credits the month and the year once; HR adjusts with a reason', async () => {
    expect(await failure(call(leave.accrue, bm, { orgId: org, month: thisMonth }, null))).toBe('FORBIDDEN');
    const first = await call<{ employees: number }>(leave.accrue, hr, { orgId: org, month: thisMonth }, null);
    expect(first.employees).toBe(4);
    const y = thisMonth.slice(0, 4);
    expect((await balance(y)).types).toMatchObject({ casual: { credited: 1 }, sick: { credited: 12 }, earned: { credited: 1.25 } });
    expect((await call<{ employees: number }>(leave.accrue, hr, { orgId: org, month: thisMonth }, null)).employees).toBe(0);
    expect(await failure(call(leave.accrue, hr, { orgId: org, month: nextMonth }, null))).toBe('INVALID_INPUT');

    await opening('casual', y, 2.5);
    expect((await balance(y)).types.casual).toMatchObject({ credited: 1, adjusted: 2.5 });
    expect(await failure(opening('casual', y, -10))).toBe('INSUFFICIENT_BALANCE');
    expect(await failure(opening('lop', y, 2))).toBe('INVALID_INPUT');
    expect(await failure(call(leave.adjust, bm, { orgId: org, employeeId: workerId, typeId: 'casual', year: y, days: 1, reason: 'Gift' }))).toBe('FORBIDDEN');
    const ledger = await db.collection(`orgs/${org}/leaveLedger`).where('employeeId', '==', workerId).get();
    expect(ledger.docs.map((d) => d.get('kind')).sort()).toEqual(['ACCRUAL', 'ACCRUAL', 'ACCRUAL', 'ADJUST', 'CARRY']);
  });

  it('types granted by hand are never credited; HR configures types', async () => {
    expect(await failure(call(leave.saveType, bm, { orgId: org, name: 'Maternity leave', code: 'ML', paid: true, annualQuota: 0, accrual: 'MANUAL', allowHalfDay: false }))).toBe('FORBIDDEN');
    expect(await failure(call(leave.saveType, hr, { orgId: org, name: 'Study leave', code: 'ST', paid: true, annualQuota: 0, accrual: 'YEARLY', allowHalfDay: false }))).toBe('INVALID_INPUT');
    const { typeId } = await call<{ typeId: string }>(leave.saveType, hr, { orgId: org, name: 'Maternity leave', code: 'ML', paid: true, annualQuota: 0, accrual: 'MANUAL', allowHalfDay: false });
    await call(leave.archiveType, hr, { orgId: org, typeId: 'earned', reason: 'Not offered' });
    await call(leave.accrue, hr, { orgId: org, month: thisMonth }, null);
    const types = (await balance(thisMonth.slice(0, 4))).types;
    expect(types[typeId]).toBeUndefined();
    expect(types.earned).toBeUndefined();
    await opening(typeId, thisMonth.slice(0, 4), 182);
    expect((await balance(thisMonth.slice(0, 4))).types[typeId]).toMatchObject({ adjusted: 182 });
  });
});

describe('leave requests', () => {
  it('apply reserves days, approval marks attendance, cancelling gives them back', async () => {
    await opening('casual', futureYear, 5);
    const { leaveId, days } = await call<{ leaveId: string; days: number }>(leave.apply, worker, { orgId: org, typeId: 'casual', from: f1, to: f3, reason: 'Family wedding' });
    expect(days).toBe(3);
    expect((await balance(futureYear)).types.casual).toMatchObject({ adjusted: 5, pending: 3 });
    expect(await failure(call(leave.apply, worker, { orgId: org, typeId: 'casual', from: f2, to: f2, reason: 'Again' }))).toBe('OVERLAPS');
    expect(await failure(call(leave.apply, worker, { orgId: org, typeId: 'earned', from: f1, to: f1, halfDay: 'FIRST', reason: 'Errand' }))).toBe('INVALID_INPUT');
    const later = workdays(nextMonth).slice(5, 8);
    expect(await failure(call(leave.apply, worker, { orgId: org, typeId: 'casual', from: later[0], to: later[2], reason: 'Trip' }))).toBe('INSUFFICIENT_BALANCE');

    expect(await failure(call(leave.decide, lib, { orgId: org, leaveId, decision: 'APPROVE' }))).toBe('FORBIDDEN');
    expect(await failure(call(leave.decide, bm, { orgId: org, leaveId, decision: 'REJECT' }))).toBe('INVALID_INPUT');
    expect(await kinds(worker)).toEqual([]); // applying for yourself tells nobody
    await call(leave.decide, bm, { orgId: org, leaveId, decision: 'APPROVE' });
    expect(await kinds(worker)).toEqual(['leave.approved']);
    const notice = (await db.collection(`users/${worker.uid}/notifications`).get()).docs[0].data();
    expect(notice).toMatchObject({ orgId: org, read: false, link: '/me/leave', title: `Casual leave ${f1} – ${f3} approved` });
    expect((await balance(futureYear)).types.casual).toMatchObject({ pending: 0, used: 3 });
    expect(await rec(f2)).toMatchObject({ status: 'ON_LEAVE', payable: 1, leave: { typeId: 'casual', paid: true, half: false } });
    expect(await failure(call(leave.decide, hr, { orgId: org, leaveId, decision: 'APPROVE' }))).toBe('NOT_PENDING');

    await call(leave.cancel, worker, { orgId: org, leaveId });
    expect(await kinds(worker)).toEqual(['leave.approved']); // cancelling your own leave tells nobody
    expect((await balance(futureYear)).types.casual).toMatchObject({ used: 0 });
    expect(await rec(f2)).toBeUndefined();
    expect((await db.doc(`orgs/${org}/leaveRequests/${leaveId}`).get()).get('status')).toBe('CANCELLED');
  });

  it('past leave counts in the month; pending leave blocks finalizing; the finalized month is fixed', async () => {
    await opening('sick', pastYear, 2);
    const half = await call<{ leaveId: string; days: number }>(leave.apply, hr, { orgId: org, employeeId: workerId, typeId: 'sick', from: p1, to: p1, halfDay: 'FIRST', reason: 'Doctor visit' });
    expect(half.days).toBe(0.5);
    const lop = await call<{ leaveId: string }>(leave.apply, worker, { orgId: org, typeId: 'lop', from: p2, to: p2, reason: 'Personal' });
    expect(await failure(call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null))).toBe('LEAVE_PENDING');
    await call(leave.decide, bm, { orgId: org, leaveId: half.leaveId, decision: 'APPROVE' });
    await call(leave.decide, bm, { orgId: org, leaveId: lop.leaveId, decision: 'APPROVE' });
    // Worked the afternoon of the half day.
    await call(att.adjust, bm, { orgId: org, employeeId: workerId, date: p1, checkIn: '13:00', checkOut: '17:30', reason: 'Register' });
    expect(await rec(p1)).toMatchObject({ status: 'HALF_DAY', payable: 1, leaveDays: 0.5 });

    await call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    const summary = (await db.doc(`orgs/${org}/attendanceSummaries/${workerId}_${lastMonth}`).get()).data()!;
    expect(summary).toMatchObject({ leaveDays: 1.5, paidLeaveDays: 0.5 });
    expect(await rec(p2)).toMatchObject({ status: 'ON_LEAVE', payable: 0 });

    expect(await failure(call(leave.cancel, worker, { orgId: org, leaveId: lop.leaveId }))).toBe('FORBIDDEN');
    expect(await failure(call(leave.cancel, hr, { orgId: org, leaveId: lop.leaveId, note: 'Entered by mistake' }))).toBe('MONTH_FINALIZED');
    expect(await failure(call(leave.apply, worker, { orgId: org, typeId: 'lop', from: workdays(lastMonth)[4], to: workdays(lastMonth)[4], reason: 'Late' }))).toBe('MONTH_FINALIZED');
  });
});
