import { FieldValue, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { db } from '../core/firebase.js';
import { loadCredentials, RazorpayError, rzp } from './razorpay.js';

/**
 * Razorpay payment requests (links and QR codes) stored at
 * orgs/{o}/paymentRequests/{razorpayId}: OPEN → PAID / CANCELLED.
 */
export const requestRef = (orgId: string, gatewayId: string) => db.doc(`orgs/${orgId}/paymentRequests/${gatewayId}`);

/** Read phase: the OPEN requests of some subscriptions. */
export async function readOpenRequests(tx: Transaction, orgId: string, subscriptionIds: string[]): Promise<QueryDocumentSnapshot[]> {
  if (!subscriptionIds.length) return [];
  const snaps = await Promise.all(
    subscriptionIds.map((s) => tx.get(db.collection(`orgs/${orgId}/paymentRequests`).where('subscriptionId', '==', s).where('status', '==', 'OPEN'))),
  );
  return snaps.flatMap((s) => s.docs);
}

/**
 * Write phase: marks requests CANCELLED (the subscription they pay for is
 * gone). A payment that still arrives for one is recorded for finance, never
 * applied. Cancel them at Razorpay after the commit with `cancelAtGateway`.
 */
export function markRequestsCancelled(tx: Transaction, requests: QueryDocumentSnapshot[], by: string, reason: string) {
  for (const r of requests) tx.update(r.ref, { status: 'CANCELLED', cancelledBy: by, cancelReason: reason, cancelledAt: FieldValue.serverTimestamp() });
}

/** Razorpay's answer when a link or QR code is already closed: nothing left to cancel. */
export const alreadyClosed = (e: unknown) =>
  e instanceof RazorpayError && e.status >= 400 && e.status < 500 && /already|cancell?ed|closed|expired/i.test(e.message) && !/paid/i.test(e.message);

/** Cancels a link / closes a QR code at Razorpay ("already cancelled" counts as done). */
export async function closeAtRazorpay(creds: Awaited<ReturnType<typeof loadCredentials>>, channel: string, gatewayId: string) {
  try {
    if (channel === 'QR') await rzp(creds, 'POST', `/payments/qr_codes/${gatewayId}/close`);
    else await rzp(creds, 'POST', `/payment_links/${gatewayId}/cancel`);
  } catch (e) {
    if (!alreadyClosed(e)) throw e;
  }
}

/**
 * Post-commit, best effort: cancels requests (already marked CANCELLED) at
 * Razorpay so the member can no longer pay them. A failure is logged and
 * saved on the request; a payment that still arrives needs finance's attention.
 */
export async function cancelAtGateway(orgId: string, requestIds: string[]) {
  for (const id of requestIds) {
    const ref = requestRef(orgId, id);
    try {
      const r = await ref.get();
      if (!r.exists) continue;
      const creds = await loadCredentials(null, orgId, r.get('branchId') as string, { requireEnabled: false });
      await closeAtRazorpay(creds, r.get('channel') as string, id);
      await ref.update({ gatewayCancelledAt: FieldValue.serverTimestamp(), gatewayCancelError: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn('payment request: could not cancel at Razorpay', { orgId, gatewayId: id, error: message });
      await ref.update({ gatewayCancelError: message }).catch(() => undefined);
    }
  }
}
