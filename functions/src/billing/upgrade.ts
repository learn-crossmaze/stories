import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { type CallContext } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { addMonths, dateKeyIST } from '../core/time.js';
import { loadMember } from '../members/members.js';
import type { Member } from '../members/model.js';
import { balanceOf, depositRef } from './ledger.js';
import { DURATIONS, type Duration, type Plan, pricesFor } from './plans.js';
import { currentTerm } from './term.js';

const DAY = 86_400_000;

/**
 * Upgrading mid-term (docs/BUSINESS_RULES.md D7, docs/SUBSCRIPTIONS.md): the new plan starts today
 * for its full billing period, and the days left on the current term are
 * credited against its price.
 *
 *   credit   = current term's price × unused days ÷ days in the term (whole rupees, rounded down)
 *   plan fee = new plan's price today − credit
 *   deposit  = new plan's deposit − deposit already held (never negative)
 *
 * An upgrade must give more books at a time, or as many for a longer billing
 * period, and must cost more than the credit (anything else is a change to
 * make at renewal). The price holds until the end of the
 * next day in India; after that the unpaid upgrade lapses and a fresh quote is
 * needed, so the credit always reflects the days actually left.
 */
export interface CurrentTermInfo {
  subscriptionId: string;
  planId: string;
  planName: string;
  duration: Duration | null;
  maxSimultaneousBooks: number;
  priceMinor: number;
  startAt: string;
  endAt: string;
  termDays: number;
  unusedDays: number;
  creditMinor: number;
}

export interface UpgradeOption {
  planId: string;
  planName: string;
  duration: Duration;
  months: number;
  maxSimultaneousBooks: number;
  deliveryEligible: boolean;
  listPriceMinor: number;
  discountMinor: number;
  discountLabel: string | null;
  priceMinor: number;
  creditMinor: number;
  subscriptionMinor: number;
  depositMinor: number;
  totalMinor: number;
  startAt: string;
  endAt: string;
}

export interface UpgradeQuote {
  /** Why no upgrade is possible right now (null = see `options`). */
  blocked: string | null;
  current: CurrentTermInfo | null;
  options: UpgradeOption[];
  validUntil: string;
}

/** The last moment a quote made at `now` can be paid: end of the next day in India. */
export function quoteValidUntil(now: Date): Date {
  const [y, m, d] = dateKeyIST(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 2) - 330 * 60_000 - 1);
}

/** Unused value of a term: whole days left (today counts as used) × daily price, in whole rupees. */
export function prorate(priceMinor: number, startAt: Date, endAt: Date, now: Date) {
  const termDays = Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / DAY));
  const unusedDays = Math.min(termDays, Math.max(0, Math.floor((endAt.getTime() - now.getTime()) / DAY)));
  const creditMinor = Math.floor((priceMinor * unusedDays) / termDays / 100) * 100;
  return { termDays, unusedDays, creditMinor };
}

/** Reads outside a transaction, for a quote (nothing is written, so no locks are needed). */
const direct = { get: ((ref: FirebaseFirestore.DocumentReference | FirebaseFirestore.Query) => ref.get()) as Transaction['get'] };

/** Everything an upgrade quote reads (in a transaction: call before any writes). */
async function readUpgrade(tx: Pick<Transaction, 'get'>, orgId: string, memberId: string) {
  const { snap: memberSnap, member } = await loadMember(tx, orgId, memberId);
  const term = await currentTerm(tx, orgId, member);
  const [plans, pending, deposit] = await Promise.all([
    tx.get(db.collection(`orgs/${orgId}/plans`).where('status', '==', 'ACTIVE')),
    tx.get(db.collection(`orgs/${orgId}/subscriptions`).where('memberId', '==', memberId).where('status', '==', 'PENDING_PAYMENT').limit(1)),
    tx.get(depositRef(orgId, memberId)),
  ]);
  return { memberSnap, member, term, plans, pending: pending.docs[0] ?? null, deposit };
}

type UpgradeReads = Awaited<ReturnType<typeof readUpgrade>>;

/** An unpaid upgrade whose price has lapsed (it is cancelled when a new quote is taken). */
const lapsedUpgrade = (pending: UpgradeReads['pending'], now: Date) =>
  !!pending && pending.get('kind') === 'UPGRADE' && (pending.get('upgrade.validUntil') as Timestamp).toMillis() < now.getTime();

