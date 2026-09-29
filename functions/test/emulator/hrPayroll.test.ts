import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as att from '../../src/hr/attendance.js';
import { businessDate, datesOfMonth, weekdayOf } from '../../src/hr/attendanceRules.js';
import * as payroll from '../../src/hr/payroll.js';
import { computePay, DEFAULT_SETTINGS, NO_INPUTS } from '../../src/hr/payrollRules.js';
import * as schedule from '../../src/hr/schedule.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, hr: TestUser, fin: TestUser, bm: TestUser, lib: TestUser, worker: TestUser;
let org: string, central: string, workerId: string, libId: string, bmId: string, hrId: string;

const today = businessDate(Date.now());
const [y, mo] = today.slice(0, 7).split('-').map(Number);
const lastMonth = `${mo === 1 ? y - 1 : y}-${String(mo === 1 ? 12 : mo - 1).padStart(2, '0')}`;
const workdays = datesOfMonth(lastMonth).filter((d) => weekdayOf(d) !== 'SUN');

const earnings = (basic: number, hra: number, special: number) => [
  { code: 'BASIC', name: 'Basic', amount: basic },
  { code: 'HRA', name: 'House rent allowance', amount: hra },
  { code: 'SPECIAL', name: 'Special allowance', amount: special },
];
const salary = (by: TestUser, employeeId: string, basic: number, extra: Record<string, unknown> = {}) =>
  call(payroll.saveSalary, by, { orgId: org, employeeId, effectiveFrom: '2025-04', earnings: earnings(basic, basic * 0.4, basic * 0.3), pf: true, esi: true, pt: true, reason: 'Offer letter', ...extra });
const run = (m = lastMonth) => ({ orgId: org, month: m, branchId: central });
const runDoc = async () => (await db.doc(`orgs/${org}/payrollRuns/${lastMonth}_${central}`).get()).data()!;
const slip = async (employeeId: string) => (await db.doc(`orgs/${org}/payslips/${employeeId}_${lastMonth}`).get()).data()!;

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, fin, bm, lib, worker] = await Promise.all(['hr', 'fin', 'bm', 'lib', 'worker'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  for (const [u, roles, b] of [
    [hr, ['HR_ADMIN'], ['*']],
    [fin, ['FINANCE_ADMIN'], ['*']],
    [bm, ['BRANCH_MANAGER'], [central]],
    [lib, ['LIBRARIAN'], [central]],
    [worker, ['EMPLOYEE'], [central]],
  ] as const) {
    await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds: b });
  }
  const idOf = async (u: TestUser) => (await db.collection(`orgs/${org}/employees`).where('uid', '==', u.uid).get()).docs[0].id;
  [workerId, libId, bmId, hrId] = await Promise.all([idOf(worker), idOf(lib), idOf(bm), idOf(hr)]);
  for (const e of [workerId, libId, bmId]) await call(schedule.assignShift, bm, { orgId: org, employeeId: e, shiftId: null, weeklyOffs: ['SUN'] });
  for (const day of workdays.slice(0, 20)) {
    await call(att.adjust, bm, { orgId: org, employeeId: workerId, date: day, checkIn: '09:00', checkOut: '17:30', reason: 'Register' });
  }
});

describe('salary structures and settings', () => {
  it('HR saves structures for others; settings are versioned org-wide', async () => {
    expect(await failure(salary(bm, workerId, 20000))).toBe('FORBIDDEN');
    expect(await failure(salary(hr, hrId, 20000))).toBe('FORBIDDEN');
    expect(await failure(call(payroll.saveSalary, hr, { orgId: org, employeeId: workerId, effectiveFrom: '2025-04', earnings: [{ code: 'HRA', name: 'HRA', amount: 1000 }], pf: true, esi: true, pt: true, reason: 'x x' }))).toBe('INVALID_INPUT');
    expect(await salary(hr, workerId, 20000)).toMatchObject({ monthlyGross: 34000 });

    const settings = { orgId: org, effectiveFrom: lastMonth, pf: { ...DEFAULT_SETTINGS.pf }, esi: { ...DEFAULT_SETTINGS.esi }, pt: { ...DEFAULT_SETTINGS.pt, enabled: false } };
    expect(await failure(call(payroll.saveSettings, bm, settings))).toBe('FORBIDDEN');
    await call(payroll.saveSettings, hr, settings);
    expect((await db.doc(`orgs/${org}/payrollSettings/${lastMonth}`).get()).get('pt.enabled')).toBe(false);
  });
});

