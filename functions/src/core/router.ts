import { type CallableFunction, type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

import { REGION } from './firebase.js';

const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

/**
 * Groups many callables behind one deployed function. Each Cloud Function is
 * its own Cloud Run service reserving CPU, so deploying ~60 of them exceeds a
 * project's regional CPU quota; a handful of routers stays well inside it.
 *
 * The client sends `{ action: '<name>', ...data }` (e.g. `books-create`); the
 * router hands the request to that action's own handler unchanged, so auth,
 * validation, permission checks, the transaction, audit and idempotency all
 * behave exactly as if the action were deployed on its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function router(routes: Record<string, CallableFunction<any, any>>) {
  return onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req: CallableRequest) => {
    const { action, ...data } = (req.data ?? {}) as { action?: unknown };
    const route = typeof action === 'string' && Object.hasOwn(routes, action) ? routes[action] : undefined;
    if (!route) throw new HttpsError('not-found', 'Unknown action.');
    return route.run({ ...req, data });
  });
}
