import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db, REGION } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { logEvent } from '../inventory/copyOps.js';
import { loadMember } from '../members/members.js';
import { requireActiveTerm } from '../subscriptions/term.js';
import { makeAvailable, nextWaiting, readCirculationConfig } from './allocation.js';

/**
 * Reserves a title for a member at a branch. If a copy is on the shelf it is
 * set aside immediately (ALLOCATED, held for the configured hours); otherwise
 * the member joins the queue (WAITING) and gets the next copy that frees up.
 * Waiting + held reservations may not exceed the plan limit (D2).
 */
export const place = command(
  'reservations-place',
  z.strictObject({ orgId: id, memberId: id, bookId: id, branchId: id }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('reservations.manage', input.orgId, input.branchId, tx);
    const { snap: memberSnap, member } = await loadMember(tx, input.orgId, input.memberId);
    const term = await requireActiveTerm(tx, input.orgId, member);
    const book = await tx.get(db.doc(`books/${input.bookId}`));
    if (!book.exists || book.get('status') !== 'ACTIVE') throw errors.notFound('Active catalogue title');
    const existing = await tx.get(
      db.collection(`orgs/${input.orgId}/reservations`)
        .where('memberId', '==', input.memberId)
        .where('bookId', '==', input.bookId)
        .where('status', 'in', ['WAITING', 'ALLOCATED'])
        .limit(1),
    );
    if (!existing.empty) throw errors.conflict('ALREADY_RESERVED', `${member.fullName} already has a reservation for this title.`);
    if (member.waitingCount + member.allocatedCount >= term.max) {
      throw errors.conflict('RESERVATION_LIMIT', `Reservations are limited to ${term.max} at a time on this plan.`);
    }
    const shelf = await tx.get(
      db.collection(`orgs/${input.orgId}/copies`)
        .where('bookId', '==', input.bookId)
        .where('currentBranchId', '==', input.branchId)
        .where('status', '==', 'AVAILABLE')
        .limit(1),
    );
    const { holdHours } = await readCirculationConfig(tx, input.orgId);

    const ref = db.collection(`orgs/${input.orgId}/reservations`).doc();
    const base = {
      memberId: input.memberId, memberCode: member.code, memberName: member.fullName, bookId: input.bookId,
      bookTitle: book.get('title'), branchId: input.branchId, queuedAt: FieldValue.serverTimestamp(), placedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    const copy = shelf.docs[0];
    if (copy) {
      tx.create(ref, {
        ...base, status: 'ALLOCATED', allocatedCopyId: copy.id, allocatedCopyCode: copy.get('code'),
        allocatedAt: FieldValue.serverTimestamp(), holdUntil: Timestamp.fromMillis(Date.now() + holdHours * 3_600_000),
      });
      tx.update(copy.ref, { status: 'RESERVED', activeReservationId: ref.id, updatedAt: FieldValue.serverTimestamp() });
      logEvent(tx, copy.ref.path, {
        type: 'RESERVATION_ALLOCATED', actorUid: actor.uid, fromStatus: 'AVAILABLE', toStatus: 'RESERVED',
        condition: copy.get('condition'), ref: { reservationId: ref.id, memberId: input.memberId },
      });
      tx.update(memberSnap.ref, { ...(term.rollover ?? {}), allocatedCount: FieldValue.increment(1) });
    } else {
      tx.create(ref, { ...base, status: 'WAITING', allocatedCopyId: null, allocatedCopyCode: null, holdUntil: null });
      tx.update(memberSnap.ref, { ...(term.rollover ?? {}), waitingCount: FieldValue.increment(1) });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'reservation.place', entityType: 'reservation', entityId: ref.id, branchId: input.branchId,
      after: { memberId: input.memberId, bookId: input.bookId, status: copy ? 'ALLOCATED' : 'WAITING', copy: copy?.get('code') ?? null },
    });
    return { reservationId: ref.id, status: copy ? 'ALLOCATED' : 'WAITING', copyCode: copy?.get('code') ?? null };
  },
);

