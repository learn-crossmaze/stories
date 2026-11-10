import { describe, expect, it } from 'vitest';

import { AuthFailure } from '../auth/models';
import { authRedirect, memberRedirect, paths } from '../paths';

describe('authRedirect', () => {
  it('sends signed-out users to sign-in', () => {
    expect(authRedirect(false, paths.explore)).toBe(paths.signIn);
    expect(authRedirect(false, paths.signIn)).toBeNull();
  });
  it('sends signed-in users away from sign-in (staff to the console)', () => {
    expect(authRedirect(true, paths.signIn)).toBe(paths.home);
    expect(authRedirect(true, paths.signIn, paths.ops)).toBe(paths.ops);
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

describe('ISBN checks in the browser', async () => {
  const { normalizeIsbn, splitIsbns } = await import('../shared/isbn');
  it('accepts valid ISBN-10 and ISBN-13 with hyphens, rejects typos', () => {
    expect(normalizeIsbn('978-0-14-044913-6')).toBe('9780140449136');
    expect(normalizeIsbn('0-14-044913-2')).toBe('9780140449136');
    expect(normalizeIsbn('9780140449137')).toBeNull();
    expect(normalizeIsbn('12345')).toBeNull();
  });
  it('splits a pasted list', () => {
    expect(splitIsbns('9780140449136\n0-14-044913-2, 9780000000017;junk')).toEqual(['9780140449136', '0-14-044913-2', '9780000000017']);
  });
});

describe('memberRedirect', () => {
  it('keeps where a signed-out visitor was going and returns them there', () => {
    expect(memberRedirect(false, paths.home)).toBe(paths.signIn);
    expect(memberRedirect(false, paths.membership, '?plan=p1')).toBe('/sign-in?next=%2Fmembership%3Fplan%3Dp1');
    expect(memberRedirect(false, paths.signIn, '?create=1')).toBeNull();
    expect(memberRedirect(true, paths.signIn, '?next=%2Fmembership')).toBe(paths.membership);
    expect(memberRedirect(true, paths.explore)).toBeNull();
  });

  it('only follows next to pages on this site', () => {
    expect(memberRedirect(true, paths.signIn, '?next=//evil.example')).toBe(paths.home);
    expect(memberRedirect(true, paths.signIn, '?next=https://evil.example')).toBe(paths.home);
    expect(memberRedirect(true, paths.signIn)).toBe(paths.home);
  });
});
