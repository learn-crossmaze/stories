import { type DocumentReference, FieldValue, type DocumentSnapshot, Timestamp, type Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { canTransition, type CopyStatus, describeStatus } from '../inventory/copyState.js';
import { type CopyEvent, logEvent } from '../inventory/copyOps.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';

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

const holdFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** Tells the member (WhatsApp, if the branch sends it) that a reserved book is waiting for them. */
export function queueReady(tx: Transaction, orgId: string, branchId: string, memberId: string, bookTitle: string, holdUntil: Date, reservationId: string) {
  queueWhatsApp(tx, { orgId, branchId, event: 'reservation_ready', memberId, vars: { book_title: bookTitle, hold_until: holdFmt.format(holdUntil) }, ref: { reservationId } });
}

/** The reservation a copy goes to: one already in the queue (`waiting`), or one being placed in this transaction. */
export interface AllocationTarget {
  ref: DocumentReference;
  memberId: string;
  branchId: string;
  bookTitle: string;
  /** In the queue (counted in the member's waitingCount) until now. */
  waiting: boolean;
}

/** The copy being set aside: an existing copy, or one added in this transaction. */
export interface AllocationCopy {
  ref: DocumentReference;
  code: string;
  condition: string;
}

/** A WAITING reservation read in this transaction, as an allocation target. */
export const queued = (r: DocumentSnapshot): AllocationTarget => ({
  ref: r.ref,
  memberId: r.get('memberId') as string,
  branchId: r.get('branchId') as string,
  bookTitle: r.get('bookTitle') as string,
  waiting: true,
});

/** A copy read in this transaction, as the copy to set aside. */
export const copyOf = (s: DocumentSnapshot): AllocationCopy => ({ ref: s.ref, code: s.get('code') as string, condition: s.get('condition') as string });

/**
 * Write phase — the one way a copy is set aside for a reservation: the copy
 * becomes RESERVED, the reservation ALLOCATED with a hold, the member's
 * allocated count +1 (allocated holds count toward the plan limit, D2; −1
 * waiting if it was queued) and the member is told it is ready. Used when a
 * copy comes back to the shelf, when copies are added, and when a
 * reservation finds a copy on the shelf. `copyPatch` / `memberPatch` ride
 * along in the same writes.
 */
export function allocate(
  tx: Transaction,
  orgId: string,
  target: AllocationTarget,
  copy: AllocationCopy,
  holdHours: number,
  actorUid: string,
  opts: { copyPatch?: Record<string, unknown>; memberPatch?: Record<string, unknown> } = {},
) {
  const holdUntil = Timestamp.fromMillis(Date.now() + holdHours * 3_600_000);
  const patch = opts.copyPatch ?? {};
  queueReady(tx, orgId, target.branchId, target.memberId, target.bookTitle, holdUntil.toDate(), target.ref.id);
  tx.update(target.ref, {
    status: 'ALLOCATED',
    allocatedCopyId: copy.ref.id,
    allocatedCopyCode: copy.code,
    allocatedAt: FieldValue.serverTimestamp(),
    holdUntil,
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.update(db.doc(`orgs/${orgId}/members/${target.memberId}`), {
    ...(opts.memberPatch ?? {}),
    allocatedCount: FieldValue.increment(1),
    ...(target.waiting ? { waitingCount: FieldValue.increment(-1) } : {}),
  });
  tx.update(copy.ref, { ...patch, status: 'RESERVED', activeReservationId: target.ref.id, updatedAt: FieldValue.serverTimestamp() });
  logEvent(tx, copy.ref.path, {
    type: 'RESERVATION_ALLOCATED',
    actorUid,
    fromStatus: 'AVAILABLE',
    toStatus: 'RESERVED',
    condition: (patch.condition as string) ?? copy.condition,
    ref: { reservationId: target.ref.id, memberId: target.memberId },
  });
  return holdUntil;
}

/** Writes per allocation (reservation, member, copy, copy event, the member's message): for transaction write budgets. */
export const ALLOCATION_WRITES = 5;

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
  if (waiting) allocate(tx, orgId, queued(waiting), copyOf(copySnap), holdHours, event.actorUid, { copyPatch: base });
}
