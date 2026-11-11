import { beforeEach, describe, expect, it } from 'vitest';

import { auth, db } from '../../src/core/firebase.js';
import { PERMISSION_CODES } from '../../src/generated/rbac.js';
import * as branches from '../../src/organization/branches.js';
import * as libraryRules from '../../src/organization/libraryRules.js';
import * as orgs from '../../src/organization/orgs.js';
import * as roles from '../../src/organization/roles.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, owner: TestUser, senior: TestUser, x: TestUser, y: TestUser;
let corp: string, cen: string, nth: string;

const tokenPerms = async (u: TestUser, orgId = corp) => {
  const p = ((await auth.getUser(u.uid)).customClaims?.o?.[orgId]?.p as string | undefined) ?? '';
  return (p.match(/../g) ?? []).map((c) => Object.entries(PERMISSION_CODES).find(([, v]) => v === c)?.[0]);
};
const save = (by: TestUser, input: Record<string, unknown>) => call<{ roleId: string }>(roles.save, by, { orgId: corp, ...input });
const give = (by: TestUser, u: TestUser, input: Record<string, unknown>) => call(staff.setRoles, by, { orgId: corp, email: u.email, roles: [], ...input });

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [owner, senior, x, y] = await Promise.all(['owner', 'senior', 'x', 'y'].map((n) => createUser(`${n}@stories.test`)));
  corp = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  cen = (await call<{ branchId: string }>(branches.create, sa, { orgId: corp, code: 'CEN', name: 'Central', address, contact })).branchId;
  nth = (await call<{ branchId: string }>(branches.create, sa, { orgId: corp, code: 'NTH', name: 'North', address, contact })).branchId;
  await give(sa, owner, { roles: ['BRANCH_OWNER'], branchIds: [cen] });
  await give(sa, senior, { roles: ['SENIOR_LIBRARIAN'], branchIds: [cen] });
});

