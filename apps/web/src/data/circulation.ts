// Loans, reservations, transfers and branch counts.
import { collection, getCountFromServer, getDocs, limit, orderBy, query, type QueryConstraint, Timestamp, where } from 'firebase/firestore';

import { db, Scope, scoped, withId } from './common';

export interface Loan {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  copyId: string;
  copyCode: string;
  bookId: string;
  bookTitle: string;
  branchId: string;
  status: 'ACTIVE' | 'RETURNED' | 'LOST';
  issuedAt: unknown;
  returnedAt: unknown;
  exchangeId: string | null;
}

export interface Reservation {
  id: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  bookId: string;
  bookTitle: string;
  branchId: string;
  status: 'WAITING' | 'ALLOCATED' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED';
  allocatedCopyCode: string | null;
  holdUntil: unknown;
  queuedAt: unknown;
}

export interface Transfer {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  items: { copyId: string; code: string; bookTitle: string; received: boolean; conditionIn: string | null }[];
  itemCount: number;
  note: string | null;
  createdAt: unknown;
}

export async function memberLoans(orgId: string, memberId: string, scope: Scope, active: boolean): Promise<Loan[]> {
  const c: QueryConstraint[] = [where('memberId', '==', memberId), ...scoped('branchId', scope)];
  if (active) c.push(where('status', '==', 'ACTIVE'));
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/loans`), ...c, orderBy('issuedAt', 'desc'), limit(active ? 30 : 50)));
  return snap.docs.map((d) => withId<Loan>(d));
}

export async function memberReservations(orgId: string, memberId: string, scope: Scope): Promise<Reservation[]> {
  const snap = await getDocs(
    query(
      collection(db(), `orgs/${orgId}/reservations`),
      where('memberId', '==', memberId),
      ...scoped('branchId', scope),
      orderBy('queuedAt', 'desc'),
      limit(20),
    ),
  );
  return snap.docs.map((d) => withId<Reservation>(d));
}

export async function branchReservations(orgId: string, branchId: string, status: Reservation['status']): Promise<Reservation[]> {
  const snap = await getDocs(
    query(
      collection(db(), `orgs/${orgId}/reservations`),
      where('branchId', '==', branchId),
      where('status', '==', status),
      orderBy('queuedAt', 'asc'),
      limit(100),
    ),
  );
  return snap.docs.map((d) => withId<Reservation>(d));
}

export async function listTransfers(orgId: string, branchId: string, direction: 'out' | 'in'): Promise<Transfer[]> {
  const snap = await getDocs(
    query(
      collection(db(), `orgs/${orgId}/transfers`),
      where(direction === 'out' ? 'fromBranchId' : 'toBranchId', '==', branchId),
      orderBy('createdAt', 'desc'),
      limit(50),
    ),
  );
  return snap.docs.map((d) => withId<Transfer>(d));
}

/** "What needs doing" counts for a branch (count queries: cheap, always exact). */
export async function branchCounts(orgId: string, branchId: string, canDeposits: boolean, scope: Scope) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = Timestamp.fromDate(start);
  const count = async (path: string, ...c: QueryConstraint[]) => (await getCountFromServer(query(collection(db(), path), ...c))).data().count;
  const [issuedToday, exchangesToday, inspection, holds, waiting, incoming, approvals] = await Promise.all([
    count(`orgs/${orgId}/loans`, where('branchId', '==', branchId), where('issuedAt', '>=', since)),
    count(`orgs/${orgId}/exchanges`, where('branchId', '==', branchId), where('at', '>=', since)),
    count(`orgs/${orgId}/copies`, where('currentBranchId', '==', branchId), where('status', '==', 'UNDER_INSPECTION')),
    count(`orgs/${orgId}/reservations`, where('branchId', '==', branchId), where('status', '==', 'ALLOCATED')),
    count(`orgs/${orgId}/reservations`, where('branchId', '==', branchId), where('status', '==', 'WAITING')),
    count(`orgs/${orgId}/transfers`, where('toBranchId', '==', branchId), where('status', '==', 'IN_TRANSIT')),
    canDeposits ? count(`orgs/${orgId}/depositAdjustments`, where('status', '==', 'PENDING'), ...scoped('branchId', scope)) : Promise.resolve(0),
  ]);
  return { issuedToday, exchangesToday, inspection, holds, waiting, incoming, approvals };
}

/** Catalogue-wide book code pattern, or null for the default. */
