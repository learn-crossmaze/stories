import type { Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { buildClaims } from '../../src/core/claims.js';
import { Actor, coversBranch, grantableBy, permissionsOf, rolesGrant } from '../../src/core/rbac.js';
import type { Membership } from '../../src/core/rbac.js';
import { PERMISSION_CODES } from '../../src/generated/rbac.js';

const m = (orgId: string, roles: Membership['roles'], branchIds: string[], status: Membership['status'] = 'ACTIVE', customPerms: Membership['customPerms'] = []): Membership => ({
  orgId, orgName: orgId, orgType: 'CORPORATE', uid: 'u', email: null, displayName: null, roles, branchIds, status, customRoles: customPerms.length ? ['r1'] : [], customPerms,
});
const decode = (p: string) => (p.match(/../g) ?? []).map((c) => Object.entries(PERMISSION_CODES).find(([, v]) => v === c)?.[0]);

describe('buildClaims', () => {
  it('encodes active memberships: role codes, branches, and every permission held as 2-character codes', () => {
    const c = buildClaims(3, { platformRoles: [], status: 'ACTIVE' }, [
      m('orgA', ['SENIOR_LIBRARIAN', 'EMPLOYEE'], ['b1']),
      m('orgB', ['LIBRARIAN'], ['b9'], 'REVOKED'),
    ]);
    expect(Object.keys(c.o)).toEqual(['orgA']);
    expect(c.o.orgA.r).toEqual(['SLIB', 'EMP']);
    expect(c.o.orgA.b).toEqual(['b1']);
    const perms = decode(c.o.orgA.p);
    expect(perms).toContain('leave.approve');
    expect(perms).toContain('tasks.execute');
    expect(perms).not.toContain('payroll.run');
  });

  it('includes roles of the organization’s own', () => {
    const c = buildClaims(1, { platformRoles: [], status: 'ACTIVE' }, [m('o', [], ['b1'], 'ACTIVE', ['books.view', 'copies.manage'])]);
    expect(c.o.o.r).toEqual([]);
    expect(decode(c.o.o.p).sort()).toEqual(['books.view', 'copies.manage']);
  });

  it('marks super admins and drops everything for disabled users', () => {
    expect(buildClaims(1, { platformRoles: ['SUPER_ADMIN'], status: 'ACTIVE' }, []).sa).toBe(true);
    expect(buildClaims(1, { platformRoles: ['SUPER_ADMIN'], status: 'DISABLED' }, [m('o', ['HR_ADMIN'], ['*'])])).toEqual({
      v: 1, sa: false, o: {},
    });
  });
});

describe('permissions', () => {
  it('maps roles to permissions from permissions.json', () => {
    expect(rolesGrant(['LIBRARIAN'], 'loans.issue')).toBe(true);
    expect(rolesGrant(['LIBRARIAN'], 'branches.manage')).toBe(false);
    expect(rolesGrant(['EMPLOYEE'], 'staff.view')).toBe(false);
  });

  it('gives organization-wide permissions only to those with all branches', () => {
    expect(permissionsOf(m('o', ['BRANCH_OWNER'], ['b1'])).has('payroll.run')).toBe(false);
    expect(permissionsOf(m('o', ['BRANCH_OWNER'], ['b1'])).has('leave.approve')).toBe(true);
    expect(permissionsOf(m('o', ['BRANCH_OWNER'], ['*'])).has('payroll.run')).toBe(true);
    expect(permissionsOf(m('o', [], ['b1'], 'ACTIVE', ['books.edit', 'books.view'])).has('books.edit')).toBe(false);
    expect(permissionsOf(m('o', ['BRANCH_OWNER'], ['*'], 'REVOKED')).size).toBe(0);
    // The website and the shared catalogue belong to head office (the corporate organization).
    expect(permissionsOf(m('o', ['BRANCH_OWNER'], ['*'])).has('website.manage')).toBe(true);
    expect(permissionsOf({ ...m('o', ['BRANCH_OWNER'], ['*']), orgType: 'FRANCHISE' }).has('website.manage')).toBe(false);
    expect(permissionsOf({ ...m('o', ['BRANCH_OWNER'], ['*']), orgType: 'FRANCHISE' }).has('payroll.run')).toBe(true);
  });

  it('checks branch scope', () => {
    expect(coversBranch(['*'], 'x')).toBe(true);
    expect(coversBranch(['a'], 'b')).toBe(false);
  });

  it('limits what each role may grant', () => {
    expect([...grantableBy(['SENIOR_LIBRARIAN'])].sort()).toEqual(['DELIVERY_PERSON', 'EMPLOYEE', 'LIBRARIAN']);
    expect(grantableBy(['BRANCH_OWNER']).has('BRANCH_OWNER')).toBe(false);
    expect(grantableBy(['LIBRARIAN']).size).toBe(0);
  });
});

describe('the membership the command pipeline has already read', () => {
  const snap = (data: Membership | null) => ({ exists: !!data, data: () => data ?? undefined }) as unknown as FirebaseFirestore.DocumentSnapshot;
  /** A transaction whose reads are counted; any read it serves finds no membership. */
  const fakeTx = () => {
    const get = vi.fn(async () => snap(null));
    return { tx: { get } as unknown as Transaction, get };
  };
  const actor = () => new Actor('u', null, true, { uid: 'u', email: null, displayName: null, status: 'ACTIVE', platformRoles: [], claimsVersion: 0 });

  it('serves the permission check of that organization in that transaction without another read', async () => {
    const a = actor();
    const { tx, get } = fakeTx();
    a.prime(tx, 'orgA', snap(m('orgA', ['LIBRARIAN'], ['b1'])));
    expect(await a.can('loans.issue', 'orgA', 'b1', tx)).toBe(true);
    expect(await a.can('loans.issue', 'orgA', 'b2', tx)).toBe(false);
    expect((await a.permissions('orgA', tx)).branchIds).toEqual(['b1']);
    expect(get).not.toHaveBeenCalled();
  });

  it('is ignored for another organization and for another transaction', async () => {
    const a = actor();
    const { tx, get } = fakeTx();
    const other = fakeTx();
    a.prime(tx, 'orgA', snap(m('orgA', ['LIBRARIAN'], ['*'])));
    expect(await a.can('loans.issue', 'orgB', undefined, tx)).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await a.can('loans.issue', 'orgA', undefined, other.tx)).toBe(false);
    expect(other.get).toHaveBeenCalledTimes(1);
  });

  it('counts a revoked or missing membership as none, and is gone once cleared', async () => {
    const a = actor();
    const { tx, get } = fakeTx();
    a.prime(tx, 'orgA', snap(m('orgA', ['LIBRARIAN'], ['*'], 'REVOKED')));
    expect(await a.can('loans.issue', 'orgA', undefined, tx)).toBe(false);
    a.prime(tx, 'orgA', snap(null));
    expect(await a.membership('orgA', tx)).toBeNull();
    expect(get).not.toHaveBeenCalled();

    a.prime(tx, 'orgA', snap(m('orgA', ['LIBRARIAN'], ['*'])));
    a.clearPrime();
    expect(await a.can('loans.issue', 'orgA', undefined, tx)).toBe(false); // read again through the transaction
    expect(get).toHaveBeenCalledTimes(1);
  });
});
