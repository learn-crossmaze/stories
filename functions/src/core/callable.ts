import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { AppError, errors } from './errors.js';
import { db, ENFORCE_APP_CHECK, REGION } from './firebase.js';
import { Actor, type UserProfile } from './rbac.js';
import { id } from './schemas.js';

const IDEMPOTENCY_TTL_DAYS = 30;

/** A failed read of the caller's profile, kept apart from the transaction's own errors (see command()). */
class ActorLoadFailure extends Error {
  constructor(readonly cause: unknown) {
    super('The profile could not be read.');
  }
}
/** gRPC codes Firestore uses for contention and overload: DEADLINE_EXCEEDED, ABORTED, UNAVAILABLE. */
const TRANSIENT = new Set([4, 10, 14]);

export const requestIdSchema = z.uuid();

export interface CallContext<I, P = unknown> {
  actor: Actor;
  input: I;
  requestId?: string;
  /** What the command's `prepare` step returned (network checks done before the transaction). */
  prepared?: P;
}

export interface CommandOptions<I, P> {
  /**
   * Work that must not run inside the transaction, which re-runs on contention
   * and stays open while it waits: calls to other services, slow lookups. Runs
   * once before the transaction (skipped when the request is a replay) and
   * must do its own permission check before touching anything private; the
   * handler receives the result as `ctx.prepared` and re-checks in the transaction.
   */
  prepare?: (ctx: CallContext<I>) => Promise<P>;
  /**
   * Undoes what `prepare` created (e.g. deletes a staged file) when this call's
   * transaction does not commit: the handler refused, the transaction failed,
   * or a concurrent call with the same requestId committed first. Never runs
   * once the change committed, even if `after` then fails.
   */
  discard?: (prepared: P) => Promise<void>;
}

/**
 * The caller, from their profile. With `orgId` (a validated id, see `orgIdOf`) their membership of that
 * organization is read in the same round trip, for permission checks made outside a transaction.
 */
async function loadActor(req: CallableRequest, orgId?: string): Promise<Actor> {
  if (!req.auth) throw errors.unauthenticated();
  const userRef = db.doc(`users/${req.auth.uid}`);
  const [snap, membership] = orgId ? await db.getAll(userRef, membershipRef(req.auth.uid, orgId)) : [await userRef.get()];
  const profile = snap.exists ? (snap.data() as UserProfile) : null;
  if (profile && profile.status !== 'ACTIVE') throw errors.inactiveUser();
  const actor = new Actor(
    req.auth.uid,
    (req.auth.token.email as string | undefined) ?? null,
    req.auth.token.email_verified === true,
    profile,
  );
  if (orgId && membership) actor.seed(orgId, membership);
  return actor;
}

const membershipRef = (uid: string, orgId: string) => db.doc(`users/${uid}/memberships/${orgId}`);

/**
 * The organization a call is about, when its (already validated) input names one. Checked against the id
 * pattern as well, so a document path is never built from anything else (an action may type `orgId` more loosely).
 */
function orgIdOf(input: unknown): string | undefined {
  const parsed = id.safeParse(orgOf(input));
  return parsed.success ? parsed.data : undefined;
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
  phase?: 'prepare' | 'handler' | 'after';
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
 * Read-only or naturally idempotent callable: signed in → validate → load the
 * caller (and, when the input names an organization, their membership of it in
 * the same round trip) → handler.
 */
export function query<S extends z.ZodType, R>(
  name: string,
  schema: S,
  handler: (ctx: CallContext<z.infer<S>>) => Promise<R>,
) {
  return onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
    const log: LogContext = { fn: name, uid: req.auth?.uid, orgId: orgOf(req.data) };
    try {
      if (!req.auth) throw errors.unauthenticated();
      const input = parse(schema, req.data);
      const actor = await loadActor(req, orgIdOf(input));
      return await handler({ actor, input });
    } catch (e) {
      fail(e, log);
    }
  });
}

/**
 * Mutating callable. Pipeline (docs/ARCHITECTURE.md §5):
 * signed in → validate (incl. client requestId) → one Firestore transaction
 * running the handler (permission checks, business rules, writes, audit) → the
 * result is stored under the requestId so a retried call returns it without
 * redoing the work.
 *
 * The start costs one round trip, not three: the caller's profile loads while
 * the transaction's first read fetches the idempotency record together with the
 * caller's membership of `input.orgId` (reads inside a transaction queue behind
 * its first one, so they only save time in the same read). That membership is
 * handed to the actor for this attempt (`Actor.prime`), which is what the
 * handler's `actor.require(perm, input.orgId, branchId, tx)` then uses.
 *
 * `after` runs post-commit side effects (claims sync, notifications, calls to
 * other services). It must be idempotent: until it succeeds, the stored record
 * stays `afterPending`, and a retry with the same requestId runs it again (the
 * web retries automatically on the `AFTER_PENDING` reason).
 */
