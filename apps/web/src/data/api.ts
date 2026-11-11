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

const passThrough = new Set(['invalid-argument', 'failed-precondition', 'permission-denied', 'not-found', 'unauthenticated', 'aborted']);

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
 * Text for a failure, safe to show to the user: the server's message for a
 * command or read (ApiError), a plain sentence for well-known database
 * failures, otherwise `fallback`. Never the raw SDK message ("Missing or
 * insufficient permissions.").
 */
export function errorText(e: unknown, fallback: string = t.errorGeneric): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof FirebaseError && e.code.startsWith('functions/')) return toApiError(e).message;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    switch (code.replace(/^firestore\//, '')) {
      case 'permission-denied':
        return t.errorForbidden;
      // A database index is missing or still building (after a deploy).
      case 'failed-precondition':
        return t.errorIndex;
      case 'unavailable':
      case 'deadline-exceeded':
        return t.errorNetwork;
    }
  }
  return fallback;
}

/**
 * Actions are grouped into a few deployed functions ("routers") to stay within
 * the project's Cloud Run CPU quota (functions/src/index.ts). The router is
 * chosen by the action's prefix; the action name itself is unchanged.
 */
const ROUTERS: Record<string, string> = {
  users: 'admin', platform: 'admin', orgs: 'admin', branches: 'admin', departments: 'admin', staff: 'admin', roles: 'admin', config: 'admin', whatsapp: 'admin', site: 'admin',
  books: 'catalogue', authors: 'catalogue', publishers: 'catalogue', categories: 'catalogue',
  copies: 'inventory', locations: 'inventory',
  members: 'members', me: 'members',
  plans: 'billing', subscriptions: 'billing', payments: 'billing', deposits: 'billing',
  circulation: 'circulation', reservations: 'circulation', transfers: 'circulation', deliveries: 'circulation',
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
 * Failures after which the change may or may not have happened, and that are
 * safe to retry with the same requestId (the server returns the stored result
 * instead of repeating the change): Firestore contention or a step after the
 * commit (`aborted`), an overloaded backend (`unavailable`), a timeout, and a
 * dropped connection (the SDK reports it as `internal` with no server message).
 */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof FirebaseError)) return false;
  const code = e.code.replace(/^functions\//, '');
  return code === 'aborted' || code === 'unavailable' || code === 'deadline-exceeded' || (code === 'internal' && /^internal$/i.test(e.message.trim()));
}

const RETRY_DELAYS_MS = [400, 1600];
const REMEMBER_MS = 10 * 60_000;
/** requestIds of commands whose outcome is unknown, by action + input, so an identical retry by the user is recognised. */
const unsettled = new Map<string, { requestId: string; at: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const keyOf = (name: string, data: Record<string, unknown>) =>
  `${name}:${JSON.stringify(data, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))}`;

/**
 * Calls a mutating Cloud Function (a "command") exactly once, even when the
 * network or the backend fails part-way:
 * - transient failures are retried automatically with the same requestId;
 * - if they persist, the requestId is remembered for this action and input for
 *   10 minutes, so pressing the button again replays the same request (the
 *   server returns its stored result) instead of doing the change twice.
 * Pass `requestId` to manage it yourself (e.g. one per dialog).
 */
export async function command<R = unknown>(name: string, data: Record<string, unknown>, requestId?: string): Promise<R> {
  const key = requestId ? null : keyOf(name, data);
  const prior = key ? unsettled.get(key) : undefined;
  const id = requestId ?? (prior && Date.now() - prior.at < REMEMBER_MS ? prior.requestId : crypto.randomUUID());
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await callAction<R>(services().fns, name, { ...data, requestId: id });
      if (key) unsettled.delete(key);
      return result;
    } catch (e) {
      const retryable = isRetryable(e);
      if (retryable && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (key) {
        if (retryable) {
          if (unsettled.size > 100) unsettled.delete(unsettled.keys().next().value!);
          unsettled.set(key, { requestId: id, at: Date.now() });
        } else unsettled.delete(key);
      }
      throw toApiError(e);
    }
  }
}

/** Calls an action once (reads, and jobs that are safe to repeat); failures arrive as ApiError. */
export async function call<R = unknown>(action: string, data: Record<string, unknown>): Promise<R> {
  try {
    return await callAction<R>(services().fns, action, data);
  } catch (e) {
    throw toApiError(e);
  }
}
