import { describe, expect, it } from 'vitest';

import { AuthFailure } from '../auth/models';
import { authRedirect, paths } from '../paths';

describe('authRedirect', () => {
  it('sends signed-out users to sign-in', () => {
    expect(authRedirect(false, paths.explore)).toBe(paths.signIn);
    expect(authRedirect(false, paths.signIn)).toBeNull();
  });
  it('sends signed-in users away from sign-in (staff to the console)', () => {
    expect(authRedirect(true, paths.signIn)).toBe(paths.home);
    expect(authRedirect(true, paths.signIn, true)).toBe(paths.admin);
    expect(authRedirect(true, paths.membership)).toBeNull();
  });
});

describe('AuthFailure.fromFirebaseCode', () => {
  it.each([
    ['auth/invalid-credential', 'invalidCredentials'],
    ['auth/email-already-in-use', 'emailInUse'],
    ['auth/network-request-failed', 'network'],
    ['auth/operation-not-allowed', 'providerDisabled'],
    ['auth/configuration-not-found', 'providerDisabled'],
    ['auth/popup-blocked', 'popupBlocked'],
    ['auth/unauthorized-domain', 'unauthorizedDomain'],
    ['auth/something-new', 'unknown'],
  ])('%s → %s', (code, expected) => {
    expect(AuthFailure.fromFirebaseCode(code).code).toBe(expected);
  });
});