function quote(r: UpgradeReads, now: Date): UpgradeQuote {
  const validUntil = quoteValidUntil(now).toISOString();
  const none = (blocked: string, current: CurrentTermInfo | null = null): UpgradeQuote => ({ blocked, current, options: [], validUntil });
  const { member, term } = r;
  if (member.status !== 'ACTIVE') return none('The membership is not active.');
  if (!term) return none('There is no active plan to upgrade. Choose a plan instead.');
  const snap = term.snap;
  const start = (snap.get('startAt') as Timestamp).toDate();
  const end = (snap.get('endAt') as Timestamp).toDate();
  const priceMinor = (snap.get('planSnapshot.priceMinor') as number | undefined) ?? 0;
  const p = prorate(priceMinor, start, end, now);
  const current: CurrentTermInfo = {
    subscriptionId: snap.id,
    planId: snap.get('planId'),
    planName: snap.get('planSnapshot.name'),
    duration: (snap.get('planSnapshot.duration') as Duration | undefined) ?? null,
    maxSimultaneousBooks: term.max,
    priceMinor,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    ...p,
  };
  if (member.nextSubscriptionId && !term.rollover) return none('The next term is already paid for. Upgrade once it has started.', current);
  if (r.pending && !lapsedUpgrade(r.pending, now)) return none('A plan is waiting for payment. Take the payment or cancel it first.', current);
  if (r.deposit.exists && r.deposit.get('status') !== 'OPEN') return none('The deposit is being settled.', current);
  if (p.unusedDays < 1) return none('The current term ends today. Renew instead.', current);

  const held = balanceOf(r.deposit);
  const currentMonths = (snap.get('planSnapshot.months') as number | undefined) ?? 1;
  const options: UpgradeOption[] = [];
  for (const doc of r.plans.docs) {
    const plan = doc.data() as Plan;
    if (!plan.audiences.includes(member.audience) || plan.maxSimultaneousBooks < term.max) continue;
    for (const price of pricesFor(plan, now)) {
      if (doc.id === current.planId && price.duration === current.duration) continue;
      // Same number of books: only a longer billing period is an upgrade.
      if (plan.maxSimultaneousBooks === term.max && DURATIONS[price.duration] <= currentMonths) continue;
      if (price.priceMinor <= p.creditMinor) continue;
      const subscriptionMinor = price.priceMinor - p.creditMinor;
      const depositMinor = Math.max(0, plan.depositMinor - held);
      options.push({
        planId: doc.id,
        planName: plan.name,
        duration: price.duration,
        months: DURATIONS[price.duration],
        maxSimultaneousBooks: plan.maxSimultaneousBooks,
        deliveryEligible: plan.deliveryEligible,
        listPriceMinor: price.listPriceMinor,
        discountMinor: price.discountMinor,
        discountLabel: price.discountLabel,
        priceMinor: price.priceMinor,
        creditMinor: p.creditMinor,
        subscriptionMinor,
        depositMinor,
        totalMinor: subscriptionMinor + depositMinor,
        startAt: now.toISOString(),
        endAt: addMonths(now, DURATIONS[price.duration]).toISOString(),
      });
    }
  }
  options.sort((a, b) => a.maxSimultaneousBooks - b.maxSimultaneousBooks || a.months - b.months || a.totalMinor - b.totalMinor);
  return { blocked: options.length ? null : 'No plan offers more than the current one for this member.', current, options, validUntil };
}

export const quoteSchema = z.strictObject({ orgId: id, memberId: id });

/** Upgrade prices for every eligible plan and billing option (staff: subscriptions-upgradeQuote; members: me-upgradeQuote). */
export async function upgradeQuote(
  { input }: CallContext<z.infer<typeof quoteSchema>>,
  authorize: (member: Member) => Promise<void>,
): Promise<UpgradeQuote> {
  const r = await readUpgrade(direct, input.orgId, input.memberId);
  await authorize(r.member);
  return quote(r, new Date());
}

export const upgradeSchema = z.strictObject({
  orgId: id,
  memberId: id,
  planId: id,
  duration: z.enum(Object.keys(DURATIONS) as [Duration, ...Duration[]]),
});

/**
 * Creates the upgrade as a subscription waiting for payment, with the
 * pro-rata breakdown stored on it. Paying it (at the counter or online)
 * ends the current term today and starts the new one (writeSettlement).
 */
