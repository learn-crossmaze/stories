// Plans, subscriptions, payments and the deposit ledger.
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { AgeGroup, db, Duration, Scope, scoped, withId } from './common';

export interface Plan {
  id: string;
  name: string;
  description: string;
  duration: Duration;
  priceMinor: number;
  depositMinor: number;
  maxSimultaneousBooks: number;
  audiences: AgeGroup[];
  deliveryEligible: boolean;
  promo: { priceMinor: number; from: string; to: string } | null;
  renewalWindowDays: number;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
}

export interface Subscription {
  id: string;
  memberId: string;
  planId: string;
  planVersion: number;
  planSnapshot: { name: string; duration: Duration; months: number; priceMinor: number; depositMinor: number; maxSimultaneousBooks: number };
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
  subscriptionId: string | null;
  purpose: string;
  direction: 'IN' | 'OUT';
  lines: { type: string; amountMinor: number }[];
  amountMinor: number;
  method: string;
  reference: string | null;
  status: string;
  at: unknown;
}

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
