import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';

import { t } from '../strings';
import { services } from './services';

/** A failure safe to show to the user; `reason` is the server's stable code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

const passThrough = new Set(['invalid-argument', 'failed-precondition', 'permission-denied', 'not-found', 'unauthenticated']);

/** Maps a Functions error to an ApiError. Server messages for domain errors are written for users. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof FirebaseError) {
    const code = e.code.replace(/^functions\//, '');
    const reason = (e as FirebaseError & { details?: { reason?: string } }).details?.reason ?? code.toUpperCase();
    // The SDK appends the HTTP status (" [400]") to server messages; users don't need it.
    const message = e.message.replace(/\s*\[\d{3}\]$/, '');
    if (passThrough.has(code) && message) return new ApiError(message, reason);
    if (code === 'unavailable' || code === 'deadline-exceeded') return new ApiError(t.errorNetwork, 'NETWORK');
    return new ApiError(t.errorGeneric, reason);
  }
  if (e instanceof ApiError) return e;
  return new ApiError(t.errorGeneric, 'UNKNOWN');
}

/**
 * Calls a mutating Cloud Function (a "command"). A fresh requestId makes the
 * call safe to retry: the server returns the stored result instead of
 * repeating the change.
 */
export async function command<R = unknown>(name: string, data: Record<string, unknown>, requestId = crypto.randomUUID()): Promise<R> {
  try {
    const res = await httpsCallable<Record<string, unknown>, R>(services().fns, name)({ ...data, requestId });
    return res.data;
  } catch (e) {
    throw toApiError(e);
  }
}
