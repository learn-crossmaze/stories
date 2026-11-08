import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { AppError, errors } from './errors.js';
import { db, ENFORCE_APP_CHECK, REGION } from './firebase.js';
import { Actor, type UserProfile } from './rbac.js';

const IDEMPOTENCY_TTL_DAYS = 30;
/** gRPC codes Firestore uses for contention and overload: DEADLINE_EXCEEDED, ABORTED, UNAVAILABLE. */
const TRANSIENT = new Set([4, 10, 14]);

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

/** What every log line about a call carries, so one failure can be traced end to end. */
interface LogContext {
  fn: string;
  uid?: string;
  orgId?: unknown;
  requestId?: string;
  phase?: 'handler' | 'after';
}

const orgOf = (data: unknown) => (data && typeof data === 'object' ? (data as { orgId?: unknown }).orgId : undefined);
const describe = (e: unknown) => (e instanceof Error ? { message: e.message, stack: e.stack } : { message: String(e) });

/**
 * Turns any failure into what the caller may see. Domain errors pass through
 * (logged at info level with their reason, for "who hits which rule");
 * Firestore contention/overload becomes a retryable `aborted` (the web retries
 * it with the same requestId); anything else is logged with full context and
 * hidden behind a generic message.
 */
function fail(e: unknown, log: LogContext): never {
  if (e instanceof AppError || e instanceof HttpsError) {
    logger.info(`${log.fn}: ${e.code}`, { ...log, code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason });
    throw e;
  }
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'number' && TRANSIENT.has(code)) {
    logger.warn(`${log.fn}: transient Firestore error`, { ...log, grpcCode: code, ...describe(e) });
    throw new AppError('aborted', 'BUSY', 'Stories is busy right now. Please try again in a moment.');
  }
  logger.error(`${log.fn} failed`, { ...log, ...describe(e) });
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
    const log: LogContext = { fn: name, uid: req.auth?.uid, orgId: orgOf(req.data) };
    try {
      const actor = await loadActor(req);
      return await handler({ actor, input: parse(schema, req.data) });
    } catch (e) {
      fail(e, log);
    }
  });
}

/**
 * Mutating callable. Pipeline (docs/ARCHITECTURE.md §5):
 * auth → validate (incl. client requestId) → one Firestore transaction running
 * the handler (permission checks, business rules, writes, audit) → the result
 * is stored under the requestId so a retried call returns it without redoing
 * the work.
 *
 * `after` runs post-commit side effects (claims sync, notifications, calls to
 * other services). It must be idempotent: until it succeeds, the stored record
 * stays `afterPending`, and a retry with the same requestId runs it again (the
 * web retries automatically on the `AFTER_PENDING` reason).
 */
export function command<S extends z.ZodObject, R>(
  name: string,
  schema: S,
  handler: (ctx: CallContext<z.infer<S>>, tx: Transaction) => Promise<R>,
  after?: (result: R, ctx: CallContext<z.infer<S>>) => Promise<void>,
) {
  const withRequestId = schema.extend({ requestId: requestIdSchema });
  return onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
    const started = Date.now();
    const log: LogContext = { fn: name, uid: req.auth?.uid, orgId: orgOf(req.data), phase: 'handler' };
    try {
      const actor = await loadActor(req);
      const { requestId, ...input } = parse(withRequestId, req.data) as z.infer<S> & { requestId: string };
      log.requestId = requestId;
      const ctx: CallContext<z.infer<S>> = { actor, input: input as z.infer<S>, requestId };
      const idemRef = db.doc(`idempotency/${name}:${actor.uid}:${requestId}`);

      const { result, replayed, afterPending } = await db.runTransaction(async (tx) => {
        const prior = await tx.get(idemRef);
        if (prior.exists) return { result: prior.get('result') as R, replayed: true, afterPending: prior.get('afterPending') === true };
        const result = await handler(ctx, tx);
        tx.create(idemRef, {
          fn: name,
          uid: actor.uid,
          result: result ?? null,
          ...(after ? { afterPending: true } : {}),
          createdAt: FieldValue.serverTimestamp(),
          expireAt: Timestamp.fromMillis(Date.now() + IDEMPOTENCY_TTL_DAYS * 86_400_000),
        });
        return { result, replayed: false, afterPending: !!after };
      });

      if (after && afterPending) {
        log.phase = 'after';
        try {
          await after(result, ctx);
        } catch (e) {
          logger.error(`${name}: step after the commit failed; a retry with the same requestId runs it again`, { ...log, ...describe(e) });
          throw new AppError('aborted', 'AFTER_PENDING', 'The change was saved, but finishing it took longer than expected. Please try again.');
        }
        await idemRef.update({ afterPending: false }).catch((e: unknown) => logger.warn(`${name}: could not clear afterPending`, { ...log, ...describe(e) }));
      }
      logger.info(`${name} ok`, { ...log, replayed, ms: Date.now() - started });
      return result;
    } catch (e) {
      fail(e, log);
    }
  });
}
