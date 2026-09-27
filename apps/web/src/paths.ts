export const paths = {
  signIn: '/sign-in',
  home: '/',
  explore: '/explore',
  myBooks: '/my-books',
  orders: '/orders',
  profile: '/profile',
} as const;

/** Pure redirect rule, kept separate so it can be unit tested. */
export function authRedirect(signedIn: boolean, location: string): string | null {
  const onSignIn = location === paths.signIn;
  if (!signedIn) return onSignIn ? null : paths.signIn;
  return onSignIn ? paths.home : null;
}
