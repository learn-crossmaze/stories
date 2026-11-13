import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';
import { type CallContext, command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db, REGION } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { JOB_OPTIONS, sweep } from '../core/sweep.js';
import { inOrder } from '../core/reads.js';
import { memberRef } from '../members/members.js';
import type { Member } from '../members/model.js';
import { assertActiveTerm, currentTerm } from '../billing/term.js';
import { allocate, copyOf, makeAvailable, nextWaiting, readCirculationConfig } from './allocation.js';

/**
 * Reserves a title for a member at a branch. If a copy is on the shelf it is
 * set aside immediately (ALLOCATED, held for the configured hours); otherwise
 * the member joins the queue (WAITING) and gets the next copy that frees up.
 * Waiting + held reservations may not exceed the plan limit (D2).
 */
export const placeSchema = z.strictObject({ orgId: id, memberId: id, bookId: id, branchId: id });

/** Shared by staff (reservations-place) and members reserving for themselves (me-reserve). */
export async function placeReservation(
  { actor, input, requestId }: CallContext<z.infer<typeof placeSchema>>,
  tx: Transaction,
  authorize: (member: Member) => Promise<void>,
) {
    // Everything the request names is read together, as plain reads: nothing is judged, and nothing read here is
    // told to the caller, until the caller is known to act for this member (the checks below keep their old order).
    const [memberSnap, branch, book, existing, shelf, { holdHours }] = await inOrder([
      tx.get(memberRef(input.orgId, input.memberId)),
      tx.get(db.doc(`orgs/${input.orgId}/branches/${input.branchId}`)),
      tx.get(db.doc(`books/${input.bookId}`)),
      tx.get(
        db.collection(`orgs/${input.orgId}/reservations`)
          .where('memberId', '==', input.memberId)
          .where('bookId', '==', input.bookId)
          .where('status', 'in', ['WAITING', 'ALLOCATED'])
          .limit(1),
      ),
      tx.get(
        db.collection(`orgs/${input.orgId}/copies`)
          .where('bookId', '==', input.bookId)
          .where('currentBranchId', '==', input.branchId)
          .where('status', '==', 'AVAILABLE')
          .limit(1),
      ),
      readCirculationConfig(tx, input.orgId),
    ]);
    if (!memberSnap.exists) throw errors.notFound('Member');
    const member = memberSnap.data() as Member;
    // The permission check is listed first: a caller with no right to this member is refused for that alone.
    const [, current] = await inOrder([authorize(member), currentTerm(tx, input.orgId, member)]);
    if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
    const term = assertActiveTerm(member, current);
    if (!book.exists || book.get('status') !== 'ACTIVE') throw errors.notFound('Active catalogue title');
    if (!existing.empty) throw errors.conflict('ALREADY_RESERVED', `${member.fullName} already has a reservation for this title.`);
    if (member.waitingCount + member.allocatedCount >= term.max) {
      throw errors.conflict('RESERVATION_LIMIT', `Reservations are limited to ${term.max} at a time on this plan.`);
    }

    const ref = db.collection(`orgs/${input.orgId}/reservations`).doc();
    const base = {
      memberId: input.memberId, memberCode: member.code, memberName: member.fullName, bookId: input.bookId,
      bookTitle: book.get('title'), branchId: input.branchId, queuedAt: FieldValue.serverTimestamp(), placedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    const copy = shelf.docs[0];
    tx.create(ref, { ...base, status: 'WAITING', allocatedCopyId: null, allocatedCopyCode: null, holdUntil: null });
    if (copy) {
      // A copy is on the shelf: set it aside at once (the reservation never joins the queue).
      allocate(tx, input.orgId, { ref, memberId: input.memberId, branchId: input.branchId, bookTitle: book.get('title') as string, waiting: false }, copyOf(copy), holdHours, actor.uid, {
        memberPatch: term.rollover ?? {},
      });
    } else {
      queueWhatsApp(tx, { orgId: input.orgId, branchId: input.branchId, event: 'reservation_placed', memberId: input.memberId, vars: { book_title: book.get('title') as string }, ref: { reservationId: ref.id } });
      tx.update(memberSnap.ref, { ...(term.rollover ?? {}), waitingCount: FieldValue.increment(1) });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'reservation.place', entityType: 'reservation', entityId: ref.id, branchId: input.branchId, memberId: input.memberId,
      after: { memberId: input.memberId, bookId: input.bookId, status: copy ? 'ALLOCATED' : 'WAITING', copy: copy?.get('code') ?? null },
    });
    return { reservationId: ref.id, status: copy ? 'ALLOCATED' : 'WAITING', copyCode: copy?.get('code') ?? null };
}

