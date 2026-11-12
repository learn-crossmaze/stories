import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

/**
 * Waits for reads that were started together and gives their results in the
 * order listed. If any failed, throws the failure of the *first one listed*,
 * whichever finished first: a command lists its permission check first, then
 * its other reads in the order it used to make them, so the caller is refused
 * for the same reason as when the reads ran one after another.
 *
 * Use this instead of `Promise.all` for reads that can refuse: `Promise.all`
 * reports whichever failure lands first, which varies from call to call. Every
 * promise started for a transaction must be handed to one `inOrder` (or awaited
 * on its own), so that none is left to fail unobserved.
 */
export async function inOrder<T extends readonly unknown[] | []>(reads: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const settled = await Promise.allSettled(reads);
  for (const s of settled) if (s.status === 'rejected') throw s.reason;
  return settled.map((s) => (s as PromiseFulfilledResult<unknown>).value) as { -readonly [K in keyof T]: Awaited<T[K]> };
}

/** Several documents in one read, in the order asked (`tx.getAll` refuses an empty list). */
export async function readAll(tx: Pick<Transaction, 'getAll'>, refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
  return refs.length ? tx.getAll(...refs) : [];
}
