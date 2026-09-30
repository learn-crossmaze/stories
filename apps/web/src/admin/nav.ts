import { can, isStaff, type StoriesClaims, type ViewId } from '../auth/claims';
import type { Permission } from '../generated/rbac';
import { paths, viewHome } from '../paths';
import { t } from '../strings';
import { ht } from '../strings/hr';
import { lt } from '../strings/library';
import type { IconName } from '../shared/ui';

/** Permission needed in the current organization (any of a list); `superAdmin` for platform pages; null for everyone. */
export type Requirement = Permission | Permission[] | 'superAdmin' | null;

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Who sees the menu item. */
  requires: Requirement;
  /** Who may open the page (defaults to `requires`); wider than the menu for reference pages. */
  page?: Requirement;
  /** The view's home page: it doesn't make a view worth showing on its own. */
  home?: boolean;
}

export interface NavGroup {
  /** Stable id for remembering whether the group is open. */
  id: string;
  label: string;
  icon: IconName;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;
export const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

/**
 * The staff console menus, one per view (Admin: setup and back office;
 * Operations: daily running of branches; Staff: self-service). Items sit in
 * groups of related pages, at most one level deep. The Member view is the
 * member app itself. Security is not decided here: the rules and functions
 * check every read and write.
 */
export const MENUS: Record<ViewId, NavEntry[]> = {
  ops: [
    { to: paths.ops, label: t.navToday, icon: 'dashboard', requires: null, home: true },
    {
      id: 'circulation',
      label: t.groupCirculation,
      icon: 'scan',
      items: [
        { to: paths.adminDesk, label: t.navDesk, icon: 'scan', requires: 'loans.issue' },
        { to: paths.adminReservations, label: t.navReservations, icon: 'bookmark', requires: 'reservations.manage' },
        { to: paths.adminTransfers, label: t.navTransfers, icon: 'truck', requires: 'books.transfer' },
      ],
    },
    {
      id: 'collection',
      label: t.groupCollection,
      icon: 'book',
      items: [
        { to: paths.adminBooks, label: t.navCatalogue, icon: 'book', requires: 'books.view' },
        { to: paths.adminBooksBulk, label: lt.bulkNav, icon: 'plus', requires: ['copies.manage', 'books.create'] },
        { to: paths.adminInventory, label: t.navInventory, icon: 'shelves', requires: 'books.view' },
      ],
    },
    {
      id: 'members',
      label: t.groupMembers,
      icon: 'person',
      items: [
        { to: paths.adminMembers, label: t.navMembers, icon: 'person', requires: 'members.view' },
        { to: paths.adminPlans, label: t.navPlans, icon: 'card', requires: 'plans.manage' },
        { to: paths.adminPayments, label: lt.navPayments, icon: 'payments', requires: 'payments.view' },
        { to: paths.adminDeposits, label: t.navDepositApprovals, icon: 'wallet', requires: 'deposits.approve' },
      ],
    },
    {
      id: 'team',
      label: t.groupTeam,
      icon: 'people',
      items: [
        { to: paths.opsAttendance, label: ht.navAttendanceShort, icon: 'clock', requires: 'attendance.manage', page: 'attendance.view' },
        { to: paths.opsLeave, label: ht.navLeaveRequests, icon: 'calendar', requires: 'leave.approve', page: 'attendance.view' },
        { to: paths.opsOffers, label: ht.navOffers, icon: 'folder', requires: ['offers.release', 'letters.issue'] },
      ],
    },
  ],
  admin: [
    { to: paths.admin, label: t.navDashboard, icon: 'dashboard', requires: null, home: true },
    {
      id: 'organization',
      label: t.groupOrganization,
      icon: 'building',
      items: [
        { to: paths.adminOrgs, label: t.navOrganizations, icon: 'building', requires: 'superAdmin' },
        // Everyone may look a branch or department up; the menu shows them to those who run them.
        { to: paths.adminBranches, label: t.navBranches, icon: 'store', requires: ['branches.manage', 'staff.view'], page: 'branches.view' },
        { to: paths.adminDepartments, label: t.navDepartments, icon: 'tree', requires: ['departments.manage', 'staff.view'], page: 'branches.view' },
        { to: paths.adminStaff, label: t.navStaff, icon: 'key', requires: 'staff.view' },
      ],
    },
    {
      id: 'people',
      label: t.groupPeople,
      icon: 'badge',
      items: [
        { to: paths.adminPeopleOverview, label: ht.navOverview, icon: 'insights', requires: 'employees.view' },
        { to: paths.adminPeople, label: ht.navEmployees, icon: 'badge', requires: 'employees.view' },
        { to: paths.adminDocuments, label: ht.navDocuments, icon: 'folder', requires: 'documents.verify' },
        { to: paths.adminOffers, label: ht.navOffers, icon: 'folder', requires: ['offers.release', 'letters.issue'] },
      ],
    },
    {
      id: 'time',
      label: t.groupTime,
      icon: 'clock',
      items: [
        { to: paths.adminAttendance, label: ht.navAttendance, icon: 'clock', requires: ['attendance.finalize', 'hr.config'], page: 'attendance.view' },
        // Approvers see the menu item; anyone who views attendance may open the page.
        { to: paths.adminLeave, label: ht.navLeave, icon: 'calendar', requires: 'leave.adjust', page: 'attendance.view' },
      ],
    },
    // Those who prepare or approve payroll see the menu item; salary viewers may open the page.
    { to: paths.adminPayroll, label: ht.navPayrollRuns, icon: 'payments', requires: ['payroll.run', 'payroll.approve'], page: 'salary.view' },
    {
      id: 'settings',
      label: t.groupSettings,
      icon: 'tune',
      items: [
        { to: paths.adminHrSettings, label: ht.navJobSettings, icon: 'badge', requires: 'hr.config' },
        { to: paths.adminSettingsSchedule, label: ht.navScheduleSettings, icon: 'clock', requires: 'hr.config' },
        { to: paths.adminSettingsLeave, label: ht.navLeaveTypes, icon: 'calendar', requires: 'hr.config' },
        { to: paths.adminSettingsDocuments, label: ht.navDocumentTypes, icon: 'folder', requires: 'hr.config' },
        { to: paths.adminSettingsLetters, label: ht.navLetterTemplates, icon: 'folder', requires: 'hr.config' },
        { to: paths.adminSettingsPayroll, label: ht.navPayrollSettings, icon: 'payments', requires: 'salary.edit' },
      ],
    },
    { to: paths.adminAudit, label: t.navAudit, icon: 'history', requires: 'audit.view' },
  ],
  staff: [
    { to: paths.staff, label: t.navHome, icon: 'home', requires: null, home: true },
    { to: paths.adminMyAttendance, label: ht.navAttendanceShort, icon: 'clock', requires: null },
    { to: paths.adminMyLeave, label: ht.navLeave, icon: 'calendar', requires: null },
    { to: paths.adminMyPayslips, label: ht.navMyPayslips, icon: 'payments', requires: null },
  ],
};

export const VIEW_ORDER: ViewId[] = ['admin', 'ops', 'staff'];
export const VIEW_ICONS: Record<ViewId | 'member', IconName> = { admin: 'tune', ops: 'scan', staff: 'person', member: 'home' };

const itemsOf = (entries: NavEntry[]) => entries.flatMap((e) => (isGroup(e) ? e.items : [e]));

/** Every page in every view, for guards and titles. */
export const NAV: (NavItem & { view: ViewId })[] = VIEW_ORDER.flatMap((view) => itemsOf(MENUS[view]).map((i) => ({ ...i, view })));

export const allowed = (claims: StoriesClaims, orgId: string | null, requires: Requirement) =>
  requires === null ? true : requires === 'superAdmin' ? claims.sa : (Array.isArray(requires) ? requires : [requires]).some((p) => can(claims, p, orgId));

/** A view's menu for the current user: items they may use, groups with none left removed (UI convenience only). */
export function visibleMenu(claims: StoriesClaims, orgId: string | null, view: ViewId): NavEntry[] {
  return MENUS[view].flatMap((e): NavEntry[] => {
    if (!isGroup(e)) return allowed(claims, orgId, e.requires) ? [e] : [];
    const items = e.items.filter((i) => allowed(claims, orgId, i.requires));
    return items.length ? [{ ...e, items }] : [];
  });
}

/** The pages a user sees in the menu of a view (or all views), flattened. */
export const visibleNav = (claims: StoriesClaims, orgId: string | null, view?: ViewId) =>
  (view ? [view] : VIEW_ORDER).flatMap((v) => itemsOf(visibleMenu(claims, orgId, v)));

/** Views worth offering: Staff to every staff member; Admin and Operations when they hold more than the home page. */
export function availableViews(claims: StoriesClaims, orgId: string | null): ViewId[] {
  if (!isStaff(claims)) return [];
  return VIEW_ORDER.filter((v) => v === 'staff' || itemsOf(visibleMenu(claims, orgId, v)).some((i) => !i.home));
}

/** The view a location belongs to. */
export const viewOf = (pathname: string): ViewId =>
  (VIEW_ORDER.find((v) => pathname === viewHome[v] || pathname.startsWith(`${viewHome[v]}/`)) ?? 'admin') as ViewId;

/** The menu item a location belongs to (longest matching path), for guards and titles. */
export function navItemFor(pathname: string): (NavItem & { view: ViewId }) | undefined {
  return NAV.filter((i) => pathname === i.to || (!i.home && pathname.startsWith(`${i.to}/`))).sort((a, b) => b.to.length - a.to.length)[0];
}

/** The group holding a location, so it can start open. */
export const groupFor = (entries: NavEntry[], pathname: string) =>
  entries.find((e) => isGroup(e) && e.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))) as NavGroup | undefined;