export async function startUpgrade(
  { actor, input, requestId }: CallContext<z.infer<typeof upgradeSchema>>,
  tx: Transaction,
  authorize: (member: Member) => Promise<void>,
) {
  const now = new Date();
  const r = await readUpgrade(tx, input.orgId, input.memberId);
  await authorize(r.member);
  const q = quote(r, now);
  if (q.blocked) throw errors.conflict('UPGRADE_NOT_POSSIBLE', q.blocked);
  const o = q.options.find((x) => x.planId === input.planId && x.duration === input.duration);
  if (!o) throw errors.conflict('NOT_AN_UPGRADE', 'That plan is not an upgrade for this member (it must allow at least as many books and cost more than the credit for the days left).');
  const plan = r.plans.docs.find((d) => d.id === input.planId)!.data() as Plan;
  const cur = q.current!;

  if (r.pending) {
    // A lapsed upgrade quote gives way to the new one.
    tx.update(r.pending.ref, { status: 'CANCELLED', cancelReason: 'Upgrade price lapsed', updatedAt: FieldValue.serverTimestamp() });
  }
  const ref = db.collection(`orgs/${input.orgId}/subscriptions`).doc();
  const amountDue = { subscriptionMinor: o.subscriptionMinor, depositMinor: o.depositMinor, totalMinor: o.totalMinor };
  const upgrade = {
    fromSubscriptionId: cur.subscriptionId,
    fromPlanName: cur.planName,
    fromDuration: cur.duration,
    fromPriceMinor: cur.priceMinor,
    fromEndAt: Timestamp.fromDate(new Date(cur.endAt)),
    termDays: cur.termDays,
    unusedDays: cur.unusedDays,
    creditMinor: cur.creditMinor,
    newPriceMinor: o.priceMinor,
    quotedAt: Timestamp.fromDate(now),
    validUntil: Timestamp.fromDate(new Date(q.validUntil)),
  };
  tx.create(ref, {
    memberId: input.memberId,
    memberCode: r.member.code,
    memberName: r.member.fullName,
    branchId: r.member.homeBranchId,
    planId: input.planId,
    planVersion: plan.version,
    planSnapshot: {
      name: plan.name,
      duration: o.duration,
      months: o.months,
      priceMinor: o.priceMinor,
      listPriceMinor: o.listPriceMinor,
      discountMinor: o.discountMinor,
      discountLabel: o.discountLabel,
      depositMinor: plan.depositMinor,
      maxSimultaneousBooks: plan.maxSimultaneousBooks,
      deliveryEligible: plan.deliveryEligible,
    },
    kind: 'UPGRADE',
    previousSubscriptionId: cur.subscriptionId,
    upgrade,
    status: 'PENDING_PAYMENT',
    amountDue,
    startAt: null,
    endAt: null,
    paymentId: null,
    exchangesThisTerm: 0,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (r.term?.rollover) tx.update(r.memberSnap.ref, r.term.rollover);
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'subscription.upgrade', entityType: 'subscription', entityId: ref.id, branchId: r.member.homeBranchId, memberId: input.memberId,
    after: {
      from: { subscriptionId: cur.subscriptionId, planName: cur.planName, unusedDays: cur.unusedDays, termDays: cur.termDays, creditMinor: cur.creditMinor },
      to: { planId: input.planId, planVersion: plan.version, duration: o.duration, priceMinor: o.priceMinor },
      amountDue,
    },
  });
  return { subscriptionId: ref.id, amountDue, upgrade: { ...upgrade, fromEndAt: cur.endAt, quotedAt: now.toISOString(), validUntil: q.validUntil } };
}

/**
 * Why an unpaid upgrade can't be settled now, or null. Checked when a payment
 * is recorded or requested, and when an online payment arrives (payment links
 * for an upgrade close when its price lapses).
 */
export function upgradeProblem(sub: FirebaseFirestore.DocumentSnapshot, termId: string | null, now: Date | null = new Date()): string | null {
  if (sub.get('kind') !== 'UPGRADE') return null;
  if (termId !== sub.get('upgrade.fromSubscriptionId')) return 'The plan being upgraded is no longer the current one.';
  // (null: an online payment that was made while its link was open, whenever it is applied)
  if (now && (sub.get('upgrade.validUntil') as Timestamp).toMillis() < now.getTime()) {
    return 'This upgrade price has lapsed. Cancel it and take a fresh quote (the credit for the days left has changed).';
  }
  return null;
}
