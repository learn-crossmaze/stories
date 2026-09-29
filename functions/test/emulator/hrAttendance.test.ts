import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as att from '../../src/hr/attendance.js';
import { businessDate, datesOfMonth, weekdayOf } from '../../src/hr/attendanceRules.js';
import * as schedule from '../../src/hr/schedule.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, hr: TestUser, bm: TestUser, lib: TestUser, worker: TestUser, outsider: TestUser;
let org: string, central: string, workerId: string, libId: string, shiftId: string;

// Last month (finalizable) and a few of its dates.
const today = businessDate(Date.now());
const [y, m] = today.slice(0, 7).split('-').map(Number);
const lastMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
const days = datesOfMonth(lastMonth);
const workdays = days.filter((d) => weekdayOf(d) !== 'SUN');
const [d1, d2, d3, d4] = workdays;

const rec = async (employeeId: string, day: string) => (await db.doc(`orgs/${org}/attendance/${employeeId}_${day}`).get()).data()!;
const adjust = (by: TestUser, employeeId: string, day: string, checkIn: string | null, checkOut: string | null) =>
  call<{ status: string }>(att.adjust, by, { orgId: org, employeeId, date: day, checkIn, checkOut, reason: 'Register entry' });

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, bm, lib, worker, outsider] = await Promise.all(['hr', 'bm', 'lib', 'worker', 'outsider'].map((n) => createUser(`${n}@stories.test`)));
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
  const idOf = async (u: TestUser) => (await db.collection(`orgs/${org}/employees`).where('uid', '==', u.uid).get()).docs[0].id;
  [workerId, libId] = await Promise.all([idOf(worker), idOf(lib)]);
  shiftId = (
    await call<{ shiftId: string }>(schedule.saveShift, hr, { orgId: org, name: 'Morning', start: '09:30', end: '18:00', breakMinutes: 30, graceMinutes: 10 })
  ).shiftId;
  await call(schedule.assignShift, bm, { orgId: org, employeeId: workerId, shiftId, weeklyOffs: ['SUN'] });
  await call(schedule.assignShift, bm, { orgId: org, employeeId: libId, shiftId, weeklyOffs: ['SUN'] });
});

describe('shifts and holidays', () => {
  it('HR configures; branch managers assign shifts only in their branch', async () => {
    expect(await failure(call(schedule.saveShift, bm, { orgId: org, name: 'Evening', start: '13:00', end: '21:30' }))).toBe('FORBIDDEN');
    expect(await failure(call(schedule.saveShift, hr, { orgId: org, name: 'Odd', start: '09:00', end: '17:00', halfDayMinutes: 500, fullDayMinutes: 480 }))).toBe('INVALID_INPUT');
    await call(schedule.saveHoliday, hr, { orgId: org, date: d3, name: 'Founders day' });
    expect((await db.doc(`orgs/${org}/holidays/${d3}`).get()).get('name')).toBe('Founders day');
    const w = (await db.doc(`orgs/${org}/employees/${workerId}`).get()).data()!;
    expect(w).toMatchObject({ shiftId, shiftName: 'Morning', weeklyOffs: ['SUN'] });
    expect(await failure(call(schedule.assignShift, lib, { orgId: org, employeeId: workerId, shiftId: null, weeklyOffs: null }))).toBe('FORBIDDEN');
  });
});

describe('check-in and check-out', () => {
  it('employees punch themselves; managers record for others at the desk', async () => {
    const inRes = await call<{ date: string; status: string }>(att.punch, worker, { orgId: org, punch: 'IN' });
    expect(inRes).toMatchObject({ date: today, status: 'IN_PROGRESS' });
    expect(await failure(call(att.punch, worker, { orgId: org, punch: 'IN' }))).toBe('ALREADY_IN');
    await call(att.punch, worker, { orgId: org, punch: 'OUT' });
    expect(await failure(call(att.punch, worker, { orgId: org, punch: 'OUT' }))).toBe('ALREADY_OUT');
    expect((await rec(workerId, today)).source).toBe('SELF');

    await call(att.punch, bm, { orgId: org, employeeId: libId, punch: 'IN' });
    expect(await rec(libId, today)).toMatchObject({ source: 'DESK', employeeUid: lib.uid, shiftName: 'Morning' });
    expect(await failure(call(att.punch, lib, { orgId: org, employeeId: workerId, punch: 'IN' }))).toBe('FORBIDDEN');
    expect(await failure(call(att.punch, outsider, { orgId: org, punch: 'IN' }))).toBe('NO_EMPLOYEE_RECORD');
  });
});

