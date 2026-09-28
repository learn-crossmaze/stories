import { callAction, command } from './api';
import type { AgeGroup, Duration } from './library';
import { services } from './services';

// Member self-service (functions/src/me/me.ts). Dates arrive as ISO strings.

export interface MyPlan {
  id: string;
  name: string;
  description: string;
  duration: Duration;
  priceMinor: number;
  listPriceMinor: number;
  depositMinor: number;
  maxSimultaneousBooks: number;
  deliveryEligible: boolean;
  renewalWindowDays: number;
}

export interface MySubscription {
  id: string;
  kind: 'NEW' | 'RENEWAL';
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  planSnapshot: { name: string; duration: Duration; maxSimultaneousBooks: number; priceMinor: number; depositMinor: number };
  amountDue: { subscriptionMinor: number; depositMinor: number; totalMinor: number };
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
}

export interface MyPayment {
  id: string;
  direction: 'IN' | 'OUT';
  purpose: string;
  lines: { type: string; amountMinor: number }[];
  amountMinor: number;
  method: string;
  reference: string | null;
  status: string;
  at: string;
}

export interface MyLoan {
  id: string;
  bookId: string;
  bookTitle: string;
  copyCode: string;
  status: 'ACTIVE' | 'RETURNED' | 'LOST';
  issuedAt: string;
  returnedAt: string | null;
}

export interface MyReservation {
  id: string;
  bookId: string;
  bookTitle: string;
  branchId: string;
  status: 'WAITING' | 'ALLOCATED' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED';
  holdUntil: string | null;
  queuedAt: string;
}

export interface MyLedgerEntry {
  id: string;
  type: string;
  deltaMinor: number;
  balanceAfterMinor: number;
  reason: string;
  at: string;
}

export interface Membership {
  orgId: string;
  orgName: string;
  memberId: string;
  /** The signed-in person's own membership (false: a child they are guardian for). */
  self: boolean;
  member: {
    code: string;
    fullName: string;
    dob: string;
    audience: AgeGroup;
    isMinor: boolean;
    phone: string | null;
    email: string | null;
    address: { line1: string; line2: string; city: string; state: string; postalCode: string } | null;
    status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
    guardian: { memberId: string; name: string; relationship: string } | null;
    activeSubscriptionId: string | null;
    nextSubscriptionId: string | null;
    subscriptionEndsAt: string | null;
    renewalDueAt: string | null;
    planName: string | null;
    activeLoanCount: number;
    allocatedCount: number;
    waitingCount: number;
    lifetimeLoans: number;
    lifetimeExchanges: number;
  };
  branch: {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string } | null;
    operatingHours: { day: string; open: string; close: string }[];
    onlinePayments: boolean;
  };
  subscriptions: MySubscription[];
  payments: MyPayment[];
  paymentRequests: { id: string; url: string | null; amountMinor: number; expiresAt: string }[];
  loans: MyLoan[];
  reservations: MyReservation[];
  deposit: { balanceMinor: number; status: string } | null;
  ledger: MyLedgerEntry[];
  plans: MyPlan[];
}

export interface Overview {
  linked: number;
  emailVerified: boolean;
  email: string | null;
  memberships: Membership[];
}

export const loadOverview = () => callAction<Overview>(services().fns, 'me-overview', {});

export const subscribeToPlan = (m: Membership, planId: string) =>
  command<{ subscriptionId: string }>('me-subscribe', { orgId: m.orgId, memberId: m.memberId, planId });

export const cancelUnpaid = (m: Membership, subscriptionId: string) => command('me-cancelPending', { orgId: m.orgId, subscriptionId });

/** Opens (or reuses) a Razorpay payment page for an unpaid subscription. */
export const startOnlinePayment = (m: Membership, subscriptionId: string) =>
  callAction<{ url: string | null }>(services().fns, 'me-pay', { orgId: m.orgId, subscriptionId, requestId: crypto.randomUUID() });

export const checkOnlinePayment = (m: Membership, subscriptionId: string) =>
  callAction<{ paid: boolean }>(services().fns, 'me-checkPayment', { orgId: m.orgId, subscriptionId });

export const reserveBook = (m: Membership, bookId: string, branchId: string) =>
  command<{ status: 'ALLOCATED' | 'WAITING' }>('me-reserve', { orgId: m.orgId, memberId: m.memberId, bookId, branchId });

export const cancelMyReservation = (m: Membership, reservationId: string) => command('me-cancelReservation', { orgId: m.orgId, reservationId });

/** The term in force: the active subscription, if its end is still ahead. */
export function currentTerm(m: Membership): MySubscription | null {
  const now = Date.now();
  return m.subscriptions.find((s) => s.status === 'ACTIVE' && s.startAt && s.endAt && Date.parse(s.startAt) <= now && Date.parse(s.endAt) > now) ?? null;
}

export const pendingSubscription = (m: Membership) => m.subscriptions.find((s) => s.status === 'PENDING_PAYMENT') ?? null;
