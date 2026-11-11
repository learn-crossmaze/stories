export const paths = {
  signIn: '/sign-in',
  setup: '/setup',
  home: '/',
  explore: '/explore',
  myBooks: '/my-books',
  membership: '/membership',
  profile: '/profile',
  // Staff console views: Admin (setup, back office), Operations (daily running), Staff (self-service).
  admin: '/admin',
  ops: '/ops',
  staff: '/me',
  opsAttendance: '/ops/attendance',
  opsLeave: '/ops/leave',
  opsOffers: '/ops/offer-letters',
  adminOrgs: '/admin/organizations',
  adminBranches: '/admin/branches',
  adminDepartments: '/admin/departments',
  adminStaff: '/admin/staff',
  adminAudit: '/admin/audit',
  adminDesk: '/ops/desk',
  adminBooks: '/ops/books',
  adminBooksBulk: '/ops/books/bulk',
  adminBook: (id: string) => `/ops/books/${id}`,
  adminInventory: '/ops/inventory',
  adminCopy: (id: string) => `/ops/inventory/${id}`,
  adminLabels: '/ops/labels',
  adminShelve: '/ops/inventory/shelve',
  adminReservations: '/ops/reservations',
  adminTransfers: '/ops/transfers',
  opsDeliveries: '/ops/deliveries',
  adminMembers: '/ops/members',
  adminMember: (id: string) => `/ops/members/${id}`,
  adminPlans: '/ops/plans',
  adminDeposits: '/ops/deposits',
  adminPayments: '/ops/payments',
  adminAppearance: '/me/appearance',
  adminPeople: '/admin/people',
  adminPeopleOverview: '/admin/people-overview',
  adminMe: '/me',
  adminMyOnboarding: '/me/complete-profile',
  adminEmployee: (id: string) => `/admin/people/${id}`,
  adminHrSettings: '/admin/settings/jobs',
  adminSettingsSchedule: '/admin/settings/schedule',
  adminSettingsLeave: '/admin/settings/leave',
  adminSettingsDocuments: '/admin/settings/documents',
  adminSettingsLetters: '/admin/settings/letters',
  adminSettingsPayroll: '/admin/settings/payroll',
  adminSettingsWhatsApp: '/admin/settings/whatsapp',
  adminSettingsDelivery: '/admin/settings/delivery',
  adminDocuments: '/admin/documents',
  adminOffers: '/admin/offer-letters',
  adminAttendance: '/admin/attendance',
  adminMyAttendance: '/me/attendance',
  adminLeave: '/admin/leave',
  adminMyLeave: '/me/leave',
  adminPayroll: '/admin/payroll',
  adminMyPayslips: '/me/payslips',
  adminMyDeliveries: '/me/deliveries',
  // The Website view (/website, like crossmaze.in/admin): what storiesforall.in shows.
  web: '/website',
  adminWebsite: '/website',
  adminWebsiteSettings: '/website/site',
  adminWebsiteSections: '/website/sections',
  adminWebsiteBranches: '/website/branches',
  adminWebsiteBranch: (orgId: string, branchId: string) => `/website/branches/${orgId}/${branchId}`,
  adminWebsitePlans: '/website/plans',
  adminWebsitePromotions: '/website/offers',
  adminWebsitePromotion: (id: string) => `/website/offers/${id}`,
  adminWebsiteJobs: '/website/jobs',
  adminWebsiteJob: (id: string) => `/website/jobs/${id}`,
  adminWebsiteBlog: '/website/blog',
  adminWebsitePost: (id: string) => `/website/blog/${id}`,
  adminWebsiteCards: '/website/greetings',
  adminWebsiteTestimonials: '/website/testimonials',
  adminWebsiteTestimonial: (id: string) => `/website/testimonials/${id}`,
  adminWebsiteSubmissions: '/website/submissions',
  adminWebsiteSubmission: (id: string) => `/website/submissions/${id}`,
  adminWebsiteCalls: '/website/calls',
  adminWebsiteConnections: '/website/connections',
  adminWebsiteAdmins: '/website/admins',
} as const;

export const viewHome = { admin: paths.admin, web: paths.web, ops: paths.ops, staff: paths.staff } as const;

/**
 * Pure redirect rule, kept separate so it can be unit tested. `staffHome` is
 * where a staff member lands after signing in (null for members).
 */
export function authRedirect(signedIn: boolean, location: string, staffHome: string | null = null): string | null {
  const onSignIn = location === paths.signIn;
  if (!signedIn) return onSignIn ? null : paths.signIn;
  if (onSignIn) return staffHome ?? paths.home;
  return null;
}

/** A `next` value is followed only when it is a path on this site (not "//elsewhere" or a full URL). */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') && next !== paths.signIn ? next : null);

/**
 * The member area's rule: like {@link authRedirect}, but a signed-out visitor keeps where they were going
 * (`/sign-in?next=/membership`), and lands there after signing in. Sign-up links from the website pass through
 * `create=1`.
 */
export function memberRedirect(signedIn: boolean, pathname: string, search = ''): string | null {
  const params = new URLSearchParams(search);
  if (pathname === paths.signIn) return signedIn ? (safeNext(params.get('next')) ?? paths.home) : null;
  if (signedIn) return null;
  const target = `${pathname}${search}`;
  return pathname === paths.home && !search ? paths.signIn : `${paths.signIn}?next=${encodeURIComponent(target)}`;
}
