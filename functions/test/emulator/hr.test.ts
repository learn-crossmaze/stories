import { beforeEach, describe, expect, it } from 'vitest';

import * as branches from '../../src/organization/branches.js';
import * as departments from '../../src/organization/departments.js';
import { db } from '../../src/core/firebase.js';
import * as emp from '../../src/hr/employees.js';
import * as hrSettings from '../../src/hr/settings.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, hr: TestUser, fin: TestUser, bm: TestUser, lib: TestUser;
let org: string, central: string, north: string;

const employees = async () => (await db.collection(`orgs/${org}/employees`).get()).docs;
const employee = async (id: string) => (await db.doc(`orgs/${org}/employees/${id}`).get()).data()!;
const grant = (u: TestUser, roles: string[], branchIds: string[], employeeId = '') =>
  call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds, employeeId });
const hire = (fullName: string, extra: Record<string, unknown> = {}) =>
  call<{ employeeId: string; code: string; linked: boolean }>(emp.create, hr, { orgId: org, fullName, branchId: central, ...extra });
const move = (employeeId: string, transition: string, extra: Record<string, unknown> = {}, by = hr) =>
  call<{ status: string }>(emp.transition, by, { orgId: org, employeeId, transition, ...extra });
async function tickAll(employeeId: string, list: 'onboarding' | 'offboarding') {
  for (const item of (await employee(employeeId))[list] as { key: string; required: boolean }[]) {
    if (item.required) await call(emp.checkItem, hr, { orgId: org, employeeId, list, key: item.key, done: true });
  }
}

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, fin, bm, lib] = await Promise.all(['hr', 'fin', 'bm', 'lib'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await grant(hr, ['HR_ADMIN'], ['*']);
  await grant(fin, ['FINANCE_ADMIN'], ['*']);
  await grant(bm, ['BRANCH_MANAGER'], [central]);
});