describe('adjustments and corrections', () => {
  it('managers adjust with a reason, never their own day; lateness follows the shift', async () => {
    expect((await adjust(bm, workerId, d1, '09:45', '18:30')).status).toBe('PRESENT');
    expect(await rec(workerId, d1)).toMatchObject({ late: true, lateMinutes: 15, workedMinutes: 495, source: 'ADJUSTED' });
    const bmId = (await db.collection(`orgs/${org}/employees`).where('uid', '==', bm.uid).get()).docs[0].id;
    expect(await failure(adjust(bm, bmId, d1, '09:30', '18:00'))).toBe('FORBIDDEN');
    expect(await failure(adjust(lib, workerId, d1, '09:30', '18:00'))).toBe('FORBIDDEN');
    expect(await failure(adjust(bm, workerId, d1, null, '18:00'))).toBe('INVALID_INPUT');
  });

  it('employees request corrections; someone else approves, which applies the times', async () => {
    const { correctionId } = await call<{ correctionId: string }>(att.requestCorrection, worker, { orgId: org, date: d2, checkIn: '09:30', checkOut: '14:00', reason: 'Forgot to check in' });
    expect(await failure(call(att.requestCorrection, worker, { orgId: org, date: d2, checkIn: '09:30', checkOut: '15:00', reason: 'Again' }))).toBe('ALREADY_REQUESTED');
    expect(await failure(call(att.decideCorrection, lib, { orgId: org, correctionId, decision: 'APPROVE' }))).toBe('FORBIDDEN');
    expect(await failure(call(att.decideCorrection, bm, { orgId: org, correctionId, decision: 'REJECT' }))).toBe('INVALID_INPUT');
    await call(att.decideCorrection, bm, { orgId: org, correctionId, decision: 'APPROVE' });
    expect(await rec(workerId, d2)).toMatchObject({ status: 'HALF_DAY', source: 'CORRECTION', correctionId });
    expect(await failure(call(att.decideCorrection, hr, { orgId: org, correctionId, decision: 'APPROVE' }))).toBe('NOT_PENDING');
  });
});

describe('month finalization', () => {
  it('fills every day, summarizes payable days, locks the month and reopens it', async () => {
    await call(schedule.saveHoliday, hr, { orgId: org, date: d3, name: 'Founders day' });
    await adjust(bm, workerId, d1, '09:30', '18:00'); // present
    await adjust(bm, workerId, d2, '09:30', '14:30'); // half day
    await adjust(bm, workerId, d4, '09:50', null); // missed check-out → half day at closing, late

    const pending = await call<{ correctionId: string }>(att.requestCorrection, lib, { orgId: org, date: d1, checkIn: '09:30', checkOut: '18:00', reason: 'Card reader down' });
    expect(await failure(call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null))).toBe('CORRECTIONS_PENDING');
    await call(att.decideCorrection, hr, { orgId: org, correctionId: pending.correctionId, decision: 'REJECT', note: 'No card log' });
    expect(await failure(call(att.finalize, bm, { orgId: org, month: lastMonth, branchId: central }, null))).toBe('FORBIDDEN');
    expect(await failure(call(att.finalize, hr, { orgId: org, month: today.slice(0, 7), branchId: central }, null))).toBe('INVALID_INPUT');

    const res = await call<{ employees: number }>(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    expect(res.employees).toBe(3); // bm, lib, worker (HR has no branch)
    const sundays = days.filter((d) => weekdayOf(d) === 'SUN').length;
    const summary = (await db.doc(`orgs/${org}/attendanceSummaries/${workerId}_${lastMonth}`).get()).data()!;
    expect(summary).toMatchObject({ present: 1, halfDays: 2, holidays: 1, weeklyOffs: sundays, lateDays: 1, missedCheckouts: 1, days: days.length });
    expect(summary.absent).toBe(days.length - 1 - 2 - 1 - sundays);
    expect(summary.payableDays).toBe(1 + 1 + 1 + sundays);
    expect(await rec(workerId, d3)).toMatchObject({ status: 'HOLIDAY', finalized: true });
    expect((await rec(libId, d1)).status).toBe('ABSENT'); // the rejected correction changed nothing

    expect(await failure(adjust(bm, workerId, d1, '09:30', '18:00'))).toBe('MONTH_FINALIZED');
    expect(await failure(call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null))).toBe('MONTH_FINALIZED');
    await call(att.reopen, hr, { orgId: org, month: lastMonth, branchId: central, reason: 'Late register entries' });
    expect((await db.doc(`orgs/${org}/attendanceSummaries/${workerId}_${lastMonth}`).get()).get('stale')).toBe(true);
    await adjust(bm, workerId, d3, '09:30', '18:00'); // worked on the holiday
    await call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    const again = (await db.doc(`orgs/${org}/attendanceSummaries/${workerId}_${lastMonth}`).get()).data()!;
    expect(again).toMatchObject({ present: 2, holidays: 0, stale: false });
  });
});
