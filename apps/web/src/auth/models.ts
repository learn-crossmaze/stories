/**
 * The signed-in identity as the app needs it. Authorization (roles,
 * organizations, branches) is resolved separately and enforced server-side.
 */
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export type AuthFailureCode =
  | 'invalidCredentials'
  | 'emailInUse'
  | 'weakPassword'
  | 'tooManyRequests'
  | 'network'
  | 'popupClosed'
  | 'userDisabled'
  | 'unknown';

/** A user-presentable auth error. Raw Firebase messages are never shown. */
export class AuthFailure extends Error {
  constructor(readonly code: AuthFailureCode) {
    super(`AuthFailure(${code})`);
  }

  static fromFirebaseCode(code: string): AuthFailure {
    switch (code.replace(/^auth\//, '')) {
      case 'invalid-credential':
      case 'wrong-password':
      case 'user-not-found':
      case 'invalid-email':
        return new AuthFailure('invalidCredentials');
      case 'email-already-in-use':
        return new AuthFailure('emailInUse');
      case 'weak-password':
        return new AuthFailure('weakPassword');
      case 'too-many-requests':
        return new AuthFailure('tooManyRequests');
      case 'network-request-failed':
        return new AuthFailure('network');
      case 'popup-closed-by-user':
      case 'cancelled-popup-request':
        return new AuthFailure('popupClosed');
      case 'user-disabled':
        return new AuthFailure('userDisabled');
      default:
        return new AuthFailure('unknown');
    }
  }
}