describe('employee records', () => {
  it('granting roles creates one employee record per person, and never a duplicate', async () => {
    const all = await employees();
    expect(all).toHaveLength(3);
    const bmRec = all.find((d) => d.get('uid') === bm.uid)!;
    expect(bmRec.get('status')).toBe('ACTIVE');
    expect(bmRec.get('branchId')).toBe(central);
    expect(bmRec.get('source')).toBe('ROLES');
    // Changing roles keeps the same record and ID.
    await grant(bm, ['BRANCH_MANAGER', 'LIBRARIAN'], [central, north]);
    expect(await employees()).toHaveLength(3);
    const membership = (await db.doc(`users/${bm.uid}/memberships/${org}`).get()).data()!;
    expect(membership.employeeId).toBe(bmRec.get('code'));
    expect((await db.doc(`orgs/${org}/employeeIds/${bmRec.get('code')}`).get()).data()).toEqual({ uid: bm.uid, employeeDocId: bmRec.id });
  });

  it('HR adds a draft record; granting roles later links it by email instead of duplicating', async () => {
    const newcomer = await createUser('new@stories.test');
    await db.doc(`users/${newcomer.uid}`).delete(); // account exists but has not signed in yet
    const { employeeId, code, linked } = await hire('Neha Kapoor', { email: 'NEW@stories.test', phone: '9876543210' });
    expect(code).toBe('EMP-0004');
    expect(linked).toBe(true); // the Stories account exists
    expect((await employee(employeeId)).status).toBe('DRAFT');

    const walkIn = await hire('Ravi Kumar', { email: 'ravi@stories.test' });
    expect(walkIn.linked).toBe(false);
    const ravi = await createUser('ravi@stories.test');
    await grant(ravi, ['LIBRARIAN'], [central]);
    const rec = await employee(walkIn.employeeId);
    expect(rec.uid).toBe(ravi.uid);
    expect(rec.status).toBe('DRAFT'); // roles don't change the HR status
    expect(await employees()).toHaveLength(5);
    expect((await db.doc(`users/${ravi.uid}/memberships/${org}`).get()).get('employeeId')).toBe(walkIn.code);

    expect(await failure(hire('Someone Else', { email: 'ravi@stories.test' }))).toBe('DUPLICATE_EMPLOYEE');
    expect(await failure(hire('Code Clash', { employeeId: walkIn.code }))).toBe('EMPLOYEE_ID_TAKEN');
  });

  it('links an account later and replaces a roles-only employee ID', async () => {
    const { employeeId, code } = await hire('Anita Das');
    await grant(lib, ['LIBRARIAN'], [central]); // creates its own roles-only record first
    const rolesOnly = (await employees()).find((d) => d.get('uid') === lib.uid)!;
    expect(await failure(call(emp.linkAccount, hr, { orgId: org, employeeId, email: lib.email }))).toBe('DUPLICATE_EMPLOYEE');

    const other = await createUser('anita@stories.test');
    await call(emp.linkAccount, hr, { orgId: org, employeeId, email: other.email });
    expect((await employee(employeeId)).uid).toBe(other.uid);
    expect(await failure(call(emp.linkAccount, hr, { orgId: org, employeeId, email: other.email }))).toBe('ALREADY_LINKED');
    await grant(other, ['EMPLOYEE'], [central]);
    expect((await db.doc(`users/${other.uid}/memberships/${org}`).get()).get('employeeId')).toBe(code);
    expect(rolesOnly.get('code')).not.toBe(code);
  });

  it('backfills staff who had roles before People existed, keeping their IDs; safe to repeat', async () => {
    // Simulate older data: a membership with an employee ID but no employee record.
    const old = await createUser('old@stories.test');
    await db.doc(`users/${old.uid}/memberships/${org}`).set({
      orgId: org, orgName: 'Stories Corporate', orgType: 'CORPORATE', uid: old.uid, email: old.email, displayName: 'Old Timer',
      roles: ['LIBRARIAN'], branchIds: [north], status: 'ACTIVE', employeeId: 'LEGACY-7',
    });
    await db.doc(`orgs/${org}/employeeIds/LEGACY-7`).set({ uid: old.uid });
    const noCode = await createUser('nocode@stories.test');
    await db.doc(`users/${noCode.uid}/memberships/${org}`).set({
      orgId: org, orgName: 'Stories Corporate', orgType: 'CORPORATE', uid: noCode.uid, email: noCode.email, displayName: null,
      roles: ['EMPLOYEE'], branchIds: ['*'], status: 'ACTIVE',
    });
    expect(await failure(call(emp.backfill, bm, { orgId: org }))).toBe('FORBIDDEN');
    expect(await call(emp.backfill, hr, { orgId: org })).toEqual({ created: 2, linked: 0, remaining: 0 });
    const recs = await employees();
    const legacy = recs.find((d) => d.get('uid') === old.uid)!;
    expect(legacy.get('code')).toBe('LEGACY-7');
    expect(legacy.get('branchId')).toBe(north);
    const fresh = recs.find((d) => d.get('uid') === noCode.uid)!;
    expect(fresh.get('code')).toMatch(/^EMP-\d{4}$/);
    expect(fresh.get('branchId')).toBeNull();
    expect((await db.doc(`users/${noCode.uid}/memberships/${org}`).get()).get('employeeId')).toBe(fresh.get('code'));
    expect(await call(emp.backfill, hr, { orgId: org })).toEqual({ created: 0, linked: 0, remaining: 0 });
    expect(await employees()).toHaveLength(5);
  });

  it('records job changes with their effective date in the history', async () => {
    const { designationId } = await call<{ designationId: string }>(hrSettings.createDesignation, hr, { orgId: org, name: 'Senior Librarian' });
    expect(await failure(call(hrSettings.createDesignation, hr, { orgId: org, name: 'senior librarian' }))).toBe('DUPLICATE');
    const { departmentId } = await call<{ departmentId: string }>(departments.create, sa, { orgId: org, name: 'Circulation', branchId: north });
    const { employeeId } = await hire('Meera Iyer');
    expect(await failure(call(emp.update, hr, { orgId: org, employeeId, fullName: 'Meera Iyer', branchId: central, departmentId }))).toBe('INVALID_INPUT');
    await call(emp.update, hr, { orgId: org, employeeId, fullName: 'Meera Iyer', branchId: north, departmentId, designationId, effectiveDate: '2026-10-01', note: 'Promotion' });
    const rec = await employee(employeeId);
    expect(rec).toMatchObject({ branchId: north, departmentName: 'Circulation', designationName: 'Senior Librarian' });
    const history = (await db.collection(`orgs/${org}/employees/${employeeId}/history`).where('type', '==', 'JOB_CHANGE').get()).docs.map((d) => d.data());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ effectiveDate: '2026-10-01', note: 'Promotion', changes: { branchId: { from: central, to: north }, designationId: { from: null, to: 'Senior Librarian' } } });
    // A branch manager can't edit records (view only).
    expect(await failure(call(emp.update, bm, { orgId: org, employeeId, fullName: 'X Y', branchId: north }))).toBe('FORBIDDEN');
  });
});

