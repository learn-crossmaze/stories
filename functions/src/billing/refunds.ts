import { FieldValue, type DocumentSnapshot, type Timestamp, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { money } from '../catalogue/model.js';
import { recordAudit } from '../core/audit.js';
import { query, requestIdSchema } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { balanceOf, depositRef, postLedger } from './ledger.js';
import { gatewayError, loadCredentials, RazorpayError, rzp } from './razorpay.js';
import { queueWhatsApp, rupeesText } from '../messaging/whatsapp.js';

/**
 * Refunds against a payment the member made (docs/PAYMENTS.md §Refunds).
 *
 * A payment collected through Razorpay is refunded through Razorpay (back to
 * the member's card, UPI or bank, from the branch's Razorpay balance); a
 * counter payment is refunded at the counter and recorded here. Either way
 * the refund is an outgoing payment (`direction: OUT`, `refundOf`) on the
 * member, the original payment keeps a running `refundedMinor`, and the part
 * taken from the deposit leaves the deposit ledger.
 *
 * Razorpay can't take part in a Firestore transaction, so a Razorpay refund
 * is done in three steps: reserve (record PROCESSING and count it against the
 * payment), ask Razorpay, then settle (PENDING / SUCCESS) or release (FAILED).
 * Only a definite refusal releases it: when Razorpay can't be reached or
 * answers with a server error the refund may have been made, so it stays
 * PROCESSING until a webhook or a status check says what happened.
 */

export type RefundMethod = 'RAZORPAY' | 'OFFLINE_CASH' | 'OFFLINE_UPI' | 'OFFLINE_BANK_TRANSFER';
const REFUNDABLE = ['SUCCESS', 'NEEDS_ATTENTION'];
/** A refund Razorpay may still be working on (a refund marked NEEDS_ATTENTION here was revived after failing). */
const OPEN_REFUND = ['PROCESSING', 'PENDING', 'NEEDS_ATTENTION'];
/** A refund with no answer saved is given up as "never made" only after this long (Razorpay lists a new refund within seconds). */
const RELEASE_AFTER_MS = 10 * 60_000;

interface RazorpayRefund {
  id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  payment_id?: string;
  speed_processed?: string;
}

type AuditActor = { actorUid: string; actorEmail: string | null; requestId?: string };

const refundSchema = z
  .strictObject({
    orgId: id,
    paymentId: id,
    amountMinor: money.refine((n) => n >= 100, 'must be at least ₹1'),
    /** The part of the refund that comes out of the member's deposit. */
    depositMinor: money.default(0),
    method: z.enum(['RAZORPAY', 'OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER']),
    reference: z.string().trim().max(60).default(''),
    /** Razorpay: normal (5–7 working days, free) or optimum (instant where the bank allows; Razorpay charges a fee). */
    speed: z.enum(['normal', 'optimum']).default('normal'),
    reason,
    requestId: requestIdSchema,
  })
  .refine((p) => p.depositMinor <= p.amountMinor, 'the deposit part cannot be more than the refund')
  .refine((p) => p.method === 'RAZORPAY' || p.method === 'OFFLINE_CASH' || p.reference.length >= 4, 'needs the UPI/bank reference number');

const paymentLine = (p: DocumentSnapshot, type: string) =>
  ((p.get('lines') as { type: string; amountMinor: number }[] | undefined) ?? []).filter((l) => l.type === type).reduce((n, l) => n + l.amountMinor, 0);

/** What is left to refund on a payment (refunds in progress count). */
export const refundableOf = (p: DocumentSnapshot) => (p.get('amountMinor') as number) - ((p.get('refundedMinor') as number | undefined) ?? 0);

/** Deposit collected by a payment and not yet refunded from it. */
const depositLeftOf = (p: DocumentSnapshot) => paymentLine(p, 'DEPOSIT') - ((p.get('refundedDepositMinor') as number | undefined) ?? 0);

/** The refund record for a request: its id comes from the requestId, so a repeated or concurrent call finds the same one. */
const refundRefFor = (orgId: string, requestId: string) => db.doc(`orgs/${orgId}/payments/rf_${requestId}`);

/**
 * What a refund took from the deposit ledger (and counts in the payment's
 * refundedDepositMinor). Settling takes at most the balance left then.
 * Refunds settled before `depositTakenMinor` existed took the requested part.
 */
const depositTakenOf = (r: DocumentSnapshot) =>
  (r.get('depositTakenMinor') as number | undefined) ?? (r.get('status') === 'PROCESSING' ? 0 : ((r.get('depositMinor') as number | undefined) ?? 0));

function describe(r: DocumentSnapshot) {
  return {
    refundId: r.id,
    status: r.get('status') as string,
    amountMinor: r.get('amountMinor') as number,
    method: r.get('method') as string,
    gatewayRefundId: (r.get('gateway.refundId') as string | null | undefined) ?? null,
  };
}

const unconfirmed = () =>
  errors.conflict(
    'REFUND_UNCONFIRMED',
    "Razorpay didn't confirm this refund, so it is saved as Processing. Use Check status on Payments & refunds in a few minutes — don't refund it again.",
  );

/** A refusal Razorpay will not change its mind about (bad request, not enough balance, refund failed): the refund was not made. */
const definite = (e: unknown) => e instanceof RazorpayError && e.status >= 400 && e.status < 500;

/**
 * Refunds (part of) a payment. Needs `payments.refund` at the payment's
 * branch (librarians, branch managers, franchise owners, finance). The amount
 * is what the person refunding approves, up to what is left on the payment.
 */
export const refundPayment = query('payments-refund', refundSchema, async ({ actor, input }) => {
  const payRef = db.doc(`orgs/${input.orgId}/payments/${input.paymentId}`);
  const refundRef = refundRefFor(input.orgId, input.requestId);
  const audit: AuditActor = { actorUid: actor.uid, actorEmail: actor.email, requestId: input.requestId };

  // 1. Reserve: checks, the refund record (claimed by its requestId-based id), and the amount counted against the payment.
  const reserved = await db.runTransaction(async (tx) => {
    const prior = await tx.get(refundRef);
    // A retried (or concurrent) request answers with the first refund instead of refunding twice.
    if (prior.exists) return { replay: prior };
    const pay = await tx.get(payRef);
    if (!pay.exists) throw errors.notFound('Payment');
    const branchId = pay.get('branchId') as string;
    const memberId = pay.get('memberId') as string;
    await actor.require('payments.refund', input.orgId, branchId, tx);
    const [member, account] = await Promise.all([tx.get(db.doc(`orgs/${input.orgId}/members/${memberId}`)), tx.get(depositRef(input.orgId, memberId))]);
    if (pay.get('direction') !== 'IN' || !REFUNDABLE.includes(pay.get('status'))) throw errors.conflict('NOT_REFUNDABLE', 'Only a payment received from a member can be refunded.');
    const left = refundableOf(pay);
    if (left <= 0) throw errors.conflict('FULLY_REFUNDED', 'This payment has already been refunded in full.');
    if (input.amountMinor > left) throw errors.invalid(`At most ₹${(left / 100).toLocaleString('en-IN')} is left to refund on this payment.`);
    const gatewayPaymentId = (pay.get('gateway.paymentId') as string | undefined) ?? null;
    if (input.method === 'RAZORPAY' && !gatewayPaymentId) throw errors.invalid('This payment was taken at the counter. Refund it at the counter and record how.');
    if (input.method !== 'RAZORPAY' && gatewayPaymentId) throw errors.invalid('This payment came through Razorpay. Refund it through Razorpay so the money goes back the way it came.');
    if (input.depositMinor > 0) {
      if (input.depositMinor > depositLeftOf(pay)) throw errors.invalid('The deposit part is more than this payment collected as deposit.');
      if (input.depositMinor > balanceOf(account)) throw errors.conflict('DEPOSIT_INSUFFICIENT', "The member's deposit balance is less than the deposit part.");
    }

    const offline = input.method !== 'RAZORPAY';
    const lines = [
      ...(input.amountMinor - input.depositMinor > 0 ? [{ type: 'REFUND', amountMinor: input.amountMinor - input.depositMinor }] : []),
      ...(input.depositMinor > 0 ? [{ type: 'DEPOSIT_REFUND', amountMinor: input.depositMinor }] : []),
    ];
    tx.create(refundRef, {
      memberId, memberCode: pay.get('memberCode') ?? null, memberName: member.get('fullName') ?? null, branchId,
      subscriptionId: pay.get('subscriptionId') ?? null, purpose: 'REFUND', direction: 'OUT', refundOf: pay.id,
      lines, amountMinor: input.amountMinor, depositMinor: input.depositMinor, currency: 'INR',
      ...(offline ? { depositTakenMinor: input.depositMinor } : {}),
      method: input.method, reference: input.reference || null, reason: input.reason,
      gateway: offline ? null : { provider: 'razorpay', paymentId: gatewayPaymentId, refundId: null, speed: input.speed },
      status: offline ? 'SUCCESS' : 'PROCESSING', requestId: input.requestId, recordedBy: actor.uid, recordedByEmail: actor.email,
      at: FieldValue.serverTimestamp(),
    });
    tx.update(payRef, {
      refundedMinor: FieldValue.increment(input.amountMinor),
      ...(input.depositMinor ? { refundedDepositMinor: FieldValue.increment(input.depositMinor) } : {}),
    });
    if (offline) {
      if (input.depositMinor > 0) takeDeposit(tx, input.orgId, account, memberId, branchId, input.depositMinor, refundRef.id, actor.uid);
      queueWhatsApp(tx, { orgId: input.orgId, branchId, event: 'refund_processed', memberId, vars: { amount: rupeesText(input.amountMinor) }, ref: { refundId: refundRef.id } });
      recordAudit(tx, audit, input.orgId, {
        action: 'payment.refund', entityType: 'payment', entityId: pay.id, branchId, memberId, reason: input.reason,
        after: { refundId: refundRef.id, amountMinor: input.amountMinor, depositMinor: input.depositMinor, method: input.method, reference: input.reference || null },
      });
    }
    return { replay: null, branchId, memberId, gatewayPaymentId, offline };
  });
  if (reserved.replay) {
    // Still being asked (or the answer never came): don't let the caller think it is done.
    if (reserved.replay.get('status') === 'PROCESSING') throw unconfirmed();
    return describe(reserved.replay);
  }
  if (reserved.offline) return describe(await refundRef.get());

  // 2. Ask Razorpay (from the branch's Razorpay balance).
  let refund: RazorpayRefund;
  try {
    const creds = await loadCredentials(null, input.orgId, reserved.branchId!, { requireEnabled: false });
    refund = await rzp<RazorpayRefund>(creds, 'POST', `/payments/${reserved.gatewayPaymentId}/refund`, {
      amount: input.amountMinor,
      speed: input.speed,
      receipt: refundRef.id,
      notes: { orgId: input.orgId, branchId: reserved.branchId, memberId: reserved.memberId, refundId: refundRef.id },
    });
  } catch (e) {
    // Never asked (no gateway set up) or refused outright: the refund didn't happen.
    if (!(e instanceof RazorpayError) || definite(e)) {
      await release(input.orgId, refundRef.id, e instanceof RazorpayError ? e.message : 'Online payments are not set up for this branch.', audit);
      if (e instanceof RazorpayError) gatewayError(e);
      throw e;
    }
    // No answer, or a server error: Razorpay may have refunded. Leave it PROCESSING for the webhook or a status check.
    logger.warn('payments-refund: outcome unknown, left processing', { orgId: input.orgId, refundId: refundRef.id, status: e.status, error: e.message });
    await refundRef.update({ lastError: e.message }).catch(() => undefined);
    throw unconfirmed();
  }
  if (refund.status === 'failed') {
    await release(input.orgId, refundRef.id, 'Razorpay could not make this refund.', audit);
    throw errors.conflict('GATEWAY_ERROR', 'Razorpay: Razorpay could not make this refund.');
  }

  // 3. Settle: Razorpay has taken the refund (processed now, or pending with the bank).
  await settle(input.orgId, refundRef.id, refund, audit);
  return describe(await refundRef.get());
});

/** Debits the deposit ledger for the deposit part of a refund. */
function takeDeposit(tx: Transaction, orgId: string, account: DocumentSnapshot, memberId: string, branchId: string, amount: number, refundId: string, actorUid: string) {
  postLedger(tx, orgId, account, {
    memberId, branchId, type: 'DEPOSIT_REFUND', deltaMinor: -amount, reason: 'Deposit refunded to the member',
    reference: { paymentId: refundId }, actorUid, approvedBy: actorUid,
  });
}

/**
 * Razorpay accepted the refund: records its id and status and takes the
 * deposit part (once). The member's deposit may have dropped since the
 * refund was reserved, so at most the balance is taken; what was taken is
 * saved as `depositTakenMinor` (a later failure gives back exactly that).
 */
async function settle(orgId: string, refundId: string, refund: RazorpayRefund, audit: AuditActor) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`orgs/${orgId}/payments/${refundId}`);
    const r = await tx.get(ref);
    if (!r.exists || r.get('status') !== 'PROCESSING') return;
    const memberId = r.get('memberId') as string;
    const depositMinor = (r.get('depositMinor') as number) ?? 0;
    const account = depositMinor > 0 ? await tx.get(depositRef(orgId, memberId)) : null;
    const status = refund.status === 'processed' ? 'SUCCESS' : 'PENDING';
    const taken = account ? Math.min(depositMinor, balanceOf(account)) : 0;
    if (account && taken > 0) takeDeposit(tx, orgId, account, memberId, r.get('branchId'), taken, refundId, r.get('recordedBy'));
    // What couldn't come out of the deposit refunds the fee instead: the payment counts only what left the deposit.
    if (taken < depositMinor) tx.update(db.doc(`orgs/${orgId}/payments/${r.get('refundOf')}`), { refundedDepositMinor: FieldValue.increment(taken - depositMinor) });
    tx.update(ref, {
      status, depositTakenMinor: taken, 'gateway.refundId': refund.id, 'gateway.speedProcessed': refund.speed_processed ?? null, reference: refund.id,
      lastError: FieldValue.delete(), settledAt: FieldValue.serverTimestamp(),
    });
    queueWhatsApp(tx, { orgId, branchId: r.get('branchId'), event: 'refund_processed', memberId, vars: { amount: rupeesText(r.get('amountMinor') as number) }, ref: { refundId } });
    recordAudit(tx, audit, orgId, {
      action: 'payment.refund', entityType: 'payment', entityId: r.get('refundOf'), branchId: r.get('branchId'), memberId, reason: r.get('reason'),
      after: { refundId, amountMinor: r.get('amountMinor'), depositMinor, depositTakenMinor: taken, method: 'RAZORPAY', gatewayRefundId: refund.id, status },
    });
  });
}

