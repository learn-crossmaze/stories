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

/**
 * The same for several counters, in one read: a counter per distinct path
 * (a path listed twice is read once, so its numbers are handed out once).
 */
export async function reserveCounters(tx: Transaction, paths: string[]) {
  const unique = [...new Set(paths)];
  const refs = unique.map((p) => db.doc(p));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  const counters = new Map<string, Awaited<ReturnType<typeof reserveCounter>>>();
  unique.forEach((path, i) => {
    const value = ((snaps[i].exists ? snaps[i].get('next') : 1) as number) ?? 1;
    counters.set(path, {
      value,
      commit(count = 1) {
        tx.set(refs[i], { next: value + count }, { merge: true });
      },
    });
  });
  return counters;
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0');