describe('lifecycle', () => {
  it('onboards, activates only with the checklist done, then offboards and ends access', async () => {
    const person = await createUser('joiner@stories.test');
    const { employeeId } = await hire('Arjun Mehta', { email: person.email });
    expect(await failure(move(employeeId, 'ACTIVATE'))).toBe('INVALID_TRANSITION');
    await move(employeeId, 'START_ONBOARDING');
    await grant(person, ['LIBRARIAN'], [central]);
    expect(await failure(move(employeeId, 'ACTIVATE', { date: '2026-10-01' }))).toBe('CHECKLIST_OPEN');
    expect(await failure(call(emp.checkItem, hr, { orgId: org, employeeId, list: 'offboarding', key: 'handover', done: true }))).toBe('INVALID_STATE');
    await tickAll(employeeId, 'onboarding');
    expect(await failure(move(employeeId, 'ACTIVATE'))).toBe('INVALID_INPUT'); // no joining date yet
    await move(employeeId, 'ACTIVATE', { date: '2026-10-01' });
    expect(await employee(employeeId)).toMatchObject({ status: 'ACTIVE', joiningDate: '2026-10-01' });

    expect(await failure(move(employeeId, 'RESIGN', { date: '2026-12-31' }))).toBe('INVALID_INPUT'); // reason required
    await move(employeeId, 'RESIGN', { date: '2026-12-31', reason: 'Moving to Pune' });
    await move(employeeId, 'WITHDRAW_RESIGNATION');
    await move(employeeId, 'RESIGN', { date: '2026-12-31', reason: 'Moving to Pune' });
    await move(employeeId, 'START_OFFBOARDING', { reason: 'Resigned' });
    expect((await employee(employeeId)).exitDate).toBe('2026-12-31');
    expect(await failure(move(employeeId, 'COMPLETE_OFFBOARDING'))).toBe('CHECKLIST_OPEN');
    await tickAll(employeeId, 'offboarding');
    await move(employeeId, 'COMPLETE_OFFBOARDING');
    expect((await employee(employeeId)).status).toBe('OFFBOARDED');
    const m = (await db.doc(`users/${person.uid}/memberships/${org}`).get()).data()!;
    expect(m).toMatchObject({ status: 'REVOKED', roles: [] });
    expect(await failure(grant(person, ['LIBRARIAN'], [central]))).toBe('EMPLOYEE_OFFBOARDED');

    await move(employeeId, 'REHIRE', { date: '2027-03-01' });
    expect(await employee(employeeId)).toMatchObject({ status: 'ONBOARDING', exitDate: null, joiningDate: '2027-03-01' });
    const statuses = (await db.collection(`orgs/${org}/employees/${employeeId}/history`).where('type', '==', 'STATUS').get()).size;
    expect(statuses).toBe(8);
  });

  it('uses the organization checklist templates, and nobody changes their own status', async () => {
    await call(hrSettings.setChecklists, hr, {
      orgId: org,
      onboarding: [{ key: 'contract', label: 'Contract signed', required: true }],
      offboarding: [{ key: 'keys', label: 'Keys returned', required: false }],
    });
    const { employeeId } = await hire('Kiran Rao', { joiningDate: '2026-10-05' });
    await move(employeeId, 'START_ONBOARDING');
    expect((await employee(employeeId)).onboarding).toEqual([{ key: 'contract', label: 'Contract signed', required: true, done: false, doneBy: null, doneAt: null }]);
    await tickAll(employeeId, 'onboarding');
    await move(employeeId, 'ACTIVATE');
    const hrRec = (await employees()).find((d) => d.get('uid') === hr.uid)!;
    expect(await failure(move(hrRec.id, 'START_OFFBOARDING', { date: '2026-12-01', reason: 'Testing' }))).toBe('FORBIDDEN');
    expect(await failure(move(employeeId, 'RESIGN', { date: '2026-12-01', reason: 'x y z' }, bm))).toBe('FORBIDDEN');
  });
});

describe('private and bank details', () => {
  it('keeps the account number out of client reach; revealing it is audited', async () => {
    const { employeeId } = await hire('Divya Nair');
    await call(emp.setPrivate, hr, { orgId: org, employeeId, pan: 'abcde1234f', dob: '1994-02-03', emergencyName: 'Suresh Nair', emergencyPhone: '9812345678' });
    expect(await failure(call(emp.setPrivate, hr, { orgId: org, employeeId, pan: 'BAD' }))).toBe('INVALID_INPUT');
    expect(await failure(call(emp.setPrivate, bm, { orgId: org, employeeId, pan: 'ABCDE1234F' }))).toBe('FORBIDDEN');
    await call(emp.setBank, fin, { orgId: org, employeeId, accountHolder: 'Divya Nair', accountNumber: '001234567890', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' });
    const profile = (await db.doc(`orgs/${org}/employees/${employeeId}/private/profile`).get()).data()!;
    expect(profile).toMatchObject({ pan: 'ABCDE1234F', dob: '1994-02-03', bank: { last4: '7890', ifsc: 'HDFC0001234' } });
    expect(JSON.stringify(profile)).not.toContain('001234567890');

    expect(await failure(call(emp.revealBank, bm, { orgId: org, employeeId }))).toBe('FORBIDDEN');
    expect(await call(emp.revealBank, hr, { orgId: org, employeeId })).toEqual({ accountNumber: '001234567890' });
    const log = await db.collection(`orgs/${org}/auditLogs`).where('action', '==', 'employee.revealBank').get();
    expect(log.docs.map((d) => d.get('actorUid'))).toEqual([hr.uid]);
  });
});
