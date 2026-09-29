import { can, type StoriesClaims } from '../auth/claims';
import type { Permission } from '../generated/rbac';
import { paths } from '../paths';
import { t } from '../strings';
import { ht } from '../strings/hr';
import type { IconName } from '../shared/ui';

/** Permission needed in the current organization (any of a list); `superAdmin` for platform pages; null for everyone. */
export type Requirement = Permission | Permission[] | 'superAdmin' | null;

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  section: string | null;
  /** Who sees the menu item. */
  requires: Requirement;
  /** Who may open the page (defaults to `requires`); wider than the menu for reference pages. */
  page?: Requirement;
}

/**
 * The staff console menu: one entry per page, grouped by the work it supports.
 * Personal settings (appearance, member view, sign out) live in the account menu.
 */
export const NAV: NavItem[] = [
  { to: paths.admin, label: t.navDashboard, icon: 'dashboard', section: null, requires: null },

  { to: paths.adminDesk, label: t.navDesk, icon: 'scan', section: t.sectionLibrary, requires: 'loans.issue' },
  { to: paths.adminBooks, label: t.navCatalogue, icon: 'book', section: t.sectionLibrary, requires: 'books.view' },
  { to: paths.adminInventory, label: t.navInventory, icon: 'shelves', section: t.sectionLibrary, requires: 'books.view' },
  { to: paths.adminReservations, label: t.navReservations, icon: 'bookmark', section: t.sectionLibrary, requires: 'reservations.manage' },
  { to: paths.adminTransfers, label: t.navTransfers, icon: 'truck', section: t.sectionLibrary, requires: 'books.transfer' },

  { to: paths.adminMembers, label: t.navMembers, icon: 'person', section: t.sectionMembers, requires: 'members.view' },
  { to: paths.adminPlans, label: t.navPlans, icon: 'card', section: t.sectionMembers, requires: 'plans.manage' },
  { to: paths.adminDeposits, label: t.navDepositApprovals, icon: 'wallet', section: t.sectionMembers, requires: 'deposits.approve' },

  { to: paths.adminPeopleOverview, label: ht.navOverview, icon: 'insights', section: ht.sectionPeople, requires: 'employees.view' },
  { to: paths.adminPeople, label: ht.navEmployees, icon: 'badge', section: ht.sectionPeople, requires: 'employees.view' },
  { to: paths.adminAttendance, label: ht.navAttendance, icon: 'clock', section: ht.sectionPeople, requires: 'attendance.view' },
  // Approvers see the menu item; anyone who views attendance may open the page.
  { to: paths.adminLeave, label: ht.navLeave, icon: 'calendar', section: ht.sectionPeople, requires: ['leave.approve', 'leave.adjust'], page: 'attendance.view' },
  // Those who prepare or approve payroll see the menu item; salary viewers may open the page.
  { to: paths.adminPayroll, label: ht.navPayroll, icon: 'payments', section: ht.sectionPeople, requires: ['payroll.run', 'payroll.approve'], page: 'salary.view' },
  { to: paths.adminDocuments, label: ht.navDocuments, icon: 'folder', section: ht.sectionPeople, requires: 'documents.verify' },
  { to: paths.adminStaff, label: t.navStaff, icon: 'key', section: ht.sectionPeople, requires: 'staff.view' },
  { to: paths.adminHrSettings, label: ht.navHrSettings, icon: 'tune', section: ht.sectionPeople, requires: 'hr.config' },

  { to: paths.adminOrgs, label: t.navOrganizations, icon: 'building', section: t.sectionOrganization, requires: 'superAdmin' },
  // Everyone may look a branch or department up; the menu shows them to those who run them.
  {
    to: paths.adminBranches,
    label: t.navBranches,
    icon: 'store',
    section: t.sectionOrganization,
    requires: ['branches.manage', 'staff.view'],
    page: 'branches.view',
  },
  {
    to: paths.adminDepartments,
    label: t.navDepartments,
    icon: 'tree',
    section: t.sectionOrganization,
    requires: ['departments.manage', 'staff.view'],
    page: 'branches.view',
  },
  { to: paths.adminAudit, label: t.navAudit, icon: 'history', section: t.sectionOrganization, requires: 'audit.view' },
];

export const allowed = (claims: StoriesClaims, orgId: string | null, requires: Requirement) =>
  requires === null ? true : requires === 'superAdmin' ? claims.sa : (Array.isArray(requires) ? requires : [requires]).some((p) => can(claims, p, orgId));

/** Navigation for the current user and organization (UI convenience only). */
export const visibleNav = (claims: StoriesClaims, orgId: string | null) => NAV.filter((i) => allowed(claims, orgId, i.requires));

/** Menu items grouped by section, in menu order. */
export function navSections(items: NavItem[]): { section: string | null; items: NavItem[] }[] {
  const out: { section: string | null; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else out.push({ section: item.section, items: [item] });
  }
  return out;
}

/** The menu item a location belongs to (longest matching path), for page titles. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV.filter((i) => pathname === i.to || (i.to !== paths.admin && pathname.startsWith(`${i.to}/`))).sort((a, b) => b.to.length - a.to.length)[0];
}