/** The refund did not happen: marks it FAILED and gives the amount back to the payment (and exactly the deposit it took, if any). */
async function release(orgId: string, refundId: string, why: string, audit: AuditActor) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`orgs/${orgId}/payments/${refundId}`);
    const r = await tx.get(ref);
    if (!r.exists || !OPEN_REFUND.includes(r.get('status'))) return;
    const memberId = r.get('memberId') as string;
    const taken = depositTakenOf(r);
    // What the payment counts as refunded from its deposit: the reserved part until settled, then what was taken.
    const counted = r.get('status') === 'PROCESSING' ? ((r.get('depositMinor') as number) ?? 0) : taken;
    const account = taken > 0 ? await tx.get(depositRef(orgId, memberId)) : null;
    if (account) {
      postLedger(tx, orgId, account, {
        memberId, branchId: r.get('branchId'), type: 'DEPOSIT_ADJUSTMENT', deltaMinor: taken, reason: 'Refund failed: deposit restored',
        reference: { paymentId: refundId }, actorUid: audit.actorUid, approvedBy: audit.actorUid,
      });
    }
    tx.update(ref, { status: 'FAILED', failure: why, depositTakenMinor: 0, settledAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`orgs/${orgId}/payments/${r.get('refundOf')}`), {
      refundedMinor: FieldValue.increment(-(r.get('amountMinor') as number)),
      ...(counted ? { refundedDepositMinor: FieldValue.increment(-counted) } : {}),
    });
    recordAudit(tx, audit, orgId, {
      action: 'payment.refundFailed', entityType: 'payment', entityId: r.get('refundOf'), branchId: r.get('branchId'), memberId,
      after: { refundId, amountMinor: r.get('amountMinor'), depositRestoredMinor: taken, failure: why },
    });
  });
}

