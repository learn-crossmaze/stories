import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { type CallContext, command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { inOrder } from '../core/reads.js';
import { id, reason } from '../core/schemas.js';
import { addMonths } from '../core/time.js';
import { loadMember } from '../members/members.js';
import type { Member } from '../members/model.js';
import { balanceOf, depositRef, postLedger } from './ledger.js';
import { cancelAtGateway, markRequestsCancelled, readOpenRequests } from './requests.js';
import { DURATIONS, type Duration, planOptions, type Plan, priceFor } from './plans.js';
import { currentTerm } from './term.js';
import { quoteSchema, startUpgrade, upgradeProblem, upgradeQuote, upgradeSchema } from './upgrade.js';
import { dateIN } from '../messaging/outbox.js';
import { queueWhatsApp, rupeesText } from '../messaging/whatsapp.js';

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

const METHODS = ['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_CARD', 'OFFLINE_BANK_TRANSFER'] as const;

/** A payment taken at the counter: cash, or UPI / card / bank transfer with its reference number. */
const counterPayment = z
  .strictObject({ method: z.enum(METHODS), amountMinor: z.number().int().min(0), reference: z.string().trim().max(60).default('') })
  .refine((p) => p.method === 'OFFLINE_CASH' || p.reference.length >= 4, 'needs the UPI/card/bank reference number');
type CounterPayment = z.infer<typeof counterPayment>;

/**
 * Staff only (subscriptions-create): with `payment`, the plan is sold and paid
 * for in one step. Members (me-subscribe) keep `createSchema`, which refuses the field.
 */
export const staffCreateSchema = createSchema.extend({ payment: counterPayment.optional() });

const exactly = (totalMinor: number) => errors.invalid(`The amount must be exactly ₹${(totalMinor / 100).toFixed(2)}.`);

/**
 * Shared by staff (subscriptions-create) and members buying their own plan
 * (me-subscribe): `authorize` decides who may act for the member.
 *
 * With `payment` (staff at the counter; `authorize` has checked they may take
 * payments) nothing waits for payment: the subscription is created already
 * active and the payment and deposit are recorded in this transaction, exactly
 * as payments-recordOffline would. The amount must equal what is due.
 */
export async function startSubscription(
  { actor, input, requestId }: CallContext<z.infer<typeof createSchema>>,
  tx: Transaction,
  authorize: (member: Member) => Promise<void>,
  payment?: CounterPayment,
) {
    const { snap: memberSnap, member } = await loadMember(tx, input.orgId, input.memberId);
    await authorize(member);
    if (member.status !== 'ACTIVE') throw errors.conflict('MEMBER_INACTIVE', 'Reactivate the membership first.');
    // Read together; the checks below keep the order they had when these were read one by one.
    const [planSnap, pending, term, deposit] = await inOrder([
      tx.get(db.doc(`orgs/${input.orgId}/plans/${input.planId}`)),
      tx.get(db.collection(`orgs/${input.orgId}/subscriptions`).where('memberId', '==', input.memberId).where('status', '==', 'PENDING_PAYMENT').limit(1)),
      currentTerm(tx, input.orgId, member),
      tx.get(depositRef(input.orgId, input.memberId)),
    ]);
    if (!planSnap.exists || planSnap.get('status') !== 'ACTIVE') throw errors.notFound('Active plan');
    const plan = planSnap.data() as Plan;
    if (!plan.audiences.includes(member.audience)) {
      throw errors.conflict('PLAN_NOT_ELIGIBLE', `${plan.name} isn't available for ${member.audience.toLowerCase()} members.`);
    }
    if (!pending.empty) throw errors.conflict('PENDING_EXISTS', 'This member already has a subscription waiting for payment. Record or cancel it first.');
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
    // A CLOSED account (settled and refunded earlier) opens again when this subscription is paid.
    if (deposit.exists && deposit.get('status') === 'SETTLING') {
      throw errors.conflict('DEPOSIT_SETTLING', 'The deposit is being settled; finish the settlement before subscribing again.');
    }

    const options = planOptions(plan);
    const duration = input.duration ?? (options.length === 1 ? options[0].duration : undefined);
    if (!duration) throw errors.invalid('Choose how often to pay: this plan has several billing options.');
    const quote = priceFor(plan, duration);
    const price = quote.priceMinor;
    const depositDue = Math.max(0, plan.depositMinor - balanceOf(deposit));
    if (payment && payment.amountMinor !== price + depositDue) throw exactly(price + depositDue);
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
    const created = { ...sub, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() };
    if (!payment) {
      tx.create(ref, { ...created, updatedAt: FieldValue.serverTimestamp() });
      if (term?.rollover) tx.update(memberSnap.ref, term.rollover);
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'subscription.create', entityType: 'subscription', entityId: ref.id, branchId: member.homeBranchId, memberId: input.memberId,
      after: { memberId: input.memberId, planId: input.planId, planVersion: plan.version, duration, kind, discountMinor: quote.discountMinor, amountDue: sub.amountDue },
    });
    if (!payment) return { subscriptionId: ref.id, amountDue: sub.amountDue };

    // Paid at the counter: one write per document (the subscription is created active; the settlement's
    // member update carries the rollover), with the same payment, ledger, message and audit entry as a later payment.
    const paid = writeSettlement(
      tx,
      {
        orgId: input.orgId, subscriptionId: ref.id, subRef: ref, branchId: member.homeBranchId, due: sub.amountDue,
        kind, months: quote.months, planName: plan.name, upgrade: null,
        memberId: input.memberId, memberSnap, member, deposit, term,
      },
      { method: payment.method, reference: payment.reference || null },
      { uid: actor.uid, email: actor.email },
      requestId,
      created,
    );
    return { subscriptionId: ref.id, amountDue: sub.amountDue, paymentId: paid.paymentId, startAt: paid.start.toISOString(), endAt: paid.end.toISOString() };
}

