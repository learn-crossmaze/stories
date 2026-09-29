import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { type CallContext, command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { addMonths } from '../core/time.js';
import { loadMember } from '../members/members.js';
import type { Member } from '../members/model.js';
import { balanceOf, depositRef, postLedger } from './ledger.js';
import { DURATIONS, type Duration, planOptions, type Plan, priceFor } from './plans.js';
import { currentTerm } from './term.js';

/**
 * Starts a subscription (or a renewal) awaiting payment. Stores a snapshot of
 * the plan terms and the amounts due; the deposit due is only the top-up the
 * current deposit balance doesn't already cover.
 */
export const createSchema = z.strictObject({
  orgId: id,
  memberId: id,
  planId: id,
  /** Billing option (monthly, quarterly…); may be left out when the plan has only one. */
  duration: z.enum(Object.keys(DURATIONS) as [Duration, ...Duration[]]).optional(),
});

/**
 * Shared by staff (subscriptions-create) and members buying their own plan
 * (me-subscribe): `authorize` decides who may act for the member.
 */
export async function startSubscription(
  { actor, input, requestId }: CallContext<z.infer<typeof createSchema>>,
  tx: Transaction,
  authorize: (member: Member) => Promise<void>,
) {
    const { snap: memberSnap, member } = await loadMember(tx, input.orgId, input.memberId);
    await authorize(member);
    if (member.status !== 'ACTIVE') throw errors.conflict('MEMBER_INACTIVE', 'Reactivate the membership first.');
    const planSnap = await tx.get(db.doc(`orgs/${input.orgId}/plans/${input.planId}`));
    if (!planSnap.exists || planSnap.get('status') !== 'ACTIVE') throw errors.notFound('Active plan');
    const plan = planSnap.data() as Plan;
    if (!plan.audiences.includes(member.audience)) {
      throw errors.conflict('PLAN_NOT_ELIGIBLE', `${plan.name} isn't available for ${member.audience.toLowerCase()} members.`);
    }
    const pending = await tx.get(
      db.collection(`orgs/${input.orgId}/subscriptions`).where('memberId', '==', input.memberId).where('status', '==', 'PENDING_PAYMENT').limit(1),
    );
    if (!pending.empty) throw errors.conflict('PENDING_EXISTS', 'This member already has a subscription waiting for payment. Record or cancel it first.');
    const term = await currentTerm(tx, input.orgId, member);
    if (member.nextSubscriptionId && term?.rollover === null) {
      throw errors.conflict('RENEWAL_EXISTS', 'This member has already renewed for the next term.');
    }
    let kind: 'NEW' | 'RENEWAL' = 'NEW';
    if (term) {
      const daysLeft = (term.snap.get('endAt').toMillis() - Date.now()) / 86_400_000;
      if (daysLeft > plan.renewalWindowDays) {
        throw errors.conflict('TOO_EARLY', `Renewal opens ${plan.renewalWindowDays} days before the current term ends.`);
      }
      kind = 'RENEWAL';
    }
    const deposit = await tx.get(depositRef(input.orgId, input.memberId));
    if (deposit.exists && deposit.get('status') !== 'OPEN') {
      throw errors.conflict('DEPOSIT_SETTLING', 'The deposit is being settled; finish the settlement before subscribing again.');
    }

    const options = planOptions(plan);
    const duration = input.duration ?? (options.length === 1 ? options[0].duration : undefined);
    if (!duration) throw errors.invalid('Choose how often to pay: this plan has several billing options.');
    const quote = priceFor(plan, duration);
    const price = quote.priceMinor;
    const depositDue = Math.max(0, plan.depositMinor - balanceOf(deposit));
    const ref = db.collection(`orgs/${input.orgId}/subscriptions`).doc();
    const sub = {
      memberId: input.memberId,
      memberCode: member.code,
      memberName: member.fullName,
      branchId: member.homeBranchId,
      planId: input.planId,
      planVersion: plan.version,
      planSnapshot: {
        name: plan.name,
        duration,
        months: quote.months,
        priceMinor: price,
        listPriceMinor: quote.listPriceMinor,
        discountMinor: quote.discountMinor,
        discountLabel: quote.discountLabel,
        depositMinor: plan.depositMinor,
        maxSimultaneousBooks: plan.maxSimultaneousBooks,
        deliveryEligible: plan.deliveryEligible,
      },
      kind,
      previousSubscriptionId: term ? term.snap.id : null,
      status: 'PENDING_PAYMENT',
      amountDue: { subscriptionMinor: price, depositMinor: depositDue, totalMinor: price + depositDue },
      startAt: null,
      endAt: null,
      paymentId: null,
      exchangesThisTerm: 0,
    };
    tx.create(ref, { ...sub, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (term?.rollover) tx.update(memberSnap.ref, term.rollover);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'subscription.create', entityType: 'subscription', entityId: ref.id, branchId: member.homeBranchId, memberId: input.memberId,
      after: { memberId: input.memberId, planId: input.planId, planVersion: plan.version, duration, kind, discountMinor: quote.discountMinor, amountDue: sub.amountDue },
    });
    return { subscriptionId: ref.id, amountDue: sub.amountDue };
}

export const create = command('subscriptions-create', createSchema, (ctx, tx) =>
  startSubscription(ctx, tx, (member) => ctx.actor.require('subscriptions.manage', ctx.input.orgId, member.homeBranchId, tx)),
);

export const cancelSchema = z.strictObject({ orgId: id, subscriptionId: id, reason });

/** Cancels an unpaid subscription (staff, or the member it belongs to via me-cancelPending). */
export async function cancelPendingSubscription(
  { actor, input, requestId }: CallContext<z.infer<typeof cancelSchema>>,
  tx: Transaction,
  authorize: (subscription: FirebaseFirestore.DocumentSnapshot) => Promise<void>,
) {
    const ref = db.doc(`orgs/${input.orgId}/subscriptions/${input.subscriptionId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Subscription');
    await authorize(snap);
    if (snap.get('status') !== 'PENDING_PAYMENT') throw errors.conflict('NOT_PENDING', 'Only unpaid subscriptions can be cancelled here.');
    tx.update(ref, { status: 'CANCELLED', updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'subscription.cancel', entityType: 'subscription', entityId: input.subscriptionId, branchId: snap.get('branchId'), memberId: snap.get('memberId'),
      before: { status: 'PENDING_PAYMENT' }, after: { status: 'CANCELLED' }, reason: input.reason,
    });
    return { subscriptionId: input.subscriptionId };
}

export const cancelPending = command('subscriptions-cancelPending', cancelSchema, (ctx, tx) =>
  cancelPendingSubscription(ctx, tx, (sub) => ctx.actor.require('subscriptions.manage', ctx.input.orgId, sub.get('branchId'), tx)),
);

const METHODS = ['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_CARD', 'OFFLINE_BANK_TRANSFER'] as const;

/**
 * Records a counter payment (BUSINESS_RULES D1) and, in the same transaction,
 * activates the subscription and collects the deposit into the ledger. The
 * amount must match what is due. A retried call (same requestId) replays;
 * a second payment for an already-active subscription is rejected.
 */
export const recordOfflinePayment = command(
  'payments-recordOffline',
  z
    .strictObject({
      orgId: id,
      subscriptionId: id,
      method: z.enum(METHODS),
      amountMinor: z.number().int().min(0),
      reference: z.string().trim().max(60).default(''),
    })
    .refine((p) => p.method === 'OFFLINE_CASH' || p.reference.length >= 4, 'needs the UPI/card/bank reference number'),
  async ({ actor, input, requestId }, tx) => {
    const s = await readSettlement(tx, input.orgId, input.subscriptionId);
    await actor.require('payments.recordOffline', input.orgId, s.branchId, tx);
    if (s.status !== 'PENDING_PAYMENT') {
      throw errors.conflict('NOT_PENDING', 'This subscription is not waiting for payment (it may already be paid).');
    }
    if (input.amountMinor !== s.due.totalMinor) {
      throw errors.invalid(`The amount must be exactly ₹${(s.due.totalMinor / 100).toFixed(2)}.`);
    }
    const r = writeSettlement(tx, s, { method: input.method, reference: input.reference || null }, { uid: actor.uid, email: actor.email }, requestId);
    return { paymentId: r.paymentId, startAt: r.start.toISOString(), endAt: r.end.toISOString() };
  },
);

/** Everything settling a subscription needs to read (call before any writes in the transaction). */
export async function readSettlement(tx: Transaction, orgId: string, subscriptionId: string) {
  const subRef = db.doc(`orgs/${orgId}/subscriptions/${subscriptionId}`);
  const subSnap = await tx.get(subRef);
  if (!subSnap.exists) throw errors.notFound('Subscription');
  const memberId = subSnap.get('memberId') as string;
  const { snap: memberSnap, member } = await loadMember(tx, orgId, memberId);
  const deposit = await tx.get(depositRef(orgId, memberId));
  const term = await currentTerm(tx, orgId, member);
  return {
    orgId,
    subscriptionId,
    subRef,
    subSnap,
    status: subSnap.get('status') as string,
    branchId: subSnap.get('branchId') as string,
    due: subSnap.get('amountDue') as { subscriptionMinor: number; depositMinor: number; totalMinor: number },
    memberId,
    memberSnap,
    member,
    deposit,
    term,
  };
}

export interface SettlementPayment {
  method: string;
  reference: string | null;
  /** Online payments: provider ids, for reconciliation. */
  gateway?: { provider: 'razorpay'; requestId: string; paymentId: string; channel: string };
}

/**
 * Records the payment, activates the subscription and collects the deposit
 * into the ledger (writes only; the caller has checked it is pending and the
 * amount matches). A renewal paid before the current term ends starts when
 * it ends (no gap, no overlap — D6).
 */
export function writeSettlement(
  tx: Transaction,
  s: Awaited<ReturnType<typeof readSettlement>>,
  payment: SettlementPayment,
  actor: { uid: string; email: string | null },
  requestId: string | undefined,
) {
  const { orgId, subscriptionId, subSnap, branchId, due, memberId, member, memberSnap, deposit, term } = s;
  const now = new Date();
  const startsLater = subSnap.get('kind') === 'RENEWAL' && term && term.snap.id !== subSnap.id;
  const start = startsLater ? term!.snap.get('endAt').toDate() : now;
  const end = addMonths(start, subSnap.get('planSnapshot.months'));

  const payRef = db.collection(`orgs/${orgId}/payments`).doc();
  tx.create(payRef, {
    memberId,
    memberCode: member.code,
    branchId,
    subscriptionId,
    purpose: 'SUBSCRIPTION',
    direction: 'IN',
    lines: [
      { type: 'SUBSCRIPTION', amountMinor: due.subscriptionMinor },
      ...(due.depositMinor > 0 ? [{ type: 'DEPOSIT', amountMinor: due.depositMinor }] : []),
    ],
    amountMinor: due.totalMinor,
    currency: 'INR',
    method: payment.method,
    reference: payment.reference,
    gateway: payment.gateway ?? null,
    status: 'SUCCESS',
    recordedBy: actor.uid,
    at: FieldValue.serverTimestamp(),
  });
  tx.update(s.subRef, {
    status: 'ACTIVE',
    startAt: Timestamp.fromDate(start),
    endAt: Timestamp.fromDate(end),
    paymentId: payRef.id,
    activatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const memberChanges: Record<string, unknown> = term?.rollover ? { ...term.rollover } : {};
  // Member list: the plan paid for last and the date to renew by (a pre-paid renewal pushes it out).
  Object.assign(memberChanges, { planName: subSnap.get('planSnapshot.name'), renewalDueAt: Timestamp.fromDate(end) });
  if (startsLater) memberChanges.nextSubscriptionId = subscriptionId;
  else Object.assign(memberChanges, { activeSubscriptionId: subscriptionId, subscriptionEndsAt: Timestamp.fromDate(end), nextSubscriptionId: null });
  tx.update(memberSnap.ref, { ...memberChanges, updatedAt: FieldValue.serverTimestamp() });
  if (due.depositMinor > 0) {
    postLedger(tx, orgId, deposit, {
      memberId, branchId, type: 'DEPOSIT_COLLECTED', deltaMinor: due.depositMinor, reason: 'Security deposit collected with subscription',
      reference: { paymentId: payRef.id, subscriptionId }, actorUid: actor.uid,
    });
  }
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
    action: payment.gateway ? 'payment.online' : 'payment.recordOffline', entityType: 'subscription', entityId: subscriptionId, branchId, memberId,
    before: { status: 'PENDING_PAYMENT' },
    after: {
      status: 'ACTIVE', paymentId: payRef.id, amountMinor: due.totalMinor, method: payment.method, reference: payment.reference,
      startAt: start.toISOString(), endAt: end.toISOString(),
    },
  });
  return { paymentId: payRef.id, start, end };
}
