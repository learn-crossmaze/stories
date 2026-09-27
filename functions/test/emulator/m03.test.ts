import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { auth, db } from '../../src/core/firebase.js';
import * as branches from '../../src/branches/branches.js';
import * as departments from '../../src/departments/departments.js';
import * as orgs from '../../src/orgs/orgs.js';
import * as platform from '../../src/platform/bootstrap.js';
import * as staff from '../../src/staff/roles.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser;
let corp: string;
let fran: string;

async function newBranch(actor: TestUser, orgId: string, code: string) {
  return (await call<{ branchId: string }>(branches.create, actor, { orgId, code, name: `Branch ${code}`, address, contact })).branchId;
}

async function grant(actor: TestUser, orgId: string, user: TestUser, roles: string[], branchIds: string[]) {
  return call(staff.setRoles, actor, { orgId, email: user.email, roles, branchIds });
}

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  corp = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  fran = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Franchise Demo', type: 'FRANCHISE' })).orgId;
});

describe('callable pipeline', () => {
  it('rejects unauthenticated calls', async () => {
    expect(await failure(call(orgs.create, null, { name: 'X Org', type: 'CORPORATE' }))).toBe('UNAUTHENTICATED');
  });

  it('rejects invalid input with a readable message', async () => {
    await expect(call(branches.create, sa, { orgId: corp, code: '!', name: 'B', address, contact })).rejects.toThrow(/code/);
  });

  it('requires a requestId on commands', async () => {
    expect(await failure(call(orgs.create, sa, { name: 'X Org', type: 'CORPORATE' }, null))).toBe('INVALID_INPUT');
  });

  it('replays a retried command instead of repeating it', async () => {
    const requestId = randomUUID();
    const input = { orgId: corp, code: 'CEN', name: 'Stories Central', address, contact };
    const a = await call<{ branchId: string }>(branches.create, sa, input, requestId);
    const b = await call<{ branchId: string }>(branches.create, sa, input, requestId);
    expect(b.branchId).toBe(a.branchId);
    expect((await db.collection(`orgs/${corp}/branches`).get()).size).toBe(1);
  });

  it('writes an audit entry with every change', async () => {
    const branchId = await newBranch(sa, corp, 'CEN');
    const logs = await db.collection(`orgs/${corp}/auditLogs`).where('entityId', '==', branchId).get();
    expect(logs.docs.map((d) => d.get('action'))).toEqual(['branch.create']);
    expect(logs.docs[0].get('actorUid')).toBe(sa.uid);
  });
});

describe('organizations', () => {
  it('only super admins create organizations', async () => {
    const ho = await createUser('ho@stories.test');
    await grant(sa, corp, ho, ['HEAD_OFFICE_ADMIN'], ['*']);
    expect(await failure(call(orgs.create, ho, { name: 'Rogue Org', type: 'FRANCHISE' }))).toBe('FORBIDDEN');
  });
});

describe('bootstrap super admin', () => {
  it('lets only the configured, verified owner claim the first seat, once', async () => {
    const stranger = await createUser('someone@stories.test');
    expect(await failure(call(platform.bootstrapSuperAdmin, stranger, {}))).toBe('FORBIDDEN');

    const unverified = await createUser('owner@stories.test', { verified: false });
    expect(await failure(call(platform.bootstrapSuperAdmin, unverified, {}))).toBe('EMAIL_NOT_VERIFIED');

    const owner = { ...unverified, verified: true };
    await call(platform.bootstrapSuperAdmin, owner, {});
    expect((await auth.getUser(owner.uid)).customClaims?.sa).toBe(true);
    expect(await failure(call(platform.bootstrapSuperAdmin, owner, {}))).toBe('ALREADY_BOOTSTRAPPED');
  });
});