/**
 * Staff start a subscription for a member. With `payment` they also take the
 * counter payment in the same step (and must be allowed to record payments).
 */
export const create = command('subscriptions-create', staffCreateSchema, ({ input: { payment, ...input }, ...ctx }, tx) =>
  startSubscription(
    { ...ctx, input },
    tx,
    async (member) => {
      await ctx.actor.require('subscriptions.manage', input.orgId, member.homeBranchId, tx);
      if (payment) await ctx.actor.require('payments.recordOffline', input.orgId, member.homeBranchId, tx);
    },
    payment,
  ),
);

/** What upgrading the member's current plan would cost today, for every eligible plan (D7). */
export const upgradeQuoteForStaff = query('subscriptions-upgradeQuote', quoteSchema, (ctx) =>
  upgradeQuote(ctx, (member) => ctx.actor.require('subscriptions.manage', ctx.input.orgId, member.homeBranchId)),
);

/** Starts a pro-rated upgrade, waiting for payment like any new plan. */
export const upgrade = command('subscriptions-upgrade', upgradeSchema, (ctx, tx) =>
  startUpgrade(ctx, tx, (member) => ctx.actor.require('subscriptions.manage', ctx.input.orgId, member.homeBranchId, tx)),
);

export const cancelSchema = z.strictObject({ orgId: id, subscriptionId: id, reason });

/**
 * Cancels an unpaid subscription (staff, or the member it belongs to via
 * me-cancelPending). Its open payment links / QR codes are cancelled in the
 * same transaction (and at Razorpay after the commit, see `afterCancel`), so
 * a link already sent can't activate it later.
 */
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
    const open = await readOpenRequests(tx, input.orgId, [input.subscriptionId]);
    tx.update(ref, { status: 'CANCELLED', updatedAt: FieldValue.serverTimestamp() });
    markRequestsCancelled(tx, open, actor.uid, 'Subscription cancelled');
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'subscription.cancel', entityType: 'subscription', entityId: input.subscriptionId, branchId: snap.get('branchId'), memberId: snap.get('memberId'),
      before: { status: 'PENDING_PAYMENT' }, after: { status: 'CANCELLED', paymentRequestsCancelled: open.map((r) => r.id) }, reason: input.reason,
    });
    return { subscriptionId: input.subscriptionId, cancelledRequestIds: open.map((r) => r.id) };
}

