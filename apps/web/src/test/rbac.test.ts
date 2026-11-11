import { describe, expect, it } from 'vitest';

import { canManageMember, grantableRoles } from '../admin/grants';
import { isGroup, visibleMenu, visibleNav } from '../admin/nav';
import { can, isStaff, parseClaims, staffHome, type StoriesClaims } from '../auth/claims';
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
  // One menu for everyone (as in LITMUS): what each role sees, group by group.
  const menu = (c: StoriesClaims) => visibleMenu(c, 'corp').map((e) => (isGroup(e) ? `${e.label}: ${e.items.map((i) => i.label).join(', ')}` : e.label));
  const labels = (c: StoriesClaims) => visibleNav(c, 'corp').map((i) => i.label);
  const hr = claims({ corp: { r: ['HR'], b: ['*'] } });
  const lib = claims({ corp: { r: ['LIB'], b: ['cen'] } });
  const fin = claims({ corp: { r: ['FIN'], b: ['*'] } });
  const bm = claims({ corp: { r: ['BM'], b: ['cen'] } });
  const emp = claims({ corp: { r: ['EMP'], b: ['cen'] } });
  const del = claims({ corp: { r: ['DEL'], b: ['cen'] } });
  const web = claims({ corp: { r: ['WEB'], b: ['*'] } });
  const MY = 'My employment: My profile, My attendance, My leave, My payslips, Complete my profile';

  it('starts people who only use their own pages on My profile, everyone else on the Dashboard', () => {
    expect(staffHome(claims({}, true))).toBe('/admin');
    expect([hr, fin, lib, bm, del, web].map(staffHome)).toEqual(['/admin', '/admin', '/admin', '/admin', '/admin', '/admin']);
    expect(staffHome(emp)).toBe('/me');
  });

  it('shows each role only what it may use, in one menu', () => {
    expect(labels(claims({}, true))).toHaveLength(52);
    expect(menu(emp)).toEqual(['Dashboard', MY]);
    expect(menu(lib)).toEqual([
      'Dashboard',
      'Circulation: Circulation desk, Reservations, Transfers, Deliveries',
      'Collection: Catalogue, Receive books, Inventory, Shelve books',
      'Members: Members, Payments & refunds',
      'Website: Website overview, Blog',
      'My employment: My profile, My attendance, My leave, My payslips, My deliveries, Complete my profile',
    ]);
    expect(menu(web)).toEqual([
      'Dashboard',
      'Collection: Catalogue, Inventory',
      'Website: Website overview, Site settings, Page sections, Branch pages, Offers, Jobs, Blog, Festival greetings, Testimonials',
      'Enquiries: Submissions, Calls',
      'Organization: Website admins',
      'Settings: Connections',
      MY,
    ]);
    expect(menu(hr)).toEqual([
      'Dashboard',
      'Staff: Overview, Employees, Documents, Letters, Attendance, Leave, Payroll',
      'Organization: Branches, Departments, Roles & access, Audit log',
      'Settings: Job titles & checklists, Shifts & holidays, Leave types, Document types, Letter templates, Payroll settings',
      MY,
    ]);
    expect(menu(fin)).toEqual(['Dashboard', 'Collection: Catalogue, Inventory', 'Members: Members, Payments & refunds, Deposit approvals', 'Staff: Payroll', 'Organization: Audit log', MY]);
    // Branch managers run their branch: its circulation, members, website page and enquiries, team and settings.
    expect(menu(bm)).toEqual(
      expect.arrayContaining([
        'Website: Website overview, Branch pages, Blog',
        'Enquiries: Submissions',
        'Staff: Overview, Employees, Letters, Attendance, Leave',
        'Settings: WhatsApp, Delivery',
      ]),
    );
    expect(labels(bm)).not.toContain('Job titles & checklists');
    // Riders see their deliveries among their own pages.
    expect(labels(del)).toContain('My deliveries');
    // Roles in another organization don't show here (the menu follows the chosen organization).
    expect(menu(claims({ fran: { r: ['FO'], b: ['*'] } }))).toEqual(['Dashboard', MY]);
    // Members (no staff role) get no console menu at all: they use the member area.
    expect(visibleMenu(claims({}), 'corp')).toEqual([]);
  });

  it('drops a group when nothing in it is visible', () => {
    expect(visibleMenu(lib, 'corp').filter(isGroup).map((g) => g.id)).toEqual(['circulation', 'collection', 'members', 'website', 'me']);
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
