import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';

import { bucket } from '../catalogue/covers.js';
import { type CallContext, command } from '../core/callable.js';
import { errors } from '../core/errors.js';

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
 * the file behind). `stage` is the command's `prepare` step: it runs once per
 * call, outside any transaction, should check permissions read-only and put
 * the file at its final, unguessable path. The handler then runs in the
 * command's transaction with the staged value and must re-check everything it
 * relies on. If the transaction does not commit (or the call turns out to be a
 * replay), the staged work is discarded; once it committed it never is.
 */
export function stagedCommand<S extends z.ZodObject, R, P>(
  name: string,
  schema: S,
  stage: (ctx: CallContext<z.infer<S>>) => Promise<Staged<P>>,
  handler: (ctx: CallContext<z.infer<S>>, tx: Transaction, staged: P) => Promise<R>,
  after?: (result: R, ctx: CallContext<z.infer<S>>) => Promise<void>,
) {
  return command<S, R, Staged<P>>(name, schema, (ctx, tx) => handler(ctx, tx, ctx.prepared!.value), after ?? null, {
    prepare: stage,
    discard: (staged) => staged.discard(),
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
