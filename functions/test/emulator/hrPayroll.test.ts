import { inflateSync } from 'node:zlib';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as att from '../../src/hr/attendance.js';
import { businessDate, datesOfMonth, weekdayOf } from '../../src/hr/attendanceRules.js';
import * as priv from '../../src/hr/employeePrivate.js';
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
const kinds = async (u: TestUser) => (await db.collection(`users/${u.uid}/notifications`).get()).docs.map((d) => d.get('kind') as string).sort();
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
    expect(await kinds(hr)).toEqual(['payroll.rejected']);
    expect(await runDoc()).toMatchObject({ status: 'DRAFT', rejectNote: 'Check the bonus' });
    await call(payroll.submit, hr, run());
    await call(payroll.decide, fin, { ...run(), decision: 'APPROVE' });
    expect(await kinds(hr)).toEqual(['payroll.approved', 'payroll.rejected']);
    expect((await kinds(worker)).filter((k) => !k.startsWith('attendance.'))).toEqual(['payslip.published']);
    expect(await kinds(fin)).toEqual([]);
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

  it('prepare claims the run first, refuses out-of-date attendance, and approval publishes only its own payslips', async () => {
    await call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    for (const [e, basic] of [[workerId, 20000], [libId, 12000], [bmId, 25000]] as const) await salary(hr, e, basic);
    const runRef = db.doc(`orgs/${org}/payrollRuns/${lastMonth}_${central}`);

    // Someone else is preparing it: nothing else may prepare or submit it meanwhile.
    await runRef.set({ orgId: org, month: lastMonth, branchId: central, status: 'PREPARING', prepareId: 'other', preparingAt: new Date() });
    expect(await failure(call(payroll.prepare, hr, run(), null))).toBe('RUN_PREPARING');
    expect(await failure(call(payroll.submit, hr, run()))).toBe('NOT_DRAFT');
    // A run left preparing (a crash) is taken over after a while.
    await runRef.update({ preparingAt: new Date(Date.now() - 60 * 60_000) });
    await call(payroll.prepare, hr, run(), null);
    const prepared = await runDoc();
    expect(prepared).toMatchObject({ status: 'DRAFT', stale: false, employees: 3 });
    expect(prepared.prepareId).not.toBe('other');
    expect((await slip(workerId)).prepareId).toBe(prepared.prepareId);

    // A summary out of date (attendance changed after finalizing) is refused; the run must be prepared again.
    const summary = db.doc(`orgs/${org}/attendanceSummaries/${workerId}_${lastMonth}`);
    await summary.update({ stale: true });
    expect(await failure(call(payroll.prepare, hr, run(), null))).toBe('ATTENDANCE_STALE');
    expect(await runDoc()).toMatchObject({ status: 'DRAFT', stale: true });
    await summary.update({ stale: false });
    await call(payroll.prepare, hr, run(), null);

    // A payslip left from another preparation is not published.
    const stray = db.doc(`orgs/${org}/payslips/ghost_${lastMonth}`);
    await stray.set({ ...(await slip(libId)), employeeId: 'ghost', prepareId: 'old', published: false });
    await call(payroll.submit, hr, run());
    await call(payroll.decide, fin, { ...run(), decision: 'APPROVE' });
    expect((await slip(workerId)).published).toBe(true);
    expect((await stray.get()).get('published')).toBe(false);
  });

  it('salary and settings changes mark draft runs stale and never change an approved month', async () => {
    await call(att.finalize, hr, { orgId: org, month: lastMonth, branchId: central }, null);
    for (const [e, basic] of [[workerId, 20000], [libId, 12000], [bmId, 25000]] as const) await salary(hr, e, basic);
    await call(payroll.prepare, hr, run(), null);
    expect((await runDoc()).stale).toBe(false);
    await salary(hr, workerId, 22000, { effectiveFrom: lastMonth, reason: 'Increment' });
    expect((await runDoc()).stale).toBe(true);

    await call(payroll.prepare, hr, run(), null);
    await call(payroll.submit, hr, run());
    await call(payroll.decide, fin, { ...run(), decision: 'APPROVE' });
    expect(await failure(salary(hr, workerId, 25000, { effectiveFrom: lastMonth, reason: 'Retro raise' }))).toBe('RUN_LOCKED');
    // An earlier version that the approved month doesn't use, or a later one, is fine.
    await salary(hr, workerId, 19000, { reason: 'Corrected history' });
    await salary(hr, workerId, 25000, { effectiveFrom: today.slice(0, 7), reason: 'Raise' });
    const settings = { orgId: org, effectiveFrom: lastMonth, pf: { ...DEFAULT_SETTINGS.pf }, esi: { ...DEFAULT_SETTINGS.esi }, pt: { ...DEFAULT_SETTINGS.pt, enabled: false } };
    expect(await failure(call(payroll.saveSettings, hr, settings))).toBe('RUN_LOCKED');
    await call(payroll.saveSettings, hr, { ...settings, effectiveFrom: today.slice(0, 7) });
    expect(await runDoc()).toMatchObject({ status: 'APPROVED' });
  });
});

