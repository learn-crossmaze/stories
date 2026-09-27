import type { Transaction } from 'firebase-admin/firestore';

import { db } from './firebase.js';

/**
 * Two-phase sequential code allocation inside a transaction (reads must come
 * before writes): `const next = await reserve(tx, path)` … `next.commit()`.
 */
export async function reserveCounter(tx: Transaction, path: string) {
  const ref = db.doc(path);
  const snap = await tx.get(ref);
  const value = ((snap.exists ? snap.get('next') : 1) as number) ?? 1;
  return {
    value,
    commit(count = 1) {
      tx.set(ref, { next: value + count }, { merge: true });
    },
  };
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0');
