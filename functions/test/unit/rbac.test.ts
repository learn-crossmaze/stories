import { describe, expect, it } from 'vitest';

import { buildClaims } from '../../src/core/claims.js';
import { coversBranch, grantableBy, rolesGrant } from '../../src/core/rbac.js';
import type { Membership } from '../../src/core/rbac.js';

const m = (orgId: string, roles: Membership['roles'], branchIds: string[], status: Membership['status'] = 'ACTIVE'): Membership => ({
  orgId, orgName: orgId, orgType: 'CORPORATE', uid: 'u', email: null, displayName: null, roles, branchIds, status,
});

describe('buildClaims', () => {
  it('encodes active memberships with short role codes', () => {
    const c = buildClaims(3, { platformRoles: [], status: 'ACTIVE' }, [
      m('orgA', ['BRANCH_MANAGER', 'EMPLOYEE'], ['b1']),
      m('orgB', ['LIBRARIAN'], ['b9'], 'REVOKED'),
    ]);
    expect(c).toEqual({ v: 3, sa: false, o: { orgA: { r: ['BM', 'EMP'], b: ['b1'] } } });
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

  it('checks branch scope', () => {
    expect(coversBranch(['*'], 'x')).toBe(true);
    expect(coversBranch(['a'], 'b')).toBe(false);
  });

  it('limits what each role may grant', () => {
    expect([...grantableBy(['BRANCH_MANAGER'])].sort()).toEqual(['DELIVERY_PERSON', 'EMPLOYEE', 'LIBRARIAN']);
    expect(grantableBy(['LIBRARIAN']).size).toBe(0);
  });
});
