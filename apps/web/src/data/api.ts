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
 * Every action is served by one deployed function (functions/src/index.ts), so
 * any call from any screen keeps the whole backend awake. It is called with
 * `{ action: 'books-create', ... }`.
 */
const API = 'api';

/**
 * The seven functions ("routers") that served the actions before `api`, by the
 * action's prefix. Used only as a fallback while the deployed backend is older
 * than this app and has no `api` yet (see `callAction`); the backend keeps them
 * for one release. Remove this table and the fallback together with them.
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

const legacyRouter = (action: string): string | undefined => {
  const prefix = action.split('-')[0];
  return Object.hasOwn(ROUTERS, prefix) ? ROUTERS[prefix] : undefined;
};

/** The older router that serves an action (the fallback while the backend has no `api`). */
export function routerFor(action: string): string {
  const router = legacyRouter(action);
  if (!router) throw new Error(`No router for action ${action}`);
  return router;
}

const codeOf = (e: FirebaseError) => e.code.replace(/^functions\//, '');

/**
 * A request that got no readable answer: the SDK reports it as `internal` with
 * no server message ("internal", or "internal [0]" with the status it appends).
 * It is what a dropped connection looks like, and, in a browser, also a function
 * that is not deployed (its 404 carries no CORS headers, so it cannot be read).
 */
const unanswered = (e: FirebaseError) => codeOf(e) === 'internal' && /^internal( \[0\])?$/i.test(e.message.trim());

/** The router's own answer for an action it does not serve. */
const unknownAction = (e: FirebaseError) => codeOf(e) === 'not-found' && /^unknown action\.?(\s*\[\d{3}\])?$/i.test(e.message.trim());
const detailsOf = (e: FirebaseError) => (e as FirebaseError & { details?: { reason?: unknown } }).details;

/** Whether a failure can mean "that function is not deployed": no readable answer, or a plain 404 that is neither the router's "Unknown action." nor a domain's own "… was not found." (those carry a reason). */
function maybeMissing(e: unknown): boolean {
  if (!(e instanceof FirebaseError)) return false;
  return unanswered(e) || (codeOf(e) === 'not-found' && detailsOf(e) === undefined && !unknownAction(e));
}

/** Whether a failure proves the function ran: one of the server's own errors (they carry a reason) or the router's "Unknown action." */
function ranOnServer(e: unknown): boolean {
  if (!(e instanceof FirebaseError) || !e.code.startsWith('functions/')) return false;
  return typeof detailsOf(e)?.reason === 'string' || unknownAction(e);
}

const NEVER = Number.NEGATIVE_INFINITY;
const PROBE_API_AFTER_MS = 5 * 60_000;
const WARM_EVERY_MS = 10 * 60_000;
/** `api` has answered in this session, so it is deployed: from then on nothing falls back to the older routers. */
let apiAnswered = false;
/** Until when calls go straight to the older routers, because `api` was missing and they answered; after that `api` is tried again. */
let legacyUntil = NEVER;
/** When `api` was last known to be awake: a call it answered, or a ping on its way. */
let warmAt = NEVER;

/** For tests: forget what this session has learnt about the backend. */
export function resetBackendState(): void {
  apiAnswered = false;
  legacyUntil = NEVER;
  warmAt = NEVER;
}

/**
 * Calls an action (reads and naturally idempotent actions; commands go through
 * `command`). It calls `api`; while the deployed backend is older than this app
 * and has no `api` yet, the same payload is sent once more to the older router
 * that serves the action. A command carries the same requestId both times, so
 * it can never run twice.
 */
export async function callAction<R = unknown>(fns: Functions, action: string, data: Record<string, unknown>): Promise<R> {
  const payload = { action, ...data };
  const send = async (fn: string) => (await httpsCallable<Record<string, unknown>, R>(fns, fn)(payload)).data;
  const legacy = apiAnswered ? undefined : legacyRouter(action);
  if (legacy && Date.now() < legacyUntil) return send(legacy);
  try {
    const result = await send(API);
    apiAnswered = true;
    warmAt = Date.now();
    return result;
  } catch (e) {
    if (ranOnServer(e)) apiAnswered = true;
    // `apiAnswered` is read again: another call may have been answered meanwhile.
    if (apiAnswered || !legacy || !maybeMissing(e)) throw e;
    try {
      const result = await send(legacy);
      legacyUntil = Date.now() + PROBE_API_AFTER_MS;
      return result;
    } catch (e2) {
      if (ranOnServer(e2)) legacyUntil = Date.now() + PROBE_API_AFTER_MS;
      throw maybeMissing(e2) ? e : e2;
    }
  }
}

/**
 * Wakes the backend up ahead of the first action, so that action does not wait
 * for it to start (it goes to sleep when nobody has called it for a while).
 * Sends at most one small signed-in request per 10 minutes, none while a real
 * call has just been answered, and never fails: a backend that cannot be
 * reached, or does not know the request yet, is simply tried again next time.
 */
export function warm(): void {
  try {
    const now = Date.now();
    if (now - warmAt < WARM_EVERY_MS || now < legacyUntil) return;
    warmAt = now;
    httpsCallable(services().fns, API)({ action: 'ping' }).then(
      () => {
        apiAnswered = true;
      },
      () => {
        if (warmAt === now) warmAt = NEVER;
      },
    );
  } catch {
    warmAt = NEVER;
  }
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
  const code = codeOf(e);
  return code === 'aborted' || code === 'unavailable' || code === 'deadline-exceeded' || unanswered(e);
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
