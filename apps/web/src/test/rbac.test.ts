import { describe, expect, it } from 'vitest';

import { canManageMember, grantableRoles } from '../admin/grants';
import { availableViews, isGroup, visibleMenu, visibleNav } from '../admin/nav';
import { can, homeViewFor, isStaff, parseClaims, type StoriesClaims, type ViewId } from '../auth/claims';
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
  const labels = (c: StoriesClaims, view: ViewId) => visibleNav(c, 'corp', view).map((i) => i.label);
  const hr = claims({ corp: { r: ['HR'], b: ['*'] } });
  const lib = claims({ corp: { r: ['LIB'], b: ['cen'] } });
  const fin = claims({ corp: { r: ['FIN'], b: ['*'] } });
  const bm = claims({ corp: { r: ['BM'], b: ['cen'] } });
  const emp = claims({ corp: { r: ['EMP'], b: ['cen'] } });

  it('lands each role in its view and offers only views with something in them', () => {
    expect(homeViewFor(claims({}, true))).toBe('admin');
    expect([hr, fin].map(homeViewFor)).toEqual(['admin', 'admin']);
    expect([lib, bm, claims({ corp: { r: ['DEL'], b: ['cen'] } })].map(homeViewFor)).toEqual(['ops', 'ops', 'ops']);
    expect(homeViewFor(emp)).toBe('staff');
    expect(availableViews(emp, 'corp')).toEqual(['staff']);
    expect(availableViews(lib, 'corp')).toEqual(['ops', 'staff']);
    expect(availableViews(bm, 'corp')).toEqual(['admin', 'ops', 'staff']);
    expect(availableViews(claims({}), 'corp')).toEqual([]);
  });

  it('shows each role only what it may use, view by view', () => {
    expect(labels(claims({}, true), 'admin')).toHaveLength(19);
    expect(labels(hr, 'admin')).toEqual([
      'Dashboard', 'Branches', 'Departments', 'Roles & access', 'Overview', 'Employees', 'Documents', 'Letters', 'Attendance', 'Leave', 'Payroll',
      'Job titles & checklists', 'Shifts & holidays', 'Leave types', 'Document types', 'Letter templates', 'Payroll settings', 'Audit log',
    ]);
    expect(labels(lib, 'ops')).toEqual(['Today', 'Circulation desk', 'Reservations', 'Transfers', 'Catalogue', 'Receive books', 'Inventory', 'Shelve books', 'Members', 'Payments & refunds']);
    expect(labels(fin, 'ops')).toEqual(['Today', 'Catalogue', 'Inventory', 'Members', 'Payments & refunds', 'Deposit approvals']);
    expect(labels(fin, 'admin')).toEqual(['Dashboard', 'Payroll', 'Audit log']);
    expect(labels(claims({ corp: { r: ['DEL'], b: ['cen'] } }), 'ops')).toEqual(['Today', 'Catalogue', 'Inventory']);
    expect(labels(claims({ fran: { r: ['FO'], b: ['*'] } }), 'admin')).toEqual(['Dashboard']);
    expect(labels(bm, 'ops')).toEqual(expect.arrayContaining(['Attendance', 'Leave requests', 'Letters']));
    expect(labels(lib, 'admin')).not.toContain('Letters');
    // Branch managers run their branch: its staff and branch lists, but not HR settings.
    expect(labels(bm, 'admin')).toEqual(expect.arrayContaining(['Branches', 'Departments', 'Employees']));
    expect(labels(bm, 'admin')).not.toContain('Job titles & checklists');
    expect(labels(emp, 'staff')).toEqual(['Home', 'Attendance', 'Leave', 'My payslips']);
  });

  it('drops a group when nothing in it is visible', () => {
    const groups = visibleMenu(lib, 'corp', 'ops').filter(isGroup).map((g) => g.id);
    expect(groups).toEqual(['circulation', 'collection', 'members']);
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