/** Razorpay confirmed a refund that is PENDING here: it is now SUCCESS. */
async function complete(orgId: string, refundId: string, audit: AuditActor) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`orgs/${orgId}/payments/${refundId}`);
    const r = await tx.get(ref);
    if (!r.exists || r.get('status') !== 'PENDING') return;
    tx.update(ref, { status: 'SUCCESS', processedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, audit, orgId, {
      action: 'payment.refundProcessed', entityType: 'payment', entityId: r.get('refundOf'), branchId: r.get('branchId'), memberId: r.get('memberId'),
      before: { status: 'PENDING' }, after: { refundId, status: 'SUCCESS', gatewayRefundId: r.get('gateway.refundId') ?? null },
    });
  });
}

/**
 * Razorpay made (or is making) a refund that is FAILED here — e.g. it was
 * given up as "never made" before Razorpay's answer arrived. The money did
 * go back, so it counts against the payment again, takes its deposit part
 * again (up to the balance) and is flagged NEEDS_ATTENTION: finance checks
 * the member wasn't refunded a second time meanwhile.
 */
async function revive(orgId: string, refundId: string, refund: RazorpayRefund, audit: AuditActor) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`orgs/${orgId}/payments/${refundId}`);
    const r = await tx.get(ref);
    if (!r.exists || r.get('status') !== 'FAILED') return;
    const memberId = r.get('memberId') as string;
    const depositMinor = (r.get('depositMinor') as number) ?? 0;
    const account = depositMinor > 0 ? await tx.get(depositRef(orgId, memberId)) : null;
    const taken = account ? Math.min(depositMinor, balanceOf(account)) : 0;
    if (account && taken > 0) takeDeposit(tx, orgId, account, memberId, r.get('branchId'), taken, refundId, audit.actorUid);
    const note = 'Razorpay refunded this after it had been marked failed. Check the member was not refunded again.';
    tx.update(ref, {
      status: 'NEEDS_ATTENTION', note, depositTakenMinor: taken, failure: null, 'gateway.refundId': refund.id, reference: refund.id,
      gatewayStatus: refund.status, revivedAt: FieldValue.serverTimestamp(),
    });
    tx.update(db.doc(`orgs/${orgId}/payments/${r.get('refundOf')}`), {
      refundedMinor: FieldValue.increment(r.get('amountMinor') as number),
      ...(taken ? { refundedDepositMinor: FieldValue.increment(taken) } : {}),
    });
    recordAudit(tx, audit, orgId, {
      action: 'payment.refundRevived', entityType: 'payment', entityId: r.get('refundOf'), branchId: r.get('branchId'), memberId,
      before: { status: 'FAILED' }, after: { refundId, status: 'NEEDS_ATTENTION', gatewayRefundId: refund.id, gatewayStatus: refund.status, depositTakenMinor: taken },
    });
  });
}

