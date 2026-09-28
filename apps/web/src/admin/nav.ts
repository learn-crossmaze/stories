import { can, type StoriesClaims } from '../auth/claims';
import type { Permission } from '../generated/rbac';
import { paths } from '../paths';
import { t } from '../strings';
import { ht } from './hrStrings';
import type { IconName } from '../ui';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  section: string | null;
  /** Permission needed in the current organization; `superAdmin` for platform pages. */
  requires: Permission | 'superAdmin' | null;
}

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
  { to: paths.adminPeople, label: ht.navEmployees, icon: 'people', section: ht.sectionPeople, requires: 'employees.view' },
  { to: paths.adminStaff, label: t.navStaff, icon: 'person', section: ht.sectionPeople, requires: 'staff.view' },
  { to: paths.adminHrSettings, label: ht.navHrSettings, icon: 'folder', section: ht.sectionPeople, requires: 'hr.config' },
  { to: paths.adminOrgs, label: t.navOrganizations, icon: 'building', section: t.sectionOrganization, requires: 'superAdmin' },
  { to: paths.adminBranches, label: t.navBranches, icon: 'store', section: t.sectionOrganization, requires: 'branches.view' },
  { to: paths.adminDepartments, label: t.navDepartments, icon: 'folder', section: t.sectionOrganization, requires: 'branches.view' },
  { to: paths.adminAudit, label: t.navAudit, icon: 'history', section: t.sectionOrganization, requires: 'audit.view' },
  { to: paths.adminAppearance, label: t.navAppearance, icon: 'palette', section: t.sectionPersonal, requires: null },
];

export const allowed = (claims: StoriesClaims, orgId: string | null, requires: NavItem['requires']) =>
  requires === null ? true : requires === 'superAdmin' ? claims.sa : can(claims, requires, orgId);

/** Navigation for the current user and organization (UI convenience only). */
export const visibleNav = (claims: StoriesClaims, orgId: string | null) => NAV.filter((i) => allowed(claims, orgId, i.requires));
