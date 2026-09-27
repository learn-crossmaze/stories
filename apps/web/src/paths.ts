export const paths = {
  signIn: '/sign-in',
  setup: '/setup',
  home: '/',
  explore: '/explore',
  myBooks: '/my-books',
  orders: '/orders',
  profile: '/profile',
  admin: '/admin',
  adminOrgs: '/admin/organizations',
  adminBranches: '/admin/branches',
  adminDepartments: '/admin/departments',
  adminStaff: '/admin/staff',
  adminAudit: '/admin/audit',
} as const;

/** Pure redirect rule, kept separate so it can be unit tested. */
export function authRedirect(signedIn: boolean, location: string, staff = false): string | null {
  const onSignIn = location === paths.signIn;
  if (!signedIn) return onSignIn ? null : paths.signIn;
  if (onSignIn) return staff ? paths.admin : paths.home;
  return null;
}