export function command<S extends z.ZodObject, R, P = unknown>(
  name: string,
  schema: S,
  handler: (ctx: CallContext<z.infer<S>, P>, tx: Transaction) => Promise<R>,
  after?: ((result: R, ctx: CallContext<z.infer<S>, P>) => Promise<void>) | null,
  options: CommandOptions<z.infer<S>, P> = {},
) {
  const withRequestId = schema.extend({ requestId: requestIdSchema });
  return onCall({ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
    const started = Date.now();
    const log: LogContext = { fn: name, uid: req.auth?.uid, orgId: orgOf(req.data), phase: 'handler' };
    let actor: Actor | undefined;
    try {
      if (!req.auth) throw errors.unauthenticated();
      const uid = req.auth.uid;
      const { requestId, ...rest } = parse(withRequestId, req.data) as z.infer<S> & { requestId: string };
      const input = rest as z.infer<S>;
      log.requestId = requestId;
      // Not awaited yet: it loads alongside the read below. A refusal (a disabled account) can land before anyone
      // awaits it, so it gets a no-op catch here; everyone who needs the actor still awaits `loading` and is refused.
      // A profile read that fails is wrapped: left as it is, a "try again" database error would make the transaction
      // below retry, each attempt awaiting this same failed read. It is unwrapped again where the error is reported.
      const loading = loadActor(req).catch((e: unknown) => {
        throw e instanceof AppError ? e : new ActorLoadFailure(e);
      });
      loading.catch(() => {});
      const idemRef = db.doc(`idempotency/${name}:${uid}:${requestId}`);
      const orgId = orgIdOf(input);
      const memRef = orgId ? membershipRef(uid, orgId) : null;

      let ctx: CallContext<z.infer<S>, P> | undefined;
      if (options.prepare) {
        const [loaded, prior] = await Promise.all([loading, idemRef.get()]);
        actor = loaded;
        ctx = { actor, input, requestId };
        if (!prior.exists) {
          log.phase = 'prepare';
          ctx.prepared = await options.prepare(ctx);
          log.phase = 'handler';
        }
      }

      const discardPrepared = async () => {
        if (!options.discard || ctx?.prepared === undefined) return;
        await options.discard(ctx.prepared).catch((e: unknown) => logger.error(`${name}: could not undo the prepare step`, { ...log, ...describe(e) }));
      };
      let outcome;
      try {
        outcome = await db
          .runTransaction(async (tx) => {
            // Runs again on every attempt of the transaction, so a retry re-reads the membership like any other read.
            const [[prior, membership], loaded] = await Promise.all([tx.getAll(idemRef, ...(memRef ? [memRef] : [])), loading]);
            actor = loaded;
            ctx ??= { actor, input, requestId };
            if (prior.exists) return { result: prior.get('result') as R, replayed: true, afterPending: prior.get('afterPending') === true };
            if (orgId && membership) actor.prime(tx, orgId, membership);
            const result = await handler(ctx, tx);
            tx.create(idemRef, {
              fn: name,
              uid,
              result: result ?? null,
              ...(after ? { afterPending: true } : {}),
              createdAt: FieldValue.serverTimestamp(),
              expireAt: Timestamp.fromMillis(Date.now() + IDEMPOTENCY_TTL_DAYS * 86_400_000),
            });
            return { result, replayed: false, afterPending: !!after };
          })
          // That membership belongs to the transaction: nothing after it (`discard`, `after`) may be served from it.
          .finally(() => actor?.clearPrime());
      } catch (e) {
        await discardPrepared();
        throw e;
      }
      const { result, replayed, afterPending } = outcome;
      if (replayed) await discardPrepared();

      if (after && afterPending) {
        log.phase = 'after';
        try {
          await after(result, ctx!);
        } catch (e) {
          logger.error(`${name}: step after the commit failed; a retry with the same requestId runs it again`, { ...log, ...describe(e) });
          throw new AppError('aborted', 'AFTER_PENDING', 'The change was saved, but finishing it took longer than expected. Please try again.');
        }
        await idemRef.update({ afterPending: false }).catch((e: unknown) => logger.warn(`${name}: could not clear afterPending`, { ...log, ...describe(e) }));
      }
      logger.info(`${name} ok`, { ...log, replayed, ms: Date.now() - started });
      return result;
    } catch (e) {
      fail(e instanceof ActorLoadFailure ? e.cause : e, log);
    }
  });
}
