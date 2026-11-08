import { FieldValue, type DocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { query } from '../core/callable.js';
import { AppError, errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';
import { type CourierStatus, CourierError, courierFor, type Stop, type Tracking } from './couriers.js';
import { queueOut, summary } from './messages.js';
import { branchRef, courierConnection, type Delivery, deliveriesCol, isCourier, loadDelivery, settingsOf } from './model.js';

// Courier apps booked through their API (docs/DELIVERY.md §4): booking after
// dispatch, quotes, tracking (webhook or a refresh) and cancelling.

function stopOf(kind: 'BRANCH' | 'MEMBER', d: Delivery, branch: DocumentSnapshot): Stop {
  if (kind === 'BRANCH') {
    const a = branch.get('address') as { line1: string; line2?: string; city: string; state: string; postalCode: string };
    return {
      geo: settingsOf(branch).location!, name: `Stories ${branch.get('name')}`, phone: String(branch.get('contact.phone') ?? '').replace(/\s/g, ''),
      line1: a.line1, line2: a.line2 ?? '', landmark: '', city: a.city, state: a.state, postalCode: a.postalCode,
    };
  }
  return {
    geo: d.address.geo!, name: d.memberName, phone: d.phone ?? '', line1: d.address.line1, line2: d.address.line2, landmark: d.address.landmark,
    city: d.address.city, state: d.address.state, postalCode: d.address.postalCode,
  };
}

function tripOf(d: Delivery, branch: DocumentSnapshot) {
  const out = d.kind === 'DELIVER';
  return {
    pickup: stopOf(out ? 'BRANCH' : 'MEMBER', d, branch),
    drop: stopOf(out ? 'MEMBER' : 'BRANCH', d, branch),
    instructions: out
      ? `Library books for ${d.memberName} (${d.sent.length} in a sealed bag). ${d.note}`.trim()
      : `Collect library books from ${d.memberName} and bring them to the Stories branch. ${d.note}`.trim(),
  };
}

/**
 * The request id to book with. It is the courier's idempotency key, so a
 * retry reuses the last one — a booking that timed out may still have made an
 * order, and the same id lets the courier answer with that order instead of
 * booking a second rider. Only once the last request is known to have made no
 * live order (the courier refused it, or its order was cancelled) does the
 * next booking get a new id: `<deliveryId>`, then `<deliveryId>-2`, `-3`…
 */
export function nextRequest(deliveryId: string, p: Pick<NonNullable<Delivery['provider']>, 'requestNo' | 'requestSpent'>) {
  const last = p.requestNo ?? 0;
  const requestNo = last === 0 ? 1 : p.requestSpent ? last + 1 : last;
  return { requestNo, requestId: requestNo === 1 ? deliveryId : `${deliveryId}-${requestNo}` };
}

/** The courier refused the booking outright (4xx): no order was made, so the next try may use a new request id. */
const refused = (e: unknown) => e instanceof CourierError && e.status >= 400 && e.status < 500;

/**
 * Books the courier for a dispatched delivery (after the dispatch commits).
 * A failure is saved on the delivery for staff to retry or switch method; it
 * never undoes the dispatch.
 */
export async function bookCourier(orgId: string, deliveryId: string): Promise<{ booked: boolean; error: string | null }> {
  const ref = deliveriesCol(orgId).doc(deliveryId);
  const snap = await ref.get();
  const d = snap.data() as Delivery & { provider: NonNullable<Delivery['provider']> };
  if (!snap.exists || d.status !== 'OUT' || !d.provider || d.provider.orderId) return { booked: false, error: null };
  const courier = courierFor(d.provider.key)!;
  const attempts = (d.provider.attempts ?? 0) + 1;
  const { requestNo, requestId } = nextRequest(deliveryId, d.provider);
  let sent = false;
  try {
    const conn = await courierConnection(orgId, d.branchId, d.provider.key);
    const branch = await branchRef(orgId, d.branchId).get();
    sent = true;
    const booking = await courier.book(conn, { requestId, ...tripOf(d, branch) });
    const batch = db.batch();
    const provider = {
      ...d.provider, orderId: booking.orderId, status: 'BOOKED', trackingUrl: booking.trackingUrl, fareMinor: booking.fareMinor, error: null,
      attempts, requestNo, requestSpent: false, syncedAt: FieldValue.serverTimestamp(),
    };
    batch.update(ref, { provider, updatedAt: FieldValue.serverTimestamp() });
    queueOut(batch, orgId, deliveryId, { ...d, provider: { ...d.provider, trackingUrl: booking.trackingUrl } });
    await batch.commit();
    return { booked: true, error: null };
  } catch (e) {
    const known = e instanceof CourierError || e instanceof AppError;
    const error = known ? (e as Error).message : `Could not book ${courier.label}. Try again.`;
    if (!known) logger.error('courier booking', e);
    await ref.update({
      'provider.status': 'BOOKING_FAILED', 'provider.error': error, 'provider.attempts': attempts,
      // Not sent (e.g. the courier was switched off): the last request id is unchanged.
      ...(sent ? { 'provider.requestNo': requestNo, 'provider.requestSpent': refused(e) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { booked: false, error };
  }
}

/** Books the courier again: after a failed booking, or when the courier cancelled. */
export const book = query('deliveries-book', z.strictObject({ orgId: id, deliveryId: id }), async ({ actor, input }) => {
  const { ref, d } = await loadDelivery(null, input.orgId, input.deliveryId);
  await actor.require('delivery.assign', input.orgId, d.branchId);
  if (d.status !== 'OUT' || !isCourier(d.method) || !d.provider) throw errors.conflict('NOT_COURIER', 'Only a dispatched courier delivery can be booked.');
  if (d.provider.orderId && d.provider.status !== 'CANCELLED') throw errors.conflict('ALREADY_BOOKED', 'The courier is already booked for this delivery.');
  // The courier cancelled the last order: book afresh with a new request id.
  if (d.provider.orderId) await ref.update({ 'provider.orderId': null, 'provider.partner': null, 'provider.trackingUrl': null, 'provider.requestSpent': true });
  const r = await bookCourier(input.orgId, input.deliveryId);
  if (r.error) throw errors.conflict('COURIER_ERROR', r.error);
  return r;
});

/** Fares from the courier for a delivery (before or after dispatching). */
export const quote = query('deliveries-quote', z.strictObject({ orgId: id, deliveryId: id, courier: z.string().min(2).max(20) }), async ({ actor, input }) => {
  const { d } = await loadDelivery(null, input.orgId, input.deliveryId);
  await actor.require('delivery.assign', input.orgId, d.branchId);
  const c = courierFor(input.courier);
  if (!c) throw errors.invalid('Unknown courier.');
  const branch = await branchRef(input.orgId, d.branchId).get();
  if (!settingsOf(branch).location) throw errors.conflict('NO_BRANCH_LOCATION', 'Set the branch’s map location in Settings → Delivery first.');
  if (!d.address.geo) throw errors.conflict('NO_MEMBER_LOCATION', 'Add the member’s map location to the delivery address first.');
  const conn = await courierConnection(input.orgId, d.branchId, c.key);
  const trip = tripOf({ ...d, kind: d.kind === 'PICKUP' ? 'PICKUP' : 'DELIVER' }, branch);
  try {
    return { fares: await c.quote(conn, trip) };
  } catch (e) {
    if (e instanceof CourierError) throw errors.conflict('COURIER_ERROR', e.message);
    throw e;
  }
});

/**
 * Applies the courier's latest state. When the courier drops the books, a
 * delivery is done and a pickup's books are at the branch to be received.
 */
export async function applyTracking(orgId: string, deliveryId: string, t: Tracking) {
  await db.runTransaction(async (tx) => {
    const { ref, d } = await loadDelivery(tx, orgId, deliveryId);
    if (!d.provider) return;
    const provider = {
      ...d.provider,
      status: t.status === 'UNKNOWN' ? d.provider.status : t.status,
      raw: t.raw || d.provider.raw,
      trackingUrl: t.trackingUrl ?? d.provider.trackingUrl,
      fareMinor: t.fareMinor ?? d.provider.fareMinor,
      partner: t.partner ?? d.provider.partner,
      syncedAt: FieldValue.serverTimestamp(),
    };
    const done = t.status === 'DELIVERED' && d.status === 'OUT' && !d.outcome;
    if (!done) {
      tx.update(ref, { provider, updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (d.kind === 'PICKUP') {
      const loans = await Promise.all(d.collectLoanIds.map((l) => tx.get(db.doc(`orgs/${orgId}/loans/${l}`))));
      const collected = loans.filter((l) => l.get('status') === 'ACTIVE').map((l) => ({ loanId: l.id, copyId: l.get('copyId'), copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle') }));
      tx.update(ref, { provider, outcome: 'DELIVERED', collected, status: collected.length ? 'RETURNING' : 'COMPLETED', reportedAt: FieldValue.serverTimestamp(), ...(collected.length ? {} : { closedAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() });
      queueWhatsApp(tx, { orgId, branchId: d.branchId, event: 'delivery_completed', memberId: d.memberId, vars: { delivery_summary: summary(0, collected.length) }, ref: { deliveryId } });
    } else {
      tx.update(ref, { provider, outcome: 'DELIVERED', status: 'COMPLETED', reportedAt: FieldValue.serverTimestamp(), closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      queueWhatsApp(tx, { orgId, branchId: d.branchId, event: 'delivery_completed', memberId: d.memberId, vars: { delivery_summary: summary(d.sent.length, 0) }, ref: { deliveryId } });
    }
    recordAudit(tx, { actorUid: 'system' }, orgId, {
      action: 'delivery.courierDone', entityType: 'delivery', entityId: deliveryId, branchId: d.branchId, memberId: d.memberId,
      after: { courier: d.provider.key, orderId: d.provider.orderId },
    });
  });
}

/** Asks the courier where an order is (Porter allows one track call per order per minute). */
export async function syncOne(orgId: string, deliveryId: string, minAgeMs = 60_000): Promise<CourierStatus | null> {
  const snap = await deliveriesCol(orgId).doc(deliveryId).get();
  const d = snap.data() as (Delivery & { provider: { syncedAt?: Timestamp } }) | undefined;
  if (!d?.provider?.orderId || !['OUT', 'RETURNING'].includes(d.status)) return null;
  if (d.provider.syncedAt && Date.now() - d.provider.syncedAt.toMillis() < minAgeMs) return null;
  const c = courierFor(d.provider.key)!;
  const conn = await courierConnection(orgId, d.branchId, c.key);
  const t = await c.track(conn, d.provider.orderId);
  await applyTracking(orgId, deliveryId, t);
  return t.status;
}

/** Refreshes the branch's courier orders on the board (or one delivery), skipping those checked in the last minute. */
export const sync = query('deliveries-sync', z.strictObject({ orgId: id, branchId: id, deliveryId: id.nullable().default(null) }), async ({ actor, input }) => {
  await actor.require('delivery.manage', input.orgId, input.branchId);
  const ids = input.deliveryId
    ? [input.deliveryId]
    : (await deliveriesCol(input.orgId).where('branchId', '==', input.branchId).where('status', '==', 'OUT').limit(30).get()).docs
        .filter((d) => d.get('provider.orderId'))
        .slice(0, 10)
        .map((d) => d.id);
  const updated: Record<string, string> = {};
  const failed: string[] = [];
  for (const deliveryId of ids) {
    try {
      const s = await syncOne(input.orgId, deliveryId);
      if (s) updated[deliveryId] = s;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (input.deliveryId && failed.length) throw errors.conflict('COURIER_ERROR', failed[0]);
  return { updated, failed: failed.length };
});

/** After a cancel commits: cancels the courier's order (a failure is saved for staff to cancel it in the courier's app). */
export async function cancelAtCourier(orgId: string, deliveryId: string, c: { key: string; orderId: string; branchId: string } | null) {
  if (!c) return;
  try {
    await courierFor(c.key)!.cancel(await courierConnection(orgId, c.branchId, c.key), c.orderId);
    await deliveriesCol(orgId).doc(deliveryId).update({ 'provider.status': 'CANCELLED', 'provider.error': null, 'provider.requestSpent': true });
  } catch (e) {
    await deliveriesCol(orgId).doc(deliveryId).update({ 'provider.error': `Cancel it in ${courierFor(c.key)?.label ?? c.key} too: ${(e as Error).message}` });
  }
}
