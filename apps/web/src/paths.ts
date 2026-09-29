export const paths = {
  signIn: '/sign-in',
  setup: '/setup',
  home: '/',
  explore: '/explore',
  myBooks: '/my-books',
  membership: '/membership',
  profile: '/profile',
  admin: '/admin',
  adminOrgs: '/admin/organizations',
  adminBranches: '/admin/branches',
  adminDepartments: '/admin/departments',
  adminStaff: '/admin/staff',
  adminAudit: '/admin/audit',
  adminDesk: '/admin/desk',
  adminBooks: '/admin/books',
  adminBook: (id: string) => `/admin/books/${id}`,
  adminInventory: '/admin/inventory',
  adminCopy: (id: string) => `/admin/inventory/${id}`,
  adminLabels: '/admin/labels',
  adminReservations: '/admin/reservations',
  adminTransfers: '/admin/transfers',
  adminMembers: '/admin/members',
  adminMember: (id: string) => `/admin/members/${id}`,
  adminPlans: '/admin/plans',
  adminDeposits: '/admin/deposits',
  adminAppearance: '/admin/appearance',
  adminPeople: '/admin/people',
  adminEmployee: (id: string) => `/admin/people/${id}`,
  adminHrSettings: '/admin/hr-settings',
  adminDocuments: '/admin/documents',
} as const;

/** Pure redirect rule, kept separate so it can be unit tested. */
export function authRedirect(signedIn: boolean, location: string, staff = false): string | null {
  const onSignIn = location === paths.signIn;
  if (!signedIn) return onSignIn ? null : paths.signIn;
  if (onSignIn) return staff ? paths.admin : paths.home;
  return null;
}
