import { FieldValue, type DocumentSnapshot, Timestamp, type Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { canTransition, type CopyStatus, describeStatus } from '../inventory/copyState.js';
import { type CopyEvent, logEvent } from '../inventory/copyOps.js';

export const DEFAULT_HOLD_HOURS = 48;

/** Org circulation settings (orgs/{o}/config/circulation); defaults per BUSINESS_RULES D3. */
export async function readCirculationConfig(tx: Transaction, orgId: string) {
  const snap = await tx.get(db.doc(`orgs/${orgId}/config/circulation`));
  return { holdHours: (snap.get('reservationHoldHours') as number | undefined) ?? DEFAULT_HOLD_HOURS };
}

/** Oldest WAITING reservations for a title at a branch (read phase). */
export async function nextWaiting(tx: Transaction, orgId: string, branchId: string, bookId: string, limit = 1) {
  const q = db
    .collection(`orgs/${orgId}/reservations`)
    .where('bookId', '==', bookId)
    .where('branchId', '==', branchId)
    .where('status', '==', 'WAITING')
    .orderBy('queuedAt', 'asc')
    .limit(limit);
  return (await tx.get(q)).docs;
}

/**
 * Write phase: allocates `copySnap` (currently `from`) to a WAITING
 * reservation — copy → RESERVED, reservation → ALLOCATED with a hold, and the
 * member's allocated count +1 (allocated holds count toward the plan limit, D2).
 */
export function allocate(
  tx: Transaction,
  orgId: string,
  reservation: DocumentSnapshot,
  copySnap: DocumentSnapshot,
  holdHours: number,
  actorUid: string,
  patch: Record<string, unknown> = {},
) {
  const holdUntil = Timestamp.fromMillis(Date.now() + holdHours * 3_600_000);
  tx.update(reservation.ref, {
    status: 'ALLOCATED',
    allocatedCopyId: copySnap.id,
    allocatedCopyCode: copySnap.get('code'),
    allocatedAt: FieldValue.serverTimestamp(),
    holdUntil,
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.update(db.doc(`orgs/${orgId}/members/${reservation.get('memberId')}`), {
    allocatedCount: FieldValue.increment(1),
    waitingCount: FieldValue.increment(-1),
  });
  tx.update(copySnap.ref, { ...patch, status: 'RESERVED', activeReservationId: reservation.id, updatedAt: FieldValue.serverTimestamp() });
  logEvent(tx, copySnap.ref.path, {
    type: 'RESERVATION_ALLOCATED',
    actorUid,
    fromStatus: 'AVAILABLE',
    toStatus: 'RESERVED',
    condition: (patch.condition as string) ?? copySnap.get('condition'),
    ref: { reservationId: reservation.id, memberId: reservation.get('memberId') as string },
  });
}

/**
 * Write phase: puts a copy back on the shelf. If a member is waiting for this
 * title at the copy's branch (`waiting`, read earlier), it goes straight to
 * them as a reservation instead.
 */
export function makeAvailable(
  tx: Transaction,
  orgId: string,
  copySnap: DocumentSnapshot,
  patch: Record<string, unknown>,
  event: CopyEvent,
  waiting: DocumentSnapshot | undefined,
  holdHours: number,
) {
  const from = copySnap.get('status') as CopyStatus;
  if (!canTransition(from, 'AVAILABLE')) {
    throw errors.conflict('COPY_STATE', `Copy ${copySnap.get('code')} is ${describeStatus(from)} and can't go back on the shelf.`);
  }
  const base = { ...patch, activeLoanId: null, activeReservationId: null, transferId: null };
  tx.update(copySnap.ref, { ...base, status: 'AVAILABLE', updatedAt: FieldValue.serverTimestamp() });
  logEvent(tx, copySnap.ref.path, { ...event, fromStatus: from, toStatus: 'AVAILABLE', condition: (patch.condition as string) ?? copySnap.get('condition') });
  if (waiting) allocate(tx, orgId, waiting, copySnap, holdHours, event.actorUid, base);
}