export const place = command('reservations-place', placeSchema, (ctx, tx) =>
  placeReservation(ctx, tx, () => ctx.actor.require('reservations.manage', ctx.input.orgId, ctx.input.branchId, tx)),
);

/** Cancels a reservation; a held copy passes to the next member waiting or back to the shelf. */
export const cancelSchema = z.strictObject({ orgId: id, reservationId: id, reason });

/** Shared by staff (reservations-cancel) and members cancelling their own (me-cancelReservation). */
export async function cancelReservation(
  { actor, input, requestId }: CallContext<z.infer<typeof cancelSchema>>,
  tx: Transaction,
  authorize: (reservation: FirebaseFirestore.DocumentSnapshot) => Promise<void>,
) {
    const ref = db.doc(`orgs/${input.orgId}/reservations/${input.reservationId}`);
    const res = await tx.get(ref);
    if (!res.exists) throw errors.notFound('Reservation');
    const status = res.get('status') as string;
    const member = memberRef(input.orgId, res.get('memberId'));
    if (status === 'ALLOCATED') {
      // A held copy: what handing it on needs is read alongside the permission check, which is listed first.
      const [, copy, [waiting], { holdHours }] = await inOrder([
        authorize(res),
        tx.get(db.doc(`orgs/${input.orgId}/copies/${res.get('allocatedCopyId')}`)),
        nextWaiting(tx, input.orgId, res.get('branchId'), res.get('bookId')),
        readCirculationConfig(tx, input.orgId),
      ]);
      tx.update(ref, { status: 'CANCELLED', cancelReason: input.reason, updatedAt: FieldValue.serverTimestamp() });
      tx.update(member, { allocatedCount: FieldValue.increment(-1) });
      makeAvailable(tx, input.orgId, copy, {}, { type: 'RESERVATION_CANCELLED', actorUid: actor.uid, ref: { reservationId: res.id } }, waiting, holdHours);
    } else {
      await authorize(res);
      if (status !== 'WAITING') throw errors.conflict('NOT_OPEN', 'This reservation is already closed.');
      tx.update(ref, { status: 'CANCELLED', cancelReason: input.reason, updatedAt: FieldValue.serverTimestamp() });
      tx.update(member, { waitingCount: FieldValue.increment(-1) });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'reservation.cancel', entityType: 'reservation', entityId: res.id, branchId: res.get('branchId'), memberId: res.get('memberId'),
      before: { status }, after: { status: 'CANCELLED' }, reason: input.reason,
    });
    queueWhatsApp(tx, { orgId: input.orgId, branchId: res.get('branchId'), event: 'reservation_cancelled', memberId: res.get('memberId'), vars: { book_title: res.get('bookTitle') as string }, ref: { reservationId: res.id } });
    return { reservationId: res.id };
}

export const cancel = command('reservations-cancel', cancelSchema, (ctx, tx) =>
  cancelReservation(ctx, tx, (res) => ctx.actor.require('reservations.manage', ctx.input.orgId, res.get('branchId'), tx)),
);

/**
 * Releases holds that were not collected in time (D3): the reservation
 * expires and the copy goes to the next member waiting, else back on the shelf.
 * Idempotent: each hold is re-checked in its own transaction.
 */
export async function expireHolds(now = new Date()): Promise<number> {
  const due = db.collectionGroup('reservations').where('status', '==', 'ALLOCATED').where('holdUntil', '<=', Timestamp.fromDate(now));
  // One at a time: holds on the same title pass copies between members, so parallel runs would only contend.
  const run = await sweep('expireHolds', due, (doc) => {
    const orgId = doc.ref.parent.parent!.id;
    return db.runTransaction(async (tx) => {
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
        action: 'reservation.expire', entityType: 'reservation', entityId: res.id, branchId: res.get('branchId'), memberId: res.get('memberId'),
        before: { status: 'ALLOCATED' }, after: { status: 'EXPIRED', passedTo: waiting?.id ?? null },
      });
      queueWhatsApp(tx, { orgId, branchId: res.get('branchId'), event: 'reservation_expired', memberId: res.get('memberId'), vars: { book_title: res.get('bookTitle') as string }, ref: { reservationId: res.id } });
      return true;
    });
  }, { concurrency: 1 });
  return run.changed;
}

export const expireHoldsSweep = onSchedule({ schedule: 'every 15 minutes', region: REGION, timeZone: 'Asia/Kolkata', ...JOB_OPTIONS }, async () => {
  await expireHolds();
});