/** Old /admin addresses (bookmarks, earlier notifications) → where the page lives now. */
export const MOVED: [string, string][] = [
  ['/admin/desk', paths.adminDesk],
  ['/admin/books', paths.adminBooks],
  ['/admin/inventory', paths.adminInventory],
  ['/admin/labels', paths.adminLabels],
  ['/admin/reservations', paths.adminReservations],
  ['/admin/transfers', paths.adminTransfers],
  ['/admin/members', paths.adminMembers],
  ['/admin/plans', paths.adminPlans],
  ['/admin/deposits', paths.adminDeposits],
  ['/admin/me', paths.staff],
  ['/admin/my-attendance', paths.adminMyAttendance],
  ['/admin/my-leave', paths.adminMyLeave],
  ['/admin/my-payslips', paths.adminMyPayslips],
  ['/admin/appearance', paths.adminAppearance],
  ['/admin/hr-settings', paths.adminHrSettings],
];

/** Where an old address moved to (keeping anything after it, e.g. a book id, and the query), or null. */
export function movedTo(pathname: string, search = ''): string | null {
  const hit = MOVED.find(([from]) => pathname === from || pathname.startsWith(`${from}/`));
  return hit ? `${hit[1]}${pathname.slice(hit[0].length)}${search}` : null;
}
