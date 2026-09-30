// Plans, subscriptions, payments and the deposit ledger.
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { call } from './api';
import { AgeGroup, db, Duration, DURATIONS, Scope, scoped, withId } from './common';
import { todayIST } from '../shared/dates';

export interface PlanOption {
  duration: Duration;
  priceMinor: number;
}

/** A promotional discount: an amount off (paise) or a percentage off, in a date window, on all options or some. */
export interface Discount {
  type: 'AMOUNT' | 'PERCENT';
  value: number;
  from: string;
  to: string;
  durations: Duration[];
  label: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  /** Billing options (older plans have `duration` and `priceMinor` instead). */
  options?: PlanOption[];
  discount?: Discount | null;
  duration?: Duration;
  priceMinor?: number;
  promo?: { priceMinor: number; from: string; to: string } | null;
  depositMinor: number;
  maxSimultaneousBooks: number;
  audiences: AgeGroup[];
  deliveryEligible: boolean;
  renewalWindowDays: number;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
}

/** A plan's billing options, shortest first. Mirrors functions/src/billing/plans.ts. */
export function planOptions(plan: Pick<Plan, 'options' | 'duration' | 'priceMinor'>): PlanOption[] {
  const list = plan.options?.length ? plan.options : plan.duration ? [{ duration: plan.duration, priceMinor: plan.priceMinor ?? 0 }] : [];
  return [...list].sort((a, b) => DURATIONS[a.duration] - DURATIONS[b.duration]);
}

export interface Price {
  duration: Duration;
  months: number;
  listPriceMinor: number;
  discountMinor: number;
  priceMinor: number;
  discountLabel: string | null;
}

/** Today's price of one option (the server charges the same). */
export function priceFor(plan: Plan, duration: Duration, now = new Date()): Price {
  const opt = planOptions(plan).find((o) => o.duration === duration)!;
  const list = opt.priceMinor;
  const today = todayIST(now);
  const d = plan.discount;
  let off = 0;
  let label: string | null = null;
  if (d && today >= d.from && today <= d.to && (!d.durations.length || d.durations.includes(duration))) {
    off = d.type === 'AMOUNT' ? d.value : Math.round((list * d.value) / 100 / 100) * 100;
    label = d.label || (d.type === 'PERCENT' ? `${d.value}% off` : `Rs. ${(d.value / 100).toLocaleString('en-IN')} off`);
  } else if (!d && plan.promo && today >= plan.promo.from && today <= plan.promo.to) {
    off = list - plan.promo.priceMinor;
    label = 'Offer price';
  }
  off = Math.max(0, Math.min(off, list));
  return { duration, months: DURATIONS[duration], listPriceMinor: list, discountMinor: off, priceMinor: list - off, discountLabel: off ? label : null };
}
export const pricesFor = (plan: Plan) => planOptions(plan).map((o) => priceFor(plan, o.duration));

export interface Subscription {
  id: string;
  memberId: string;
  planId: string;
  planVersion: number;
  planSnapshot: { name: string; duration: Duration; months: number; priceMinor: number; listPriceMinor?: number; discountMinor?: number; discountLabel?: string | null; depositMinor: number; maxSimultaneousBooks: number };
  kind: 'NEW' | 'RENEWAL';
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  amountDue: { subscriptionMinor: number; depositMinor: number; totalMinor: number };
  startAt: unknown;
  endAt: unknown;
  exchangesThisTerm: number;
}

export interface LedgerEntry {
  id: string;
  type: string;
  deltaMinor: number;
  balanceAfterMinor: number;
  reason: string;
  at: unknown;
}

export interface Adjustment {
  id: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  branchId: string;
  kind: 'DEDUCTION' | 'ADJUSTMENT';
  deltaMinor: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  proposedBy: string;
  proposedByEmail: string | null;
  createdAt: unknown;
}

