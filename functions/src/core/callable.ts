import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { AppError, errors } from './errors.js';
import { db, REGION } from './firebase.js';
import { Actor, type UserProfile } from './rbac.js';

// App Check is enforced once it is registered for the web app (docs/ENVIRONMENTS.md §4).
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';
const IDEMPOTENCY_TTL_DAYS = 30;

export const requestIdSchema = z.uuid();

export interface CallContext<I> {
  actor: Actor;
  input: I;
  requestId?: string;
}

async function loadActor(req: CallableRequest): Promise<Actor> {
  if (!req.auth) throw errors.unauthenticated();
  const snap = await db.doc(`users/${req.auth.uid}`).get();
  const profile = snap.exists ? (snap.data() as UserProfile) : null;
  if (profile && profile.status !== 'ACTIVE') throw errors.inactiveUser();
  return new Actor(
    req.auth.uid,
    (req.auth.token.email as string | undefined) ?? null,
    req.auth.token.email_verified === true,
    profile,
  );
}

function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'input';
    throw errors.invalid(`Please check ${field}: ${issue?.message ?? 'invalid value'}.`);
  }
  return result.data;
}

/** Hides unexpected failures behind a generic message; domain errors pass through. */
function safe(e: unknown, name: string): never {
  if (e instanceof AppError || e instanceof HttpsError) throw e;
  logger.error(`${name} failed`, e);
  throw new HttpsError('internal', 'Something went wrong on our side. Please try again.');
}

/**
 * Read-only or naturally idempotent callable: auth → validate → handler.
 */
export function query<S extends z.ZodType, R>(
  name: string,
  schema: S,
  handler: (ctx: CallContext<z.infer<S>>) => Promise<R>,
) {
  return onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
    try {
      const actor = await loadActor(req);
      return await handler({ actor, input: parse(schema, req.data) });
    } catch (e) {
      safe(e, name);
    }
  });
}

/**
 * Mutating callable. Pipeline (docs/ARCHITECTURE.md §5):
 * auth → validate (incl. client requestId) → one Firestore transaction running
 * the handler (permission checks, business rules, writes, audit) → the result
 * is stored under the requestId so a retried call returns it without redoing
 * the work. `after` runs post-commit side effects (e.g. claims sync).
 */
export function command<S extends z.ZodObject, R>(
  name: string,
  schema: S,
  handler: (ctx: CallContext<z.infer<S>>, tx: Transaction) => Promise<R>,
  after?: (result: R, ctx: CallContext<z.infer<S>>) => Promise<void>,
) {
  const withRequestId = schema.extend({ requestId: requestIdSchema });
  return onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
    try {
      const actor = await loadActor(req);
      const { requestId, ...input } = parse(withRequestId, req.data) as z.infer<S> & { requestId: string };
      const ctx: CallContext<z.infer<S>> = { actor, input: input as z.infer<S>, requestId };
      const idemRef = db.doc(`idempotency/${name}:${actor.uid}:${requestId}`);

      const { result, replayed } = await db.runTransaction(async (tx) => {
        const prior = await tx.get(idemRef);
        if (prior.exists) return { result: prior.data()!.result as R, replayed: true };
        const result = await handler(ctx, tx);
        tx.create(idemRef, {
          fn: name,
          uid: actor.uid,
          result: result ?? null,
          createdAt: FieldValue.serverTimestamp(),
          expireAt: Timestamp.fromMillis(Date.now() + IDEMPOTENCY_TTL_DAYS * 86_400_000),
        });
        return { result, replayed: false };
      });

      if (!replayed && after) await after(result, ctx);
      return result;
    } catch (e) {
      safe(e, name);
    }
  });
}