describe('branches', () => {
  it('keeps branch codes unique per org, even under concurrent creates', async () => {
    const results = await Promise.allSettled([newBranch(sa, corp, 'CEN'), newBranch(sa, corp, 'CEN'), newBranch(sa, corp, 'CEN')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await failure(newBranch(sa, corp, 'cen'))).toBe('BRANCH_CODE_TAKEN');
    await newBranch(sa, fran, 'CEN'); // another org may reuse the code
  });

  it('derives branch type from the organization', async () => {
    const b = await newBranch(sa, fran, 'FR1');
    expect((await db.doc(`orgs/${fran}/branches/${b}`).get()).get('type')).toBe('FRANCHISE');
  });

  it('isolates organizations: a franchise owner cannot touch another org', async () => {
    const fo = await createUser('fo@stories.test');
    await grant(sa, fran, fo, ['FRANCHISE_OWNER'], ['*']);
    await newBranch(fo, fran, 'FR1');
    expect(await failure(newBranch(fo, corp, 'HACK'))).toBe('FORBIDDEN');
  });

  it('denies roles without branches.manage and blocks edits to archived branches', async () => {
    const b = await newBranch(sa, corp, 'CEN');
    const lib = await createUser('lib@stories.test');
    await grant(sa, corp, lib, ['LIBRARIAN'], [b]);
    expect(await failure(call(branches.update, lib, { orgId: corp, branchId: b, name: 'Renamed' }))).toBe('FORBIDDEN');
    await call(branches.archive, sa, { orgId: corp, branchId: b, reason: 'Closed permanently' });
    expect(await failure(call(branches.update, sa, { orgId: corp, branchId: b, name: 'Renamed' }))).toBe('BRANCH_ARCHIVED');
  });
});

describe('departments', () => {
  it('lets HR create org-wide departments but not other orgs', async () => {
    const hr = await createUser('hr@stories.test');
    await grant(sa, corp, hr, ['HR_ADMIN'], ['*']);
    await call(departments.create, hr, { orgId: corp, name: 'Circulation' });
    expect(await failure(call(departments.create, hr, { orgId: fran, name: 'Circulation' }))).toBe('FORBIDDEN');
  });
});

describe('staff roles', () => {
  let central: string;
  let north: string;
  let bm: TestUser;

  beforeEach(async () => {
    central = await newBranch(sa, corp, 'CEN');
    north = await newBranch(sa, corp, 'NTH');
    bm = await createUser('bm@stories.test');
    await grant(sa, corp, bm, ['BRANCH_MANAGER', 'EMPLOYEE'], [central]);
  });

  it('syncs custom claims when roles change', async () => {
    const claims = (await auth.getUser(bm.uid)).customClaims;
    expect(claims?.o).toEqual({ [corp]: { r: ['BM', 'EMP'], b: [central] } });
    expect((await db.doc(`users/${bm.uid}`).get()).get('claimsVersion')).toBe(claims?.v);
  });

  it('lets a branch manager grant junior roles in their own branch only', async () => {
    const lib = await createUser('lib@stories.test');
    await grant(bm, corp, lib, ['LIBRARIAN'], [central]);
    expect(await failure(grant(bm, corp, lib, ['LIBRARIAN'], [north]))).toBe('FORBIDDEN');
    expect(await failure(grant(bm, corp, lib, ['LIBRARIAN'], ['*']))).toBe('FORBIDDEN');
    expect(await failure(grant(bm, corp, lib, ['BRANCH_MANAGER'], [central]))).toBe('FORBIDDEN');
  });

  it('blocks self-escalation and touching more senior staff', async () => {
    expect(await failure(grant(bm, corp, bm, ['BRANCH_MANAGER', 'LIBRARIAN'], [central]))).toBe('FORBIDDEN');
    const ho = await createUser('ho@stories.test');
    await grant(sa, corp, ho, ['HEAD_OFFICE_ADMIN'], ['*']);
    expect(await failure(call(staff.revoke, bm, { orgId: corp, uid: ho.uid, reason: 'testing' }))).toBe('FORBIDDEN');
  });

  it('validates role scope and org type', async () => {
    const x = await createUser('x@stories.test');
    expect(await failure(grant(sa, corp, x, ['HR_ADMIN'], [central]))).toBe('INVALID_INPUT');
    expect(await failure(grant(sa, corp, x, ['FRANCHISE_OWNER'], ['*']))).toBe('INVALID_INPUT');
    expect(await failure(grant(sa, fran, x, ['HEAD_OFFICE_ADMIN'], ['*']))).toBe('INVALID_INPUT');
    expect(await failure(grant(sa, corp, x, ['LIBRARIAN'], ['no-such-branch']))).toBe('NOT_FOUND');
  });

  it('requires the person to have signed up', async () => {
    expect(await failure(call(staff.setRoles, sa, { orgId: corp, email: 'nobody@stories.test', roles: ['EMPLOYEE'], branchIds: [central] }))).toBe('USER_NOT_FOUND');
  });

  it('revokes roles and clears claims, keeping history', async () => {
    await call(staff.revoke, sa, { orgId: corp, uid: bm.uid, reason: 'Left the company' });
    expect((await auth.getUser(bm.uid)).customClaims?.o).toEqual({});
    const m = await db.doc(`users/${bm.uid}/memberships/${corp}`).get();
    expect(m.get('status')).toBe('REVOKED');
    const log = await db.collection(`orgs/${corp}/auditLogs`).where('action', '==', 'staff.revoke').get();
    expect(log.docs[0].get('reason')).toBe('Left the company');
  });
});