export async function listPlans(orgId: string): Promise<Plan[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/plans`), orderBy('name')));
  return snap.docs.map((d) => withId<Plan>(d));
}

export async function memberSubscriptions(orgId: string, memberId: string, scope: Scope): Promise<Subscription[]> {
  const snap = await getDocs(
    query(
      collection(db(), `orgs/${orgId}/subscriptions`),
      where('memberId', '==', memberId),
      ...scoped('branchId', scope),
      orderBy('createdAt', 'desc'),
      limit(20),
    ),
  );
  return snap.docs.map((d) => withId<Subscription>(d));
}

export interface Payment {
  id: string;
  memberId: string;
  memberCode: string | null;
  memberName?: string | null;
  branchId: string;
  subscriptionId: string | null;
  purpose: string;
  direction: 'IN' | 'OUT';
  lines: { type: string; amountMinor: number }[];
  amountMinor: number;
  method: string;
  reference: string | null;
  /** SUCCESS, NEEDS_ATTENTION (money that couldn't be applied); refunds: PROCESSING, PENDING, SUCCESS, FAILED. */
  status: string;
  note?: string | null;
  /** Online payments: Razorpay ids. */
  gateway?: { provider: string; paymentId: string; refundId?: string | null; speed?: string } | null;
  /** Received payments: refunded so far (refunds in progress count). */
  refundedMinor?: number;
  refundedDepositMinor?: number;
  /** Refunds: the payment refunded, why, and the deposit part. */
  refundOf?: string;
  reason?: string;
  depositMinor?: number;
  failure?: string | null;
  recordedByEmail?: string | null;
  at: unknown;
}

/** What is left to refund on a received payment. */
export const refundable = (p: Payment) =>
  p.direction === 'IN' && ['SUCCESS', 'NEEDS_ATTENTION'].includes(p.status) ? p.amountMinor - (p.refundedMinor ?? 0) : 0;
/** Deposit a payment collected and hasn't refunded yet. */
export const depositLeft = (p: Payment) => p.lines.filter((l) => l.type === 'DEPOSIT').reduce((n, l) => n + l.amountMinor, 0) - (p.refundedDepositMinor ?? 0);

export type PaymentView = 'RECEIVED' | 'ATTENTION' | 'REFUNDS';

/** A branch's latest payments: received, flagged for attention, or refunds. */
export async function branchPayments(orgId: string, branchId: string, view: PaymentView): Promise<Payment[]> {
  const col = collection(db(), `orgs/${orgId}/payments`);
  const at = where('branchId', '==', branchId);
  const q =
    view === 'REFUNDS'
      ? query(col, at, where('purpose', '==', 'REFUND'), orderBy('at', 'desc'), limit(50))
      : view === 'ATTENTION'
        ? query(col, at, where('status', '==', 'NEEDS_ATTENTION'), orderBy('at', 'desc'), limit(50))
        : query(col, at, orderBy('at', 'desc'), limit(100));
  const list = (await getDocs(q)).docs.map((d) => withId<Payment>(d));
  return view === 'RECEIVED' ? list.filter((p) => p.direction === 'IN') : list;
}

export interface RefundInput {
  orgId: string;
  paymentId: string;
  amountMinor: number;
  depositMinor: number;
  method: 'RAZORPAY' | 'OFFLINE_CASH' | 'OFFLINE_UPI' | 'OFFLINE_BANK_TRANSFER';
  reference: string;
  speed: 'normal' | 'optimum';
  reason: string;
}
export interface RefundResult {
  refundId: string;
  status: string;
  amountMinor: number;
  method: string;
  gatewayRefundId: string | null;
}
/** Refunds (part of) a payment; a retry with the same requestId never refunds twice. */
export const refundPayment = (input: RefundInput, requestId: string) => call<RefundResult>('payments-refund', { ...input, requestId });
export const checkRefund = (orgId: string, refundId: string) => call<RefundResult>('payments-checkRefund', { orgId, refundId });

export async function memberPayments(orgId: string, memberId: string, scope: Scope): Promise<Payment[]> {
  const snap = await getDocs(
    query(collection(db(), `orgs/${orgId}/payments`), where('memberId', '==', memberId), ...scoped('branchId', scope), orderBy('at', 'desc'), limit(30)),
  );
  return snap.docs.map((d) => withId<Payment>(d));
}

export async function depositAccount(orgId: string, memberId: string) {
  const s = await getDoc(doc(db(), `orgs/${orgId}/depositAccounts/${memberId}`));
  return s.exists() ? (s.data() as { balanceMinor: number; status: 'OPEN' | 'SETTLING' | 'CLOSED' }) : null;
}

export async function ledger(orgId: string, memberId: string): Promise<LedgerEntry[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/depositAccounts/${memberId}/transactions`), orderBy('at', 'desc'), limit(50)));
  return snap.docs.map((d) => withId<LedgerEntry>(d));
}

export async function memberAdjustments(orgId: string, memberId: string, scope: Scope): Promise<Adjustment[]> {
  const snap = await getDocs(
    query(
      collection(db(), `orgs/${orgId}/depositAdjustments`),
      where('memberId', '==', memberId),
      ...scoped('branchId', scope),
      orderBy('createdAt', 'desc'),
      limit(20),
    ),
  );
  return snap.docs.map((d) => withId<Adjustment>(d));
}

export async function pendingAdjustments(orgId: string, scope: Scope): Promise<Adjustment[]> {
  const snap = await getDocs(
    query(
      collection(db(), `orgs/${orgId}/depositAdjustments`),
      where('status', '==', 'PENDING'),
      ...scoped('branchId', scope),
      orderBy('createdAt', 'asc'),
      limit(100),
    ),
  );
  return snap.docs.map((d) => withId<Adjustment>(d));
}