/** After cancelling: closes the cancelled payment requests at Razorpay (best effort). */
export const afterCancel = (r: { cancelledRequestIds?: string[] }, ctx: { input: { orgId: string } }) => cancelAtGateway(ctx.input.orgId, r.cancelledRequestIds ?? []);

export const cancelPending = command(
  'subscriptions-cancelPending',
  cancelSchema,
  (ctx, tx) => cancelPendingSubscription(ctx, tx, (sub) => ctx.actor.require('subscriptions.manage', ctx.input.orgId, sub.get('branchId'), tx)),
  afterCancel,
);

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
    const blocked = settlementProblem(s);
    if (blocked) throw errors.conflict('CANNOT_ACTIVATE', `${blocked} The payment can't be taken now.`);
    const stale = upgradeProblem(s.subSnap, s.term?.snap.id ?? null);
    if (stale) throw errors.conflict('UPGRADE_STALE', stale);
    if (input.amountMinor !== s.due.totalMinor) throw exactly(s.due.totalMinor);
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
  const [deposit, term] = await inOrder([tx.get(depositRef(orgId, memberId)), currentTerm(tx, orgId, member)]);
  return {
    orgId,
    subscriptionId,
    subRef,
    subSnap,
    status: subSnap.get('status') as string,
    branchId: subSnap.get('branchId') as string,
    due: subSnap.get('amountDue') as { subscriptionMinor: number; depositMinor: number; totalMinor: number },
    kind: subSnap.get('kind') as 'NEW' | 'RENEWAL' | 'UPGRADE',
    months: subSnap.get('planSnapshot.months') as number,
    planName: subSnap.get('planSnapshot.name') as string,
    upgrade: (subSnap.get('upgrade') ?? null) as { fromSubscriptionId: string; creditMinor: number; unusedDays: number } | null,
    memberId,
    memberSnap,
    member,
    deposit,
    term,
  };
}

type Settlement = Awaited<ReturnType<typeof readSettlement>>;

/**
 * Why a pending subscription can't be activated now (besides the amount and
 * upgrade checks), or null: the membership is suspended or closed, or the
 * deposit is being settled. A counter payment is refused; money that arrives
 * online is recorded for finance (NEEDS_ATTENTION) instead.
 */
export function settlementProblem(s: Settlement): string | null {
  if (s.member.status !== 'ACTIVE') return `The membership is ${s.member.status.toLowerCase()}.`;
  if (s.deposit.exists && s.deposit.get('status') === 'SETTLING') return 'The deposit is being settled.';
  return null;
}

export interface SettlementPayment {
  method: string;
  reference: string | null;
  /** Online payments: provider ids, for reconciliation. */
  gateway?: { provider: 'razorpay'; requestId: string; paymentId: string; channel: string };
}

/**
 * Records the payment, activates the subscription and collects the deposit
 * into the ledger (writes only; the caller has checked it is pending, the
 * amount matches and `settlementProblem` is clear). A CLOSED deposit account
 * opens again. A renewal paid before the current term ends starts when
 * it ends (no gap, no overlap — D6). An upgrade starts now and ends the term
 * it replaces today (D7; the caller has checked upgradeProblem).
 *
 * With `newSubscription` (a plan sold and paid for in one step, see
 * startSubscription) the subscription document is created here, already
 * active, instead of a pending one being updated.
 */
