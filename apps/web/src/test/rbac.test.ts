import { describe, expect, it } from 'vitest';

import { canManageMember, grantableRoles } from '../admin/grants';
import { visibleNav } from '../admin/nav';
import { can, isStaff, parseClaims, type StoriesClaims } from '../auth/claims';
import type { StaffMembership } from '../data/org';

const claims = (o: StoriesClaims['o'], sa = false): StoriesClaims => ({ v: 1, sa, o });
const member = (uid: string, roles: StaffMembership['roles'], branchIds: string[]): StaffMembership => ({
  uid, orgId: 'corp', email: `${uid}@x.in`, displayName: uid, roles, branchIds, status: 'ACTIVE',
});

describe('claims', () => {
  it('parses tolerant of missing fields', () => {
    expect(parseClaims({})).toEqual({ v: 0, sa: false, o: {} });
    expect(isStaff(parseClaims({ o: { corp: { r: ['LIB'], b: ['cen'] } } }))).toBe(true);
    expect(isStaff(parseClaims({ v: 2 }))).toBe(false);
  });

  it('checks permission, org and branch scope', () => {
    const lib = claims({ corp: { r: ['LIB'], b: ['cen'] } });
    expect(can(lib, 'loans.issue', 'corp')).toBe(true);
    expect(can(lib, 'loans.issue', 'corp', 'cen')).toBe(true);
    expect(can(lib, 'loans.issue', 'corp', 'nth')).toBe(false);
    expect(can(lib, 'loans.issue', 'fran')).toBe(false);
    expect(can(lib, 'branches.manage', 'corp')).toBe(false);
    expect(can(claims({}, true), 'branches.manage', 'anything')).toBe(true);
  });

  it('keeps reference pages open to everyone who could see them before', async () => {
    const { NAV, allowed } = await import('../admin/nav');
    const branches = NAV.find((i) => i.label === 'Branches')!;
    expect(allowed(claims({ corp: { r: ['LIB'], b: ['cen'] } }), 'corp', branches.page ?? branches.requires)).toBe(true);
  });
});

describe('navigation', () => {
  const labels = (c: StoriesClaims) => visibleNav(c, 'corp').map((i) => i.label);

  it('shows each role only what it may use', () => {
    expect(labels(claims({}, true))).toHaveLength(18);
    expect(labels(claims({ corp: { r: ['HR'], b: ['*'] } }))).toEqual(['Dashboard', 'Employees', 'Attendance', 'Documents', 'Roles & access', 'HR settings', 'Branches', 'Departments', 'Audit log']);
    expect(labels(claims({ corp: { r: ['LIB'], b: ['cen'] } }))).toEqual([
      'Dashboard', 'Circulation desk', 'Catalogue', 'Inventory', 'Reservations', 'Transfers', 'Members',
    ]);
    expect(labels(claims({ corp: { r: ['FIN'], b: ['*'] } }))).toEqual([
      'Dashboard', 'Catalogue', 'Inventory', 'Members', 'Deposit approvals', 'Attendance', 'Audit log',
    ]);
    expect(labels(claims({ corp: { r: ['DEL'], b: ['cen'] } }))).toEqual(['Dashboard', 'Catalogue', 'Inventory']);
    expect(labels(claims({ fran: { r: ['FO'], b: ['*'] } }))).toEqual(['Dashboard']);
    expect(labels(claims({ corp: { r: ['BM'], b: ['cen'] } }))).toContain('Employees');
    expect(labels(claims({ corp: { r: ['BM'], b: ['cen'] } }))).not.toContain('HR settings');
    expect(labels(claims({ corp: { r: ['CM'], b: ['*'] } }))).toEqual(['Dashboard', 'Catalogue', 'Inventory']);
    // Branch managers run their branch: they see its branch and department lists.
    expect(labels(claims({ corp: { r: ['BM'], b: ['cen'] } }))).toEqual(expect.arrayContaining(['Branches', 'Departments']));
  });
});

describe('grants (UI mirror of server rules)', () => {
  const bm = claims({ corp: { r: ['BM', 'EMP'], b: ['cen'] } });

  it('offers only grantable roles that fit the org type', () => {
    expect(grantableRoles(bm, 'corp', 'CORPORATE')).toEqual(['LIBRARIAN', 'DELIVERY_PERSON', 'EMPLOYEE']);
    expect(grantableRoles(claims({}, true), 'fran', 'FRANCHISE')).not.toContain('HEAD_OFFICE_ADMIN');
    expect(grantableRoles(claims({}, true), 'corp', 'CORPORATE')).not.toContain('FRANCHISE_OWNER');
  });

  it('hides actions on self, senior staff and other branches', () => {
    expect(canManageMember(bm, 'me', 'corp', 'CORPORATE', member('me', ['BRANCH_MANAGER'], ['cen']))).toBe(false);
    expect(canManageMember(bm, 'me', 'corp', 'CORPORATE', member('ho', ['HEAD_OFFICE_ADMIN'], ['*']))).toBe(false);
    expect(canManageMember(bm, 'me', 'corp', 'CORPORATE', member('l2', ['LIBRARIAN'], ['nth']))).toBe(false);
    expect(canManageMember(bm, 'me', 'corp', 'CORPORATE', member('l1', ['LIBRARIAN'], ['cen']))).toBe(true);
  });
});

describe('toApiError', () => {
  it('keeps server messages for domain errors, minus the SDK status suffix', async () => {
    const { FirebaseError } = await import('firebase/app');
    const { toApiError } = await import('../data/api');
    const e = Object.assign(new FirebaseError('functions/failed-precondition', 'Branch code NTH is already used. [400]'), {
      details: { reason: 'BRANCH_CODE_TAKEN' },
    });
    expect(toApiError(e)).toMatchObject({ message: 'Branch code NTH is already used.', reason: 'BRANCH_CODE_TAKEN' });
    expect(toApiError(new FirebaseError('functions/internal', 'stack trace here')).message).toMatch(/Something went wrong/);
  });

  it('explains a 404 from an outdated backend instead of showing "not found"', async () => {
    const { FirebaseError } = await import('firebase/app');
    const { toApiError } = await import('../data/api');
    for (const msg of ['Unknown action. [404]', 'NOT FOUND', 'not-found']) {
      expect(toApiError(new FirebaseError('functions/not-found', msg))).toMatchObject({ reason: 'SERVER_OUTDATED', message: expect.stringContaining('deploy:backend') });
    }
    // A domain "not found" keeps its own message.
    expect(toApiError(new FirebaseError('functions/not-found', 'Book not found. [404]')).message).toBe('Book not found.');
  });
});

describe('routerFor', () => {
  it('routes every action prefix to its deployed router', async () => {
    const { routerFor } = await import('../data/api');
    expect(routerFor('books-create')).toBe('catalogue');
    expect(routerFor('payments-recordOffline')).toBe('billing');
    expect(routerFor('circulation-exchange')).toBe('circulation');
    expect(routerFor('users-ensureProfile')).toBe('admin');
    expect(routerFor('employees-transition')).toBe('hr');
    expect(routerFor('designations-create')).toBe('hr');
    expect(routerFor('hr-setChecklists')).toBe('hr');
    expect(() => routerFor('nope-x')).toThrow();
  });
});
