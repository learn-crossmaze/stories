// Physical copies, their events and shelf locations.
import { collection, doc, type DocumentSnapshot, getDoc, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { services } from './services';
import { callAction, toApiError } from './api';
import { Condition, CopyStatus, db, page, withId } from './common';

export interface Copy {
  id: string;
  code: string;
  barcode: string;
  bookId: string;
  bookCode: string;
  bookTitle: string;
  owningBranchId: string;
  currentBranchId: string;
  locationId: string | null;
  status: CopyStatus;
  condition: Condition;
  acquisitionCostMinor: number;
  activeLoanId: string | null;
  activeReservationId: string | null;
  lifetimeLoans: number;
}

export interface CopyEvent {
  id: string;
  type: string;
  fromStatus: CopyStatus | null;
  toStatus: CopyStatus;
  condition: string;
  note: string | null;
  actorUid: string;
  ref: Record<string, string> | null;
  at: unknown;
}

export interface Location {
  id: string;
  code: string;
  label: string;
  kind: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export const COPY_PAGE = 50;

export function listCopies(orgId: string, branchId: string, status: CopyStatus | '', after?: DocumentSnapshot) {
  const c: QueryConstraint[] = [where('currentBranchId', '==', branchId)];
  if (status) c.push(where('status', '==', status));
  c.push(orderBy('code'));
  return page<Copy>(`orgs/${orgId}/copies`, c, COPY_PAGE, after);
}

export async function copiesOfBook(orgId: string, branchId: string, bookId: string): Promise<Copy[]> {
  const snap = await getDocs(
    query(collection(db(), `orgs/${orgId}/copies`), where('currentBranchId', '==', branchId), where('bookId', '==', bookId), orderBy('code'), limit(200)),
  );
  return snap.docs.map((d) => withId<Copy>(d));
}

/** Finds a scanned copy at the branch (barcode or code). */
export async function findCopy(orgId: string, branchId: string, scanned: string): Promise<Copy | null> {
  const value = scanned.trim().toUpperCase();
  for (const field of ['barcode', 'code']) {
    const snap = await getDocs(query(collection(db(), `orgs/${orgId}/copies`), where('currentBranchId', '==', branchId), where(field, '==', value), limit(1)));
    if (!snap.empty) return withId<Copy>(snap.docs[0]);
  }
  return null;
}

/** In-stock and on-the-shelf copies of a title at one branch (functions/src/inventory/copies.ts). */
export interface BranchStock {
  branchId: string;
  branchName: string;
  available: number;
  total: number;
}

/** Which branches hold each title (counts only, so staff see every branch). */
export async function stockByBranch(orgId: string, bookIds: string[]): Promise<Record<string, BranchStock[]>> {
  if (!bookIds.length) return {};
  const res = await callAction<{ books: Record<string, BranchStock[]> }>(services().fns, 'copies-availabilityMany', { orgId, bookIds });
  return res.books;
}

/** Where a copy is, found anywhere in the organization (for copies held at other branches). */
export interface CopyWhereabouts {
  copyId: string;
  code: string;
  bookId: string;
  bookTitle: string;
  status: CopyStatus;
  currentBranchId: string;
  currentBranchName: string;
  owningBranchName: string;
  /** The caller works at the holding or owning branch, so the copy page opens. */
  canOpen: boolean;
}

export async function locateCopy(orgId: string, scanned: string): Promise<CopyWhereabouts | null> {
  try {
    return await callAction<CopyWhereabouts>(services().fns, 'copies-locate', { orgId, code: scanned.trim() });
  } catch (e) {
    if (toApiError(e).reason === 'NOT_FOUND') return null;
    throw e;
  }
}

export async function getCopy(orgId: string, copyId: string): Promise<Copy | null> {
  const s = await getDoc(doc(db(), `orgs/${orgId}/copies/${copyId}`));
  return s.exists() ? withId<Copy>(s) : null;
}

export async function copyEvents(orgId: string, copyId: string): Promise<CopyEvent[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/copies/${copyId}/events`), orderBy('at', 'desc'), limit(100)));
  return snap.docs.map((d) => withId<CopyEvent>(d));
}

export async function listLocations(orgId: string, branchId: string): Promise<Location[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/branches/${branchId}/locations`), orderBy('code')));
  return snap.docs.map((d) => withId<Location>(d));
}
