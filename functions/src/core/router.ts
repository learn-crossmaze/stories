import { type CallableFunction, type CallableOptions, type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

import { errors } from './errors.js';
import { db, ENFORCE_APP_CHECK, REGION } from './firebase.js';

/** How long a browser may reuse the answer to the CORS preflight (seconds). 2 hours is Chrome's cap; without the header it is 5 seconds. */
const PREFLIGHT_MAX_AGE_S = '7200';

/**
 * Groups many callables behind one deployed function. Each Cloud Function is
 * its own Cloud Run service that reserves CPU and goes cold on its own, so
 * every action is served by one function, `api` (functions/src/index.ts).
 *
 * The client sends `{ action: '<name>', ...data }` (e.g. `books-create`); the
 * router hands the request to that action's own handler unchanged, so auth,
 * validation, permission checks, the transaction, audit and idempotency all
 * behave exactly as if the action were deployed on its own.
 *
 * Two things the router does itself:
 * - `{ action: 'ping' }` from a signed-in caller wakes the function up before
 *   the first real call (the console sends it on open). It reads the caller's
 *   own profile, so the database connection is open too, and writes nothing.
 * - The answer to the browser's CORS preflight may be cached for 2 hours, so a
 *   call is one HTTP round trip instead of two.
 *
 * `opts` adds deploy options (e.g. memory); it cannot change the region or
 * switch App Check off.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function router(routes: Record<string, CallableFunction<any, any>>, opts: Partial<CallableOptions> = {}) {
  const fn = onCall({ ...opts, region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req: CallableRequest) => {
    const { action, ...data } = (req.data ?? {}) as { action?: unknown };
    if (action === 'ping') {
      if (!req.auth) throw errors.unauthenticated();
      await db.doc(`users/${req.auth.uid}`).get();
      return { ok: true };
    }
    const route = typeof action === 'string' && Object.hasOwn(routes, action) ? routes[action] : undefined;
    if (!route) throw new HttpsError('not-found', 'Unknown action.');
    return route.run({ ...req, data });
  });
  // onCall has no setting for the preflight's max age, and its CORS step answers OPTIONS itself, so the header
  // is set before handing over. A Proxy keeps everything else of the callable (`run`, `__endpoint`, …) as it is.
  return new Proxy(fn, {
    apply(target, thisArg, args: Parameters<typeof fn>) {
      const [req, res] = args;
      if (req.method === 'OPTIONS') res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_S);
      return Reflect.apply(target, thisArg, args);
    },
  });
}
