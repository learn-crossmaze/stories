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
  adminReservations: '/ops/reservations',
  adminTransfers: '/ops/transfers',
  adminMembers: '/ops/members',
  adminMember: (id: string) => `/ops/members/${id}`,
  adminPlans: '/ops/plans',
  adminDeposits: '/ops/deposits',
  adminAppearance: '/me/appearance',
  adminPeople: '/admin/people',
  adminPeopleOverview: '/admin/people-overview',
  adminMe: '/me',
  adminEmployee: (id: string) => `/admin/people/${id}`,
  adminHrSettings: '/admin/settings/jobs',
  adminSettingsSchedule: '/admin/settings/schedule',
  adminSettingsLeave: '/admin/settings/leave',
  adminSettingsDocuments: '/admin/settings/documents',
  adminSettingsLetters: '/admin/settings/letters',
  adminSettingsPayroll: '/admin/settings/payroll',
  adminDocuments: '/admin/documents',
  adminOffers: '/admin/offer-letters',
  adminAttendance: '/admin/attendance',
  adminMyAttendance: '/me/attendance',
  adminLeave: '/admin/leave',
  adminMyLeave: '/me/leave',
  adminPayroll: '/admin/payroll',
  adminMyPayslips: '/me/payslips',
} as const;

export const viewHome = { admin: paths.admin, ops: paths.ops, staff: paths.staff } as const;

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
