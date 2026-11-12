import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';

import { type AppError, errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { inOrder, readAll } from '../core/reads.js';
import { canTransition, type CopyStatus, describeStatus } from './copyState.js';

export interface Copy {
  code: string;
  barcode: string;
  bookId: string;
  bookCode: string;
  bookTitle: string;
  orgId: string;
  owningBranchId: string;
  currentBranchId: string;
  locationId: string | null;
  /** The shelf the copy was last issued from (its usual shelf); absent until it has been issued off a shelf. */
  lastLocationId?: string | null;
  status: CopyStatus;
  condition: string;
  acquisitionCostMinor: number;
  activeLoanId: string | null;
  activeReservationId: string | null;
  transferId: string | null;
  lifetimeLoans: number;
}

export const copyRef = (orgId: string, copyId: string) => db.doc(`orgs/${orgId}/copies/${copyId}`);

export async function loadCopy(tx: Transaction, orgId: string, copyId: string) {
  const snap = await tx.get(copyRef(orgId, copyId));
  if (!snap.exists) throw errors.notFound('Copy');
  return { snap, copy: snap.data() as Copy };
}

/** Finds a copy by its scanned barcode (or code) within an organization. */
export async function findByBarcode(tx: Transaction, orgId: string, barcode: string) {
  const key = barcode.trim().toUpperCase();
  const index = await tx.get(db.doc(`orgs/${orgId}/barcodes/${key}`));
  if (index.exists) return loadCopy(tx, orgId, index.get('copyId') as string);
  // Custom barcodes differ from the copy code, which staff also type or pick.
  const byCode = await tx.get(db.collection(`orgs/${orgId}/copies`).where('code', '==', key).limit(1));
  if (byCode.empty) throw unknownBarcode(barcode);
  return { snap: byCode.docs[0], copy: byCode.docs[0].data() as Copy };
}

const unknownBarcode = (barcode: string) => errors.conflict('UNKNOWN_BARCODE', `No copy with barcode ${barcode} in this organization.`);

export interface FoundCopy {
  snap: DocumentSnapshot;
  copy: Copy;
}

/**
 * `findByBarcode` for several barcodes at once: two reads for the whole list,
 * instead of two for each barcode one after another. The answers are in the
 * order of `barcodes`. Nothing is thrown for a barcode that does not resolve:
 * its place holds the error `findByBarcode` would have thrown, for the caller
 * to throw when it reaches that barcode, so the first problem in scan order is
 * the one reported.
 */
export async function findManyByBarcode(tx: Transaction, orgId: string, barcodes: string[]): Promise<(FoundCopy | AppError)[]> {
  const keys = barcodes.map((b) => b.trim().toUpperCase());
  // A code with a slash can't be an index document's name: it skips the index and, like any miss, is looked up by copy code.
  const indexed = keys.map((key) => !key.includes('/'));
  const found = await readAll(tx, keys.filter((_, n) => indexed[n]).map((key) => db.doc(`orgs/${orgId}/barcodes/${key}`)));
  let at = 0;
  const index = keys.map((_, n) => (indexed[n] ? found[at++] : null));
  // The copies the index names, together with (for custom barcodes, which miss the index) the lookups by copy code.
  const [copies, byCode] = await inOrder([
    readAll(tx, index.flatMap((i) => (i?.exists ? [copyRef(orgId, i.get('copyId') as string)] : []))),
    Promise.all(index.map((i, n) => (i?.exists ? null : tx.get(db.collection(`orgs/${orgId}/copies`).where('code', '==', keys[n]).limit(1))))),
  ]);
  const byId = new Map(copies.map((c) => [c.id, c]));
  return index.map((i, n) => {
    if (!i?.exists) {
      const snap = byCode[n]!.docs.at(0);
      return snap ? { snap, copy: snap.data() as Copy } : unknownBarcode(barcodes[n]);
    }
    const snap = byId.get(i.get('copyId') as string)!;
    return snap.exists ? { snap, copy: snap.data() as Copy } : errors.notFound('Copy');
  });
}

export interface CopyEvent {
  type: string;
  actorUid: string;
  note?: string | null;
  ref?: Record<string, string | null>;
}

/**
 * Moves a copy to a new status (validating the transition) and appends an
 * event to its history. Writes only — call after all transaction reads.
 */
export function transition(tx: Transaction, snap: DocumentSnapshot, to: CopyStatus, patch: Record<string, unknown>, event: CopyEvent) {
  const from = snap.get('status') as CopyStatus;
  if (!canTransition(from, to)) {
    throw errors.conflict('COPY_STATE', `Copy ${snap.get('code')} is ${describeStatus(from)} and can't become ${describeStatus(to)}.`);
  }
  tx.update(snap.ref, { ...patch, status: to, updatedAt: FieldValue.serverTimestamp() });
  logEvent(tx, snap.ref.path, { ...event, fromStatus: from, toStatus: to, condition: (patch.condition as string) ?? snap.get('condition') });
}

export function logEvent(tx: Transaction, copyPath: string, event: CopyEvent & Record<string, unknown>) {
  tx.create(db.collection(`${copyPath}/events`).doc(), {
    note: null,
    ref: null,
    ...event,
    at: FieldValue.serverTimestamp(),
  });
}

export function requireStatus(copy: Copy, ...allowed: CopyStatus[]) {
  if (!allowed.includes(copy.status)) {
    throw errors.conflict('COPY_STATE', `Copy ${copy.code} is ${describeStatus(copy.status)}.`);
  }
}