export function writeSettlement(
  tx: Transaction,
  s: Omit<Settlement, 'subSnap' | 'status'>,
  payment: SettlementPayment,
  actor: { uid: string; email: string | null },
  requestId: string | undefined,
  newSubscription?: Record<string, unknown>,
) {
  const { orgId, subscriptionId, branchId, due, kind, months, planName, upgrade, memberId, member, memberSnap, deposit, term } = s;
  const now = new Date();
  const upgrading = kind === 'UPGRADE' && upgrade && term && term.snap.id === upgrade.fromSubscriptionId;
  const startsLater = kind === 'RENEWAL' && term && term.snap.id !== subscriptionId;
  const start = startsLater ? term!.snap.get('endAt').toDate() : now;
  const end = addMonths(start, months);

  const payRef = db.collection(`orgs/${orgId}/payments`).doc();
  tx.create(payRef, {
    memberId,
    memberCode: member.code,
    branchId,
    subscriptionId,
    purpose: 'SUBSCRIPTION',
    direction: 'IN',
    ...(upgrading ? { upgrade: { fromSubscriptionId: term!.snap.id, creditMinor: upgrade.creditMinor, unusedDays: upgrade.unusedDays } } : {}),
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
  const activation = {
    status: 'ACTIVE',
    startAt: Timestamp.fromDate(start),
    endAt: Timestamp.fromDate(end),
    paymentId: payRef.id,
    activatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (newSubscription) tx.create(s.subRef, { ...newSubscription, ...activation });
  else tx.update(s.subRef, activation);
  if (upgrading) {
    // The replaced term ends now; its unused days were credited in this payment.
    tx.update(term!.snap.ref, {
      status: 'UPGRADED', endedAt: Timestamp.fromDate(now), upgradedToSubscriptionId: subscriptionId, updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const memberChanges: Record<string, unknown> = term?.rollover ? { ...term.rollover } : {};
  // Member list: the plan paid for last and the date to renew by (a pre-paid renewal pushes it out).
  Object.assign(memberChanges, { planName, renewalDueAt: Timestamp.fromDate(end) });
  if (startsLater) memberChanges.nextSubscriptionId = subscriptionId;
  else Object.assign(memberChanges, { activeSubscriptionId: subscriptionId, subscriptionEndsAt: Timestamp.fromDate(end), nextSubscriptionId: null });
  tx.update(memberSnap.ref, { ...memberChanges, updatedAt: FieldValue.serverTimestamp() });
  if (due.depositMinor > 0) {
    postLedger(tx, orgId, deposit, {
      memberId, branchId, type: 'DEPOSIT_COLLECTED', deltaMinor: due.depositMinor, reason: 'Security deposit collected with subscription',
      reference: { paymentId: payRef.id, subscriptionId }, actorUid: actor.uid,
    });
  }
  // A member coming back after their deposit was settled: the account opens again.
  const reopened = deposit.exists && deposit.get('status') === 'CLOSED';
  if (reopened) tx.update(deposit.ref, { status: 'OPEN', reopenedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  queueWhatsApp(tx, {
    orgId, branchId, event: upgrading ? 'plan_upgraded' : 'subscription_active', memberId,
    vars: { plan_name: planName, amount: rupeesText(due.totalMinor), valid_until: dateIN(end) },
    ref: { subscriptionId, paymentId: payRef.id },
  });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
    action: payment.gateway ? 'payment.online' : 'payment.recordOffline', entityType: 'subscription', entityId: subscriptionId, branchId, memberId,
    // (sold and paid in one step: it never waited for payment)
    before: newSubscription ? null : { status: 'PENDING_PAYMENT' },
    after: {
      status: 'ACTIVE', paymentId: payRef.id, amountMinor: due.totalMinor, method: payment.method, reference: payment.reference,
      startAt: start.toISOString(), endAt: end.toISOString(), ...(upgrading ? { upgradedFrom: term!.snap.id } : {}),
      ...(reopened ? { depositReopened: true } : {}),
    },
  });
  return { paymentId: payRef.id, start, end };
}
