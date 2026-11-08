import type { Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import type { z } from 'zod';

import { bucket } from '../catalogue/covers.js';
import { type CallContext, command, requestIdSchema } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db, REGION } from '../core/firebase.js';
import { Actor, type UserProfile } from '../core/rbac.js';

/** A file in the default bucket. */
export type StoredFile = ReturnType<ReturnType<typeof bucket>['file']>;

/** What `stage` produced, and how to undo it if the command does not commit. */
export interface Staged<P> {
  value: P;
  discard: () => Promise<void>;
}

/**
 * A command (core/callable.ts) with slow side effects, such as generating a PDF
 * or uploading a file to Storage, that must not run inside its transaction
 * (a transaction body runs again on contention, and a failed one would leave
 * the file behind). `stage` runs first, once per call, outside any
 * transaction; it should check permissions read-only and put the file at its
 * final, unguessable path. The handler then runs in the command's transaction
 * as usual, with the staged value, and must re-check everything it relies on.
 * If the command fails (or the call turns out to be a replay), the staged work
 * is discarded. A replayed request never stages anything.
 */
export function stagedCommand<S extends z.ZodObject, R, P>(
  name: string,
  schema: S,
  stage: (ctx: CallContext<z.infer<S>>) => Promise<Staged<P>>,
  handler: (ctx: CallContext<z.infer<S>>, tx: Transaction, staged: P) => Promise<R>,
  after?: (result: R, ctx: CallContext<z.infer<S>>) => Promise<void>,
) {
  const pending = new Map<string, { value: P; used: boolean }>();
  const keyOf = (uid: string, requestId: string | undefined) => `${uid}:${requestId}`;
  const inner = command(
    name,
    schema,
    async (ctx, tx) => {
      const entry = pending.get(keyOf(ctx.actor.uid, ctx.requestId));
      if (!entry) throw errors.conflict('RETRY', 'Something went wrong on our side. Please try again.');
      entry.used = true;
      return handler(ctx, tx, entry.value);
    },
    after,
  );
  const withRequestId = schema.extend({ requestId: requestIdSchema });

  return onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' }, async (req: CallableRequest) => {
    const parsed = withRequestId.safeParse(req.data);
    // Anything the command itself refuses (no sign-in, bad input, a replay) needs no staging.
    if (!req.auth || !parsed.success) return inner.run(req);
    const { requestId, ...input } = parsed.data as z.infer<S> & { requestId: string };
    const key = keyOf(req.auth.uid, requestId);
    if (pending.has(key)) throw errors.conflict('IN_PROGRESS', 'This request is already being processed.');
    if ((await db.doc(`idempotency/${name}:${key}`).get()).exists) return inner.run(req);
    const profileSnap = await db.doc(`users/${req.auth.uid}`).get();
    const profile = profileSnap.exists ? (profileSnap.data() as UserProfile) : null;
    if (profile && profile.status !== 'ACTIVE') return inner.run(req);
    const actor = new Actor(req.auth.uid, (req.auth.token.email as string | undefined) ?? null, req.auth.token.email_verified === true, profile);

    let staged: Staged<P>;
    try {
      staged = await stage({ actor, input: input as z.infer<S>, requestId });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error(`${name} failed while staging`, e);
      throw new HttpsError('internal', 'Something went wrong on our side. Please try again.');
    }
    const entry = { value: staged.value, used: false };
    pending.set(key, entry);
    const discard = () => staged.discard().catch((e) => logger.error(`${name}: could not discard staged work`, e));
    try {
      const result = await inner.run(req);
      // A concurrent call with the same request id committed first: this call was a replay.
      if (!entry.used) await discard();
      return result;
    } catch (e) {
      await discard();
      throw e;
    } finally {
      pending.delete(key);
    }
  });
}

/**
 * Saves a new file at `path` (default: private, never cached), refusing to
 * replace a file already there. Stage files under a fresh random name.
 */
export async function storeNew(path: string, bytes: Buffer, contentType: string, metadata: Record<string, unknown> = { cacheControl: 'private, no-store' }): Promise<StoredFile> {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (exists) throw errors.conflict('RETRY', 'Something went wrong on our side. Please try again.');
  await file.save(bytes, { resumable: false, contentType, metadata });
  return file;
}

export async function deleteFile(file: StoredFile): Promise<void> {
  await file.delete({ ignoreNotFound: true });
}
