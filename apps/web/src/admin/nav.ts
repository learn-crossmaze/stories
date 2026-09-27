import { can, type StoriesClaims } from '../auth/claims';
import type { Permission } from '../generated/rbac';
import { paths } from '../paths';
import { t } from '../strings';
import type { IconName } from '../ui';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Permission needed in the current organization; `superAdmin` for platform pages. */
  requires: Permission | 'superAdmin' | null;
}

export const NAV: NavItem[] = [
  { to: paths.admin, label: t.navDashboard, icon: 'dashboard', requires: null },
  { to: paths.adminOrgs, label: t.navOrganizations, icon: 'building', requires: 'superAdmin' },
  { to: paths.adminBranches, label: t.navBranches, icon: 'store', requires: 'branches.view' },
  { to: paths.adminDepartments, label: t.navDepartments, icon: 'folder', requires: 'branches.view' },
  { to: paths.adminStaff, label: t.navStaff, icon: 'people', requires: 'staff.view' },
  { to: paths.adminAudit, label: t.navAudit, icon: 'history', requires: 'audit.view' },
];

export const allowed = (claims: StoriesClaims, orgId: string | null, requires: NavItem['requires']) =>
  requires === null ? true : requires === 'superAdmin' ? claims.sa : can(claims, requires, orgId);

/** Navigation for the current user and organization (UI convenience only). */
export const visibleNav = (claims: StoriesClaims, orgId: string | null) => NAV.filter((i) => allowed(claims, orgId, i.requires));