describe('payroll runs', () => {
  it('prepare from finalized attendance, fix problems, submit, reject, approve and publish', async () => {
    expect(await failure(call(payroll.prepare, hr, run(), null))).toBe('ATTENDANCE_NOT_FINALIZED');
    await call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    await salary(hr, workerId, 20000);
    expect(await failure(call(payroll.prepare, bm, run(), null))).toBe('FORBIDDEN');

    // The branch manager and librarian have no salary yet.
    expect(await call(payroll.prepare, hr, run(), null)).toMatchObject({ employees: 3, problems: 2 });
    expect(await failure(call(payroll.submit, hr, run()))).toBe('RUN_PROBLEMS');
    await salary(hr, bmId, 25000);
    await salary(hr, libId, 12000);
    await call(payroll.setInputs, hr, { orgId: org, employeeId: workerId, month: lastMonth, tds: 500, otherEarnings: [{ name: 'Festival bonus', amount: 2000 }] });
    expect((await runDoc()).stale).toBe(true);
    expect(await failure(call(payroll.submit, hr, run()))).toBe('RUN_STALE');
    expect(await call(payroll.prepare, hr, run(), null)).toMatchObject({ employees: 3, problems: 0 });

    const summary = (await db.doc(`orgs/${org}/attendanceSummaries/${workerId}_${lastMonth}`).get()).data()!;
    const expected = computePay({
      structure: { effectiveFrom: '2025-04', earnings: earnings(20000, 8000, 6000), pf: true, esi: true, pt: true },
      settings: DEFAULT_SETTINGS,
      month: lastMonth,
      payableDays: summary.payableDays,
      daysInMonth: datesOfMonth(lastMonth).length,
      inputs: { ...NO_INPUTS, tds: 500, otherEarnings: [{ name: 'Festival bonus', amount: 2000 }] },
    });
    expect(await slip(workerId)).toMatchObject({ published: false, tds: 500, gross: expected.gross, net: expected.net, pfEmployee: expected.pfEmployee, days: { payable: summary.payableDays } });
    const r = await runDoc();
    expect(r).toMatchObject({ status: 'DRAFT', employees: 3, problemCount: 0 });
    expect(r.totals.net).toBe((await slip(workerId)).net + (await slip(bmId)).net + (await slip(libId)).net);
    expect(await failure(call(payroll.downloadPayslip, worker, { orgId: org, employeeId: workerId, month: lastMonth }, null))).toBe('NOT_FOUND');

    await call(payroll.submit, hr, run());
    expect(await failure(call(payroll.setInputs, hr, { orgId: org, employeeId: workerId, month: lastMonth, tds: 0 }))).toBe('RUN_LOCKED');
    expect(await failure(call(att.reopen, hr, { orgId: org, month: lastMonth, branchId: central, reason: 'Late entries' }))).toBe('PAYROLL_LOCKED');
    expect(await failure(call(payroll.decide, hr, { ...run(), decision: 'APPROVE' }))).toBe('FORBIDDEN');
    expect(await failure(call(payroll.decide, fin, { ...run(), decision: 'REJECT' }))).toBe('INVALID_INPUT');
    await call(payroll.decide, fin, { ...run(), decision: 'REJECT', note: 'Check the bonus' });
    expect(await runDoc()).toMatchObject({ status: 'DRAFT', rejectNote: 'Check the bonus' });
    await call(payroll.submit, hr, run());
    await call(payroll.decide, fin, { ...run(), decision: 'APPROVE' });
    expect(await runDoc()).toMatchObject({ status: 'APPROVED', approvedBy: fin.uid });
    expect((await slip(workerId)).published).toBe(true);
    expect(await failure(call(payroll.prepare, hr, run(), null))).toBe('RUN_LOCKED');

    const pdf = await call<{ content: string; fileName: string }>(payroll.downloadPayslip, worker, { orgId: org, employeeId: workerId, month: lastMonth }, null);
    expect(Buffer.from(pdf.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(await failure(call(payroll.downloadPayslip, lib, { orgId: org, employeeId: workerId, month: lastMonth }, null))).toBe('NOT_FOUND');
    await call(payroll.downloadPayslip, fin, { orgId: org, employeeId: workerId, month: lastMonth }, null);
    const opened = await db.collection(`orgs/${org}/auditLogs`).where('action', '==', 'payslip.open').get();
    expect(opened.size).toBe(1);
  });

  it('the approver must not be the person who prepared or submitted', async () => {
    await call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    for (const [e, basic] of [[workerId, 20000], [libId, 12000], [bmId, 25000]] as const) await salary(hr, e, basic);
    // A franchise-style user holding both roles.
    const both = await createUser('both@stories.test');
    await call(staff.setRoles, sa, { orgId: org, email: both.email, roles: ['HR_ADMIN', 'FINANCE_ADMIN'], branchIds: ['*'] });
    await call(payroll.prepare, both, run(), null);
    await call(payroll.submit, both, run());
    expect(await failure(call(payroll.decide, both, { ...run(), decision: 'APPROVE' }))).toBe('FORBIDDEN');
    await call(payroll.decide, fin, { ...run(), decision: 'APPROVE' });
  });
});