/** Cancels a reservation; a held copy passes to the next member waiting or back to the shelf. */
export const cancel = command(
  'reservations-cancel',
  z.strictObject({ orgId: id, reservationId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const ref = db.doc(`orgs/${input.orgId}/reservations/${input.reservationId}`);
    const res = await tx.get(ref);
    if (!res.exists) throw errors.notFound('Reservation');
    await actor.require('reservations.manage', input.orgId, res.get('branchId'), tx);
    const status = res.get('status') as string;
    if (status !== 'WAITING' && status !== 'ALLOCATED') throw errors.conflict('NOT_OPEN', 'This reservation is already closed.');
    const memberRef = db.doc(`orgs/${input.orgId}/members/${res.get('memberId')}`);
    if (status === 'ALLOCATED') {
      const copy = await tx.get(db.doc(`orgs/${input.orgId}/copies/${res.get('allocatedCopyId')}`));
      const [waiting] = await nextWaiting(tx, input.orgId, res.get('branchId'), res.get('bookId'));
      const { holdHours } = await readCirculationConfig(tx, input.orgId);
      tx.update(ref, { status: 'CANCELLED', cancelReason: input.reason, updatedAt: FieldValue.serverTimestamp() });
      tx.update(memberRef, { allocatedCount: FieldValue.increment(-1) });
      makeAvailable(tx, input.orgId, copy, {}, { type: 'RESERVATION_CANCELLED', actorUid: actor.uid, ref: { reservationId: res.id } }, waiting, holdHours);
    } else {
      tx.update(ref, { status: 'CANCELLED', cancelReason: input.reason, updatedAt: FieldValue.serverTimestamp() });
      tx.update(memberRef, { waitingCount: FieldValue.increment(-1) });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'reservation.cancel', entityType: 'reservation', entityId: res.id, branchId: res.get('branchId'),
      before: { status }, after: { status: 'CANCELLED' }, reason: input.reason,
    });
    return { reservationId: res.id };
  },
);

/**
 * Releases holds that were not collected in time (D3): the reservation
 * expires and the copy goes to the next member waiting, else back on the shelf.
 * Idempotent: each hold is re-checked in its own transaction.
 */
export async function expireHolds(now = new Date(), batch = 300): Promise<number> {
  const due = await db
    .collectionGroup('reservations')
    .where('status', '==', 'ALLOCATED')
    .where('holdUntil', '<=', Timestamp.fromDate(now))
    .limit(batch)
    .get();
  let n = 0;
  for (const doc of due.docs) {
    const orgId = doc.ref.parent.parent!.id;
    const done = await db.runTransaction(async (tx) => {
      const res = await tx.get(doc.ref);
      if (res.get('status') !== 'ALLOCATED' || res.get('holdUntil').toMillis() > now.getTime()) return false;
      const copy = await tx.get(db.doc(`orgs/${orgId}/copies/${res.get('allocatedCopyId')}`));
      const [waiting] = await nextWaiting(tx, orgId, res.get('branchId'), res.get('bookId'));
      const { holdHours } = await readCirculationConfig(tx, orgId);
      tx.update(doc.ref, { status: 'EXPIRED', expiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.update(db.doc(`orgs/${orgId}/members/${res.get('memberId')}`), { allocatedCount: FieldValue.increment(-1) });
      if (copy.get('status') === 'RESERVED' && copy.get('activeReservationId') === res.id) {
        makeAvailable(tx, orgId, copy, {}, { type: 'HOLD_EXPIRED', actorUid: 'system', ref: { reservationId: res.id } }, waiting, holdHours);
      }
      recordAudit(tx, { actorUid: 'system' }, orgId, {
        action: 'reservation.expire', entityType: 'reservation', entityId: res.id, branchId: res.get('branchId'),
        before: { status: 'ALLOCATED' }, after: { status: 'EXPIRED', passedTo: waiting?.id ?? null },
      });
      return true;
    });
    if (done) n++;
  }
  return n;
}

export const expireHoldsSweep = onSchedule({ schedule: 'every 15 minutes', region: REGION, timeZone: 'Asia/Kolkata' }, async () => {
  logger.info(`expired ${await expireHolds()} reservation holds`);
});
