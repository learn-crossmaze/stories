import { can, isStaff, type StoriesClaims } from '../auth/claims';
import type { Permission } from '../generated/rbac';
import { paths } from '../paths';
import { t } from '../strings';
import { ht } from '../strings/hr';
import { lt } from '../strings/library';
import { wt } from '../strings/messaging';
import { dt } from '../strings/delivery';
import { st } from '../strings/site';
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
  /** The Dashboard: matches its address only, not the pages under it. */
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
 * The staff console's one menu (as in LITMUS): the Dashboard, then groups by who the work is for, in the order it
 * happens: the branch's daily work (circulation, the collection, members), the website, staff and HR, the
 * organization and its settings, and last each person's own job ("My employment"). Everyone sees only what their
 * roles allow; a group with nothing left for someone isn't shown. Members never see this: they use the member area
 * on the website. Security is not decided here: the rules and functions check every read and write.
 */
export const MENU: NavEntry[] = [
  { to: paths.admin, label: t.navDashboard, icon: 'dashboard', requires: null, home: true },
  {
    id: 'circulation',
    label: t.groupCirculation,
    icon: 'scan',
    items: [
      { to: paths.adminDesk, label: t.navDesk, icon: 'scan', requires: 'loans.issue' },
      { to: paths.adminReservations, label: t.navReservations, icon: 'bookmark', requires: 'reservations.manage' },
      { to: paths.adminTransfers, label: t.navTransfers, icon: 'truck', requires: 'books.transfer' },
      { to: paths.opsDeliveries, label: dt.nav, icon: 'parcel', requires: 'delivery.manage' },
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
      { to: paths.adminShelve, label: lt.shelveNav, icon: 'shelves', requires: 'copies.manage' },
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
  // The website, in the order of the crossmaze.in admin panel.
  {
    id: 'website',
    label: st.groupWebsite,
    icon: 'explore',
    items: [
      { to: paths.adminWebsite, label: st.navWebsiteHome, icon: 'dashboard', requires: ['website.manage', 'website.branch', 'blog.write'] },
      { to: paths.adminWebsiteSettings, label: st.navSettings, icon: 'tune', requires: 'website.manage' },
      { to: paths.adminWebsiteSections, label: st.navSections, icon: 'folder', requires: 'website.manage' },
      { to: paths.adminWebsiteBranches, label: st.navBranchPages, icon: 'store', requires: ['website.manage', 'website.branch'] },
      { to: paths.adminWebsitePromotions, label: st.navPromotions, icon: 'bell', requires: 'website.manage' },
      { to: paths.adminWebsiteJobs, label: st.navJobs, icon: 'badge', requires: 'website.manage' },
      { to: paths.adminWebsiteBlog, label: st.navBlog, icon: 'book', requires: ['website.manage', 'website.branch', 'blog.write'] },
      { to: paths.adminWebsiteCards, label: st.navCards, icon: 'palette', requires: 'website.manage' },
      { to: paths.adminWebsiteTestimonials, label: st.navTestimonials, icon: 'chat', requires: 'website.manage' },
    ],
  },
  {
    id: 'enquiries',
    label: st.groupEnquiries,
    icon: 'chat',
    items: [
      { to: paths.adminWebsiteSubmissions, label: st.navSubmissions, icon: 'folder', requires: ['website.manage', 'website.branch'] },
      { to: paths.adminWebsiteCalls, label: st.navCalls, icon: 'insights', requires: 'website.manage' },
    ],
  },
  {
    id: 'staff',
    label: t.groupStaff,
    icon: 'badge',
    items: [
      { to: paths.adminPeopleOverview, label: ht.navOverview, icon: 'insights', requires: 'employees.view' },
      { to: paths.adminPeople, label: ht.navEmployees, icon: 'badge', requires: 'employees.view' },
      { to: paths.adminDocuments, label: ht.navDocuments, icon: 'folder', requires: 'documents.verify' },
      { to: paths.adminOffers, label: ht.navOffers, icon: 'folder', requires: ['offers.release', 'letters.issue'] },
      // Branch managers mark attendance and approve leave; HR also finalizes and adjusts. Anyone who views attendance may open the pages.
      { to: paths.adminAttendance, label: ht.navAttendance, icon: 'clock', requires: ['attendance.manage', 'attendance.finalize', 'hr.config'], page: 'attendance.view' },
      { to: paths.adminLeave, label: ht.navLeave, icon: 'calendar', requires: ['leave.approve', 'leave.adjust'], page: 'attendance.view' },
      // Those who prepare or approve payroll see the menu item; salary viewers may open the page.
      { to: paths.adminPayroll, label: ht.navPayrollRuns, icon: 'payments', requires: ['payroll.run', 'payroll.approve'], page: 'salary.view' },
    ],
  },
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
      { to: paths.adminWebsiteAdmins, label: st.navWebsiteAdmins, icon: 'people', requires: 'website.manage' },
      { to: paths.adminAudit, label: t.navAudit, icon: 'history', requires: 'audit.view' },
    ],
  },
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
      { to: paths.adminSettingsWhatsApp, label: wt.nav, icon: 'chat', requires: 'messaging.manage' },
      { to: paths.adminSettingsDelivery, label: dt.navSettings, icon: 'parcel', requires: 'delivery.configure' },
      { to: paths.adminWebsiteConnections, label: st.navConnections, icon: 'tune', requires: 'website.manage' },
    ],
  },
  // Every staff member's own job: their profile, attendance, leave, payslips and documents.
  {
    id: 'me',
    label: t.groupMyEmployment,
    icon: 'home',
    items: [
      { to: paths.staff, label: ht.navMyProfile, icon: 'person', requires: null },
      { to: paths.adminMyAttendance, label: ht.navMyAttendance, icon: 'clock', requires: null },
      { to: paths.adminMyLeave, label: ht.navMyLeave, icon: 'calendar', requires: null },
      { to: paths.adminMyPayslips, label: ht.navMyPayslips, icon: 'payments', requires: null },
      { to: paths.adminMyDeliveries, label: dt.navMine, icon: 'parcel', requires: ['delivery.execute', 'delivery.manage'] },
      { to: paths.adminMyOnboarding, label: ht.obNav, icon: 'badge', requires: null },
    ],
  },
];