/** The text a payslip PDF shows (pdf-lib writes standard-font text as hex strings, maybe deflated). */
function pdfText(base64: string): string {
  const raw = Buffer.from(base64, 'base64');
  const out: string[] = [];
  const latin = raw.toString('latin1');
  for (const m of latin.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = latin.indexOf('endstream', start);
    const body = raw.subarray(start, end);
    let text: string;
    try {
      text = inflateSync(body).toString('latin1');
    } catch {
      text = body.toString('latin1');
    }
    for (const t of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], 'hex').toString('latin1'));
    for (const t of text.matchAll(/\(([^)]*)\)\s*Tj/g)) out.push(t[1]);
  }
  return out.join(' ');
}

describe('who sees what, and who approves (franchise)', () => {
  it('keeps full PAN and UAN off payslips; people who changed the pay may not approve it', async () => {
    const fran = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Franchise', type: 'FRANCHISE' })).orgId;
    const fb = (await call<{ branchId: string }>(branches.create, sa, { orgId: fran, code: 'FRA', name: 'Franchise', address, contact })).branchId;
    const [fo, fo2, staffer] = await Promise.all(['fo', 'fo2', 'staffer'].map((n) => createUser(`${n}@stories.test`)));
    for (const [u, roles, b] of [
      [hr, ['HR_ADMIN'], ['*']],
      [fo, ['FRANCHISE_OWNER'], ['*']],
      [fo2, ['FRANCHISE_OWNER'], ['*']],
      [staffer, ['EMPLOYEE'], [fb]],
    ] as const) {
      await call(staff.setRoles, sa, { orgId: fran, email: u.email, roles, branchIds: b });
    }
    const empOf = async (u: TestUser) => (await db.collection(`orgs/${fran}/employees`).where('uid', '==', u.uid).get()).docs[0].id;
    const stafferId = await empOf(staffer);
    await call(priv.setPrivate, hr, { orgId: fran, employeeId: stafferId, pan: 'ABCDE1234F', uan: '100200300400' });
    await call(schedule.assignShift, hr, { orgId: fran, employeeId: stafferId, shiftId: null, weeklyOffs: ['SUN'] });
    await call(att.finalize, hr, { orgId: fran, month: lastMonth, branchId: fb }, null);
    await call(payroll.saveSalary, fo, { orgId: fran, employeeId: stafferId, effectiveFrom: '2025-04', earnings: earnings(15000, 6000, 3000), pf: true, esi: true, pt: true, reason: 'Offer letter' });
    const frun = { orgId: fran, month: lastMonth, branchId: fb };
    await call(payroll.prepare, hr, frun, null);

    const payslip = (await db.doc(`orgs/${fran}/payslips/${stafferId}_${lastMonth}`).get()).data()!;
    expect(payslip).toMatchObject({ panLast4: '234F', uanLast4: '0400' });
    expect(JSON.stringify(payslip)).not.toContain('ABCDE1234F');
    expect(JSON.stringify(payslip)).not.toContain('100200300400');
    // A franchise owner sees all payslips but not personal data: the PDF shows the last four only.
    const forOwner = pdfText((await call<{ content: string }>(payroll.downloadPayslip, fo, { orgId: fran, employeeId: stafferId, month: lastMonth }, null)).content);
    expect(forOwner).toContain('XXXXXX234F');
    expect(forOwner).not.toContain('ABCDE1234F');
    const forHr = pdfText((await call<{ content: string }>(payroll.downloadPayslip, hr, { orgId: fran, employeeId: stafferId, month: lastMonth }, null)).content);
    expect(forHr).toContain('ABCDE1234F');
    expect(forHr).toContain('100200300400');

    // The owner who set the salary may not approve the run; another owner may.
    await call(payroll.submit, hr, frun);
    expect((await db.doc(`orgs/${fran}/payrollRuns/${lastMonth}_${fb}`).get()).get('contributors')).toEqual([fo.uid]);
    expect(await failure(call(payroll.decide, fo, { ...frun, decision: 'APPROVE' }))).toBe('FORBIDDEN');
    await call(payroll.decide, fo2, { ...frun, decision: 'APPROVE' });
    const mine = pdfText((await call<{ content: string }>(payroll.downloadPayslip, staffer, { orgId: fran, employeeId: stafferId, month: lastMonth }, null)).content);
    expect(mine).toContain('ABCDE1234F');
  });
});
