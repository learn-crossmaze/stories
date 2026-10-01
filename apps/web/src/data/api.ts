import { FirebaseError } from 'firebase/app';
import { type Functions, httpsCallable } from 'firebase/functions';

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
    // The web app is newer than the deployed backend: the router doesn't know the action (or the function is missing).
    if (code === 'not-found' && /^(unknown action\.?|not[ _-]?found)$/i.test(message)) return new ApiError(t.errorServerOutdated, 'SERVER_OUTDATED');
    if (passThrough.has(code) && message) return new ApiError(message, reason);
    if (code === 'unavailable' || code === 'deadline-exceeded') return new ApiError(t.errorNetwork, 'NETWORK');
    return new ApiError(t.errorGeneric, reason);
  }
  if (e instanceof ApiError) return e;
  return new ApiError(t.errorGeneric, 'UNKNOWN');
}

/**
 * Actions are grouped into a few deployed functions ("routers") to stay within
 * the project's Cloud Run CPU quota (functions/src/index.ts). The router is
 * chosen by the action's prefix; the action name itself is unchanged.
 */
const ROUTERS: Record<string, string> = {
  users: 'admin', platform: 'admin', orgs: 'admin', branches: 'admin', departments: 'admin', staff: 'admin', whatsapp: 'admin',
  books: 'catalogue', authors: 'catalogue', publishers: 'catalogue', categories: 'catalogue',
  copies: 'inventory', locations: 'inventory',
  members: 'members', me: 'members',
  plans: 'billing', subscriptions: 'billing', payments: 'billing', deposits: 'billing',
  circulation: 'circulation', reservations: 'circulation', transfers: 'circulation',
  employees: 'hr', designations: 'hr', hr: 'hr', documents: 'hr', documentTypes: 'hr', offers: 'hr', letters: 'hr', letterTemplates: 'hr', shifts: 'hr', holidays: 'hr', attendance: 'hr', leave: 'hr', leaveTypes: 'hr',
  payroll: 'hr', payrollSettings: 'hr', salary: 'hr', payslips: 'hr',
};

export function routerFor(action: string): string {
  const router = ROUTERS[action.split('-')[0]];
  if (!router) throw new Error(`No router for action ${action}`);
  return router;
}

/** Calls an action through its router (reads and naturally idempotent actions). */
export async function callAction<R = unknown>(fns: Functions, action: string, data: Record<string, unknown>): Promise<R> {
  const res = await httpsCallable<Record<string, unknown>, R>(fns, routerFor(action))({ action, ...data });
  return res.data;
}

/**
 * Calls a mutating Cloud Function (a "command"). A fresh requestId makes the
 * call safe to retry: the server returns the stored result instead of
 * repeating the change.
 */
export const command = <R = unknown>(name: string, data: Record<string, unknown>, requestId = crypto.randomUUID()): Promise<R> =>
  call<R>(name, { ...data, requestId });

/** Calls an action once (reads, and jobs that are safe to repeat); failures arrive as ApiError. */
export async function call<R = unknown>(action: string, data: Record<string, unknown>): Promise<R> {
  try {
    return await callAction<R>(services().fns, action, data);
  } catch (e) {
    throw toApiError(e);
  }
}