describe('roles of the organization’s own', () => {
  it('a Branch Owner makes roles only from what they may do, for their own branches', async () => {
    const { roleId } = await save(owner, { name: 'Shelver', permissions: ['books.view', 'copies.manage'], branchIds: [cen] });
    expect((await db.doc(`roles/${roleId}`).get()).data()).toMatchObject({ orgId: corp, branchIds: [cen], createdBy: owner.uid });
    // Payroll is organization-wide: a Branch Owner of one branch doesn't hold it.
    expect(await failure(save(owner, { name: 'Payroll clerk', permissions: ['payroll.run'], branchIds: [cen] }))).toBe('FORBIDDEN');
    expect(await failure(save(owner, { name: 'Shelver North', permissions: ['books.view'], branchIds: [nth] }))).toBe('FORBIDDEN');
    expect(await failure(save(owner, { name: 'Everywhere', permissions: ['books.view'], branchIds: ['*'] }))).toBe('FORBIDDEN');
    expect(await failure(save(owner, { name: 'All orgs', permissions: ['books.view'], everyOrg: true }))).toBe('FORBIDDEN');
    // Senior librarians give roles but don't make them.
    expect(await failure(save(senior, { name: 'Helper', permissions: ['books.view'], branchIds: [cen] }))).toBe('FORBIDDEN');
    // Names are unique, ready-made ones included; Super Admin-only permissions never go in a role.
    expect(await failure(save(owner, { name: 'shelver', permissions: ['books.view'], branchIds: [cen] }))).toBe('ROLE_NAME_TAKEN');
    expect(await failure(save(sa, { name: 'Librarian', permissions: ['books.view'] }))).toBe('ROLE_NAME_TAKEN');
    expect(await failure(save(sa, { name: 'Org maker', permissions: ['org.manage'] }))).toBe('INVALID_INPUT');
  });

  it('gives a role: its permissions reach the token, only where it may be given, and only by those who hold them all', async () => {
    const { roleId } = await save(owner, { name: 'Shelver', permissions: ['books.view', 'copies.manage'], branchIds: [cen] });
    await give(owner, x, { customRoles: [roleId], branchIds: [cen] });
    expect((await tokenPerms(x)).sort()).toEqual(['books.view', 'copies.manage']);
    const m = (await db.doc(`users/${x.uid}/memberships/${corp}`).get()).data()!;
    expect(m).toMatchObject({ roles: [], customRoles: [roleId], customPerms: ['books.view', 'copies.manage'], customRoleNames: ['Shelver'] });
    // Not outside the branches it may be given at, even by a Super Admin.
    expect(await failure(give(sa, y, { customRoles: [roleId], branchIds: [nth] }))).toBe('FORBIDDEN');
    // A Senior Librarian holds both permissions, so may give it; not a role with more than they hold.
    await give(senior, y, { customRoles: [roleId], branchIds: [cen] });
    const { roleId: payments } = await save(sa, { name: 'Refunds desk', permissions: ['payments.refund', 'deposits.approve'] });
    expect(await failure(give(senior, y, { customRoles: [payments], branchIds: [cen] }))).toBe('FORBIDDEN');
    // …and may not touch someone holding it.
    await give(sa, y, { customRoles: [payments], branchIds: [cen] });
    expect(await failure(call(staff.revoke, senior, { orgId: corp, uid: y.uid, reason: 'Left the branch' }))).toBe('FORBIDDEN');
    // Organization-wide permissions in a role count only with all branches.
    expect(await tokenPerms(y)).toEqual(['payments.refund'].map(String));
  });

  it('changing a role changes what its holders may do straight away; it is deleted only when no one holds it', async () => {
    const { roleId } = await save(owner, { name: 'Shelver', permissions: ['books.view'], branchIds: [cen] });
    await give(owner, x, { customRoles: [roleId], branchIds: [cen] });
    await save(owner, { roleId, name: 'Shelving assistant', permissions: ['books.view', 'copies.manage', 'books.transfer'], branchIds: [cen] });
    expect((await tokenPerms(x)).sort()).toEqual(['books.transfer', 'books.view', 'copies.manage']);
    expect((await db.doc(`users/${x.uid}/memberships/${corp}`).get()).get('customRoleNames')).toEqual(['Shelving assistant']);
    // A Branch Owner can't change a role into one they couldn't have made.
    expect(await failure(save(owner, { roleId, name: 'Shelving assistant', permissions: ['payroll.run'], branchIds: [cen] }))).toBe('FORBIDDEN');
    // Holders keep fitting the branches it may be given at.
    expect(await failure(save(sa, { roleId, name: 'Shelving assistant', permissions: ['books.view'], branchIds: [nth] }))).toBe('ROLE_HELD_ELSEWHERE');

    const list = await call<{ custom: { id: string; holders: number; canEdit: boolean; canGive: boolean }[]; standard: { key: string; holders: number }[] }>(roles.list, owner, { orgId: corp }, null);
    expect(list.custom).toEqual([expect.objectContaining({ id: roleId, holders: 1, canEdit: true, canGive: true })]);
    expect(list.standard.find((r) => r.key === 'BRANCH_OWNER')?.holders).toBe(1);
    expect(await failure(call(roles.list, x, { orgId: corp }, null))).toBe('FORBIDDEN');

    expect(await failure(call(roles.remove, owner, { orgId: corp, roleId }))).toBe('ROLE_HELD');
    await call(staff.revoke, owner, { orgId: corp, uid: x.uid, reason: 'Moved on' });
    expect(await tokenPerms(x)).toEqual([]);
    await call(roles.remove, owner, { orgId: corp, roleId });
    expect((await db.doc(`roles/${roleId}`).get()).exists).toBe(false);
  });

  it('a Branch Owner with all branches holds the organization’s settings, HR and payroll', async () => {
    await give(sa, x, { roles: ['BRANCH_OWNER'], branchIds: ['*'] });
    const perms = await tokenPerms(x);
    expect(perms).toEqual(expect.arrayContaining(['payroll.run', 'config.manage', 'roles.manage', 'leave.approve']));
    expect(await tokenPerms(owner)).not.toContain('payroll.run');
  });
});

describe('Master control → Library rules', () => {
  it('reads defaults and saves changes for those with config.manage (all branches)', async () => {
    expect(await failure(call(libraryRules.get, owner, { orgId: corp }, null))).toBe('FORBIDDEN');
    const first = await call<{ rules: { reservationHoldHours: number; makerCheckerThresholdMinor: number } }>(libraryRules.get, sa, { orgId: corp }, null);
    expect(first.rules).toEqual({ reservationHoldHours: 48, makerCheckerThresholdMinor: 0 });
    await give(sa, x, { roles: ['BRANCH_OWNER'], branchIds: ['*'] });
    await call(libraryRules.set, x, { orgId: corp, reservationHoldHours: 72, makerCheckerThresholdMinor: 50000 });
    expect((await db.doc(`orgs/${corp}/config/circulation`).get()).get('reservationHoldHours')).toBe(72);
    expect((await db.doc(`orgs/${corp}/config/deposits`).get()).get('makerCheckerThresholdMinor')).toBe(50000);
    expect(await failure(call(libraryRules.set, x, { orgId: corp, reservationHoldHours: 0, makerCheckerThresholdMinor: 0 }))).toBe('INVALID_INPUT');
  });
});
