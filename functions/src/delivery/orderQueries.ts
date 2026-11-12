import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import { query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { collects, type Delivery, deliveriesCol, OPEN_STATUSES, row } from './model.js';

// Reading deliveries: the branch's board, the rider's run, one delivery.

/**
 * The branch's delivery board: everything open, and, only when `closed` is asked for, what closed in the last two
 * weeks. `closed` is always in the answer (empty when not asked), so callers that only count the open rows pay
 * for one query.
 */
export const list = query('deliveries-list', z.strictObject({ orgId: id, branchId: id, closed: z.boolean().default(false) }), async ({ actor, input }) => {
  await actor.require('delivery.manage', input.orgId, input.branchId);
  const since = Timestamp.fromMillis(Date.now() - 14 * 86_400_000);
  const [open, closed] = await Promise.all([
    deliveriesCol(input.orgId).where('branchId', '==', input.branchId).where('status', 'in', [...OPEN_STATUSES]).orderBy('requestedAt', 'asc').limit(200).get(),
    input.closed ? deliveriesCol(input.orgId).where('branchId', '==', input.branchId).where('closedAt', '>=', since).orderBy('closedAt', 'desc').limit(60).get() : null,
  ]);
  return { open: open.docs.map(row), closed: closed?.docs.map(row) ?? [] };
});

/** How many visits wait to be dispatched and how many bags wait to be received (the menu and dashboard counts). */
export const counts = query('deliveries-counts', z.strictObject({ orgId: id, branchId: id }), async ({ actor, input }) => {
  await actor.require('delivery.manage', input.orgId, input.branchId);
  // Equality filters only: served by the automatic indexes. An orderBy or a range here would need a composite one.
  const at = deliveriesCol(input.orgId).where('branchId', '==', input.branchId);
  const [requested, returning] = await Promise.all([at.where('status', '==', 'REQUESTED').count().get(), at.where('status', '==', 'RETURNING').count().get()]);
  return { requested: requested.data().count, returning: returning.data().count };
});

/** The rider's run: deliveries assigned to the caller that are out. */
export const mine = query('deliveries-mine', z.strictObject({ orgId: id }), async ({ actor, input }) => {
  const snap = await deliveriesCol(input.orgId).where('rider.uid', '==', actor.uid).where('status', '==', 'OUT').limit(50).get();
  const rows = snap.docs.map(row);
  // Books the member has out, so the rider can tick what they collect.
  const loans = await Promise.all(
    snap.docs.map((d) =>
      collects(d.get('kind'))
        ? db.collection(`orgs/${input.orgId}/loans`).where('memberId', '==', d.get('memberId')).where('status', '==', 'ACTIVE').limit(20).get()
        : null,
    ),
  );
  return {
    deliveries: rows.map((r, i) => ({
      ...r,
      memberLoans: loans[i]?.docs.filter((l) => l.get('deliveryId') !== r.id).map((l) => ({ loanId: l.id, copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle') })) ?? [],
    })),
  };
});

/** One delivery with the member's books out (for the dispatch and report dialogs). */
export const get = query('deliveries-get', z.strictObject({ orgId: id, deliveryId: id }), async ({ actor, input }) => {
  const snap = await deliveriesCol(input.orgId).doc(input.deliveryId).get();
  if (!snap.exists) throw errors.notFound('Delivery');
  const d = snap.data() as Delivery;
  if (d.rider?.uid !== actor.uid) await actor.require('delivery.manage', input.orgId, d.branchId);
  const [loans, holds] = await Promise.all([
    db.collection(`orgs/${input.orgId}/loans`).where('memberId', '==', d.memberId).where('status', '==', 'ACTIVE').limit(20).get(),
    db.collection(`orgs/${input.orgId}/reservations`).where('memberId', '==', d.memberId).where('status', '==', 'ALLOCATED').limit(20).get(),
  ]);
  return {
    delivery: row(snap),
    memberLoans: loans.docs.map((l) => ({ loanId: l.id, copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle'), deliveryId: l.get('deliveryId') ?? null })),
    holds: holds.docs.filter((h) => h.get('branchId') === d.branchId).map((h) => ({ reservationId: h.id, bookTitle: h.get('bookTitle'), copyCode: h.get('allocatedCopyCode') })),
  };
});