/** Applies Razorpay's latest word on a refund (status check or webhook). */
async function applyRefundStatus(orgId: string, refundId: string, refund: RazorpayRefund, source: string) {
  const system: AuditActor = { actorUid: `razorpay:${source}`, actorEmail: null };
  const r = await db.doc(`orgs/${orgId}/payments/${refundId}`).get();
  const status = r.get('status') as string;
  if (refund.status === 'failed') return release(orgId, refundId, 'Razorpay reported the refund as failed.', system);
  if (status === 'PROCESSING') return settle(orgId, refundId, refund, system);
  if (status === 'FAILED') return revive(orgId, refundId, refund, system);
  if (status === 'PENDING' && refund.status === 'processed') return complete(orgId, refundId, system);
}

/** Asks Razorpay where a refund stands (pending refunds usually complete within 5–7 working days). */
export const checkRefund = query('payments-checkRefund', z.strictObject({ orgId: id, refundId: id }), async ({ actor, input }) => {
  const ref = db.doc(`orgs/${input.orgId}/payments/${input.refundId}`);
  const r = await ref.get();
  if (!r.exists || r.get('purpose') !== 'REFUND') throw errors.notFound('Refund');
  await actor.require('payments.view', input.orgId, r.get('branchId'));
  if (r.get('method') !== 'RAZORPAY' || !['PROCESSING', 'PENDING', 'FAILED'].includes(r.get('status'))) return describe(r);
  const creds = await loadCredentials(null, input.orgId, r.get('branchId'), { requireEnabled: false });
  let refund: RazorpayRefund | null = null;
  try {
    const gatewayRefundId = r.get('gateway.refundId') as string | null;
    if (gatewayRefundId) refund = await rzp<RazorpayRefund>(creds, 'GET', `/refunds/${gatewayRefundId}`);
    else {
      // Interrupted between asking Razorpay and saving its answer: find the refund by its receipt.
      const list = await rzp<{ items: (RazorpayRefund & { receipt?: string })[] }>(creds, 'GET', `/payments/${r.get('gateway.paymentId')}/refunds`);
      refund = list.items.find((i) => i.receipt === r.id) ?? null;
    }
  } catch (e) {
    gatewayError(e);
  }
  const age = Date.now() - ((r.get('at') as Timestamp | undefined)?.toMillis() ?? 0);
  if (refund) await applyRefundStatus(input.orgId, r.id, refund, 'check');
  else if (r.get('status') === 'PROCESSING' && age > RELEASE_AFTER_MS) {
    await release(input.orgId, r.id, 'Razorpay has no record of this refund.', { actorUid: actor.uid, actorEmail: actor.email });
  }
  return describe(await ref.get());
});

/** Webhook events `refund.processed` and `refund.failed` (see online.ts handleWebhook). */
export async function handleRefundEvent(orgId: string, refund: RazorpayRefund & { notes?: Record<string, string> }) {
  const refundId = refund.notes?.refundId;
  const found = refundId
    ? await db.doc(`orgs/${orgId}/payments/${refundId}`).get()
    : (await db.collection(`orgs/${orgId}/payments`).where('gateway.refundId', '==', refund.id).limit(1).get()).docs[0];
  if (!found?.exists) {
    logger.warn('razorpayWebhook: refund not found', { orgId, gatewayRefundId: refund.id });
    return 'unknown refund';
  }
  await applyRefundStatus(orgId, found.id, refund, 'webhook');
  return 'ok';
}
