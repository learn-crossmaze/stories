import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

/**
 * Domain failure with a message safe to show to users. `reason` is a stable
 * machine code the client can branch on. Never put internal details here.
 */
export class AppError extends HttpsError {
  constructor(code: FunctionsErrorCode, reason: string, message: string) {
    super(code, message, { reason });
  }
}

export const errors = {
  unauthenticated: () => new AppError('unauthenticated', 'UNAUTHENTICATED', 'Please sign in to continue.'),
  inactiveUser: () =>
    new AppError('permission-denied', 'USER_INACTIVE', 'Your account is not active. Please contact Stories support.'),
  forbidden: (message = "You don't have permission to perform this action.") =>
    new AppError('permission-denied', 'FORBIDDEN', message),
  invalid: (message: string) => new AppError('invalid-argument', 'INVALID_INPUT', message),
  notFound: (what: string) => new AppError('not-found', 'NOT_FOUND', `${what} was not found.`),
  conflict: (reason: string, message: string) => new AppError('failed-precondition', reason, message),
};
