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
  | 'providerDisabled'
  | 'popupBlocked'
  | 'unauthorizedDomain'
  | 'unknown';

/** A user-presentable auth error. Raw Firebase messages are never shown. */
export class AuthFailure extends Error {
  /** `firebaseCode` keeps the raw code (e.g. `auth/internal-error`) so unknown errors can be diagnosed. */
  constructor(
    readonly code: AuthFailureCode,
    readonly firebaseCode?: string,
  ) {
    super(`AuthFailure(${code}${firebaseCode ? `, ${firebaseCode}` : ''})`);
  }

  static fromFirebaseCode(firebaseCode: string): AuthFailure {
    const failure = (code: AuthFailureCode) => new AuthFailure(code, firebaseCode);
    switch (firebaseCode.replace(/^auth\//, '')) {
      case 'invalid-credential':
      case 'wrong-password':
      case 'user-not-found':
      case 'invalid-email':
        return failure('invalidCredentials');
      case 'email-already-in-use':
        return failure('emailInUse');
      case 'weak-password':
        return failure('weakPassword');
      case 'too-many-requests':
        return failure('tooManyRequests');
      case 'network-request-failed':
        return failure('network');
      case 'popup-closed-by-user':
      case 'cancelled-popup-request':
        return failure('popupClosed');
      case 'user-disabled':
        return failure('userDisabled');
      case 'operation-not-allowed':
      case 'configuration-not-found':
        return failure('providerDisabled');
      case 'popup-blocked':
        return failure('popupBlocked');
      case 'unauthorized-domain':
        return failure('unauthorizedDomain');
      default:
        return failure('unknown');
    }
  }
}
