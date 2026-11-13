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
  /** The copy held for the member while ALLOCATED. */
  allocatedCopyId: string | null;
  allocatedCopyCode: string | null;
  holdUntil: unknown;
  queuedAt: unknown;
}

export interface Transfer {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  /** `barcode` and `conditionOut` are missing on transfers made before they were kept. */
  items: { copyId: string; code: string; barcode?: string; bookTitle: string; received: boolean; conditionOut?: string | null; conditionIn: string | null }[];
  itemCount: number;
  note: string | null;
  createdAt: unknown;
}

/** Copies one transfer takes (functions/src/circulation/transfers.ts). */
export const TRANSFER_MAX = 50;

/** What transfers-receive answers: how many went on the shelf picked, and the copies now held for waiting members. */
export interface TransferReceipt {
  transferId: string;
  complete: boolean;
  shelved: number;
  /** The member is named only for staff who may see members at the branch. */
  allocated: { code: string; bookTitle: string; memberName: string | null; memberCode: string | null }[];
}

/** Rows one reservation list reads: a list this long may not be the whole queue. */
export const RESERVATIONS_PAGE = 100;

/** Books one call takes (functions/src/circulation/circulation.ts): to issue, or on either side of an exchange. */
export const ISSUE_MAX = 10;
/** Books one return on its own takes. */
export const RETURN_MAX = 30;

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
      limit(RESERVATIONS_PAGE),
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

const count = async (path: string, ...c: QueryConstraint[]) => (await getCountFromServer(query(collection(db(), path), ...c))).data().count;

/** What waits at a branch: the three counts the menu shows (count queries: cheap, always exact). */
export async function waitingCounts(orgId: string, branchId: string, canDeposits: boolean, scope: Scope) {
  const [inspection, incoming, approvals] = await Promise.all([
    count(`orgs/${orgId}/copies`, where('currentBranchId', '==', branchId), where('status', '==', 'UNDER_INSPECTION')),
    count(`orgs/${orgId}/transfers`, where('toBranchId', '==', branchId), where('status', '==', 'IN_TRANSIT')),
    canDeposits ? count(`orgs/${orgId}/depositAdjustments`, where('status', '==', 'PENDING'), ...scoped('branchId', scope)) : Promise.resolve(0),
  ]);
  return { inspection, incoming, approvals };
}

/** A branch's day so far and its reservations: the numbers only the Dashboard shows. */
export async function todayCounts(orgId: string, branchId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = Timestamp.fromDate(start);
  const [issuedToday, exchangesToday, holds, waiting] = await Promise.all([
    count(`orgs/${orgId}/loans`, where('branchId', '==', branchId), where('issuedAt', '>=', since)),
    count(`orgs/${orgId}/exchanges`, where('branchId', '==', branchId), where('at', '>=', since)),
    count(`orgs/${orgId}/reservations`, where('branchId', '==', branchId), where('status', '==', 'ALLOCATED')),
    count(`orgs/${orgId}/reservations`, where('branchId', '==', branchId), where('status', '==', 'WAITING')),
  ]);
  return { issuedToday, exchangesToday, holds, waiting };
}

/** "What needs doing" counts for a branch: `waitingCounts` and `todayCounts` together. */
export async function branchCounts(orgId: string, branchId: string, canDeposits: boolean, scope: Scope) {
  const [waiting, today] = await Promise.all([waitingCounts(orgId, branchId, canDeposits, scope), todayCounts(orgId, branchId)]);
  return { ...today, ...waiting };
}

/** Catalogue-wide book code pattern, or null for the default. */