const itemsOf = (entries: NavEntry[]) => entries.flatMap((e) => (isGroup(e) ? e.items : [e]));

/** Every page in the menu, for guards and titles. */
export const NAV: NavItem[] = itemsOf(MENU);

export const allowed = (claims: StoriesClaims, orgId: string | null, requires: Requirement) =>
  requires === null ? true : requires === 'superAdmin' ? claims.sa : (Array.isArray(requires) ? requires : [requires]).some((p) => can(claims, p, orgId));

/** The menu for the current user: items they may use, groups with none left removed (UI convenience only). */
export function visibleMenu(claims: StoriesClaims, orgId: string | null): NavEntry[] {
  if (!isStaff(claims)) return [];
  return MENU.flatMap((e): NavEntry[] => {
    if (!isGroup(e)) return allowed(claims, orgId, e.requires) ? [e] : [];
    const items = e.items.filter((i) => allowed(claims, orgId, i.requires));
    return items.length ? [{ ...e, items }] : [];
  });
}

/** The pages a user sees in the menu, flattened. */
export const visibleNav = (claims: StoriesClaims, orgId: string | null) => itemsOf(visibleMenu(claims, orgId));

/** The menu item a location belongs to (longest matching path), for guards and titles. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV.filter((i) => pathname === i.to || (!i.home && pathname.startsWith(`${i.to}/`))).sort((a, b) => b.to.length - a.to.length)[0];
}

/** The group holding a location, so it can start open. */
export const groupFor = (entries: NavEntry[], pathname: string) =>
  entries.find((e) => isGroup(e) && e.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))) as NavGroup | undefined;
