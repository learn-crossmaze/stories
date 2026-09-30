// Physical copies, their events and shelf locations.
import { collection, doc, type DocumentSnapshot, getCountFromServer, getDoc, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { call, command, toApiError } from './api';
import { searchBooks } from './catalogue';
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

/**
 * Copies at the branch whose title matches a word typed (the catalogue's title
 * search), ordered by title then copy code.
 */
export async function searchCopiesByTitle(orgId: string, branchId: string, q: string): Promise<Copy[]> {
  const books = (await searchBooks(q, '')).items;
  const ids = books.map((b) => b.id);
  const found: Copy[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(
      query(collection(db(), `orgs/${orgId}/copies`), where('currentBranchId', '==', branchId), where('bookId', 'in', ids.slice(i, i + 30)), limit(300)),
    );
    found.push(...snap.docs.map((d) => withId<Copy>(d)));
  }
  return found.sort((a, b) => a.bookTitle.localeCompare(b.bookTitle) || a.code.localeCompare(b.code));
}

/**
 * Copies on the floor but not on a shelf: new stock received without a shelf,
 * and returned books that passed inspection (functions/src/inventory/shelve.ts).
 */
const unshelvedAt = (orgId: string, branchId: string) =>
  query(collection(db(), `orgs/${orgId}/copies`), where('currentBranchId', '==', branchId), where('status', '==', 'AVAILABLE'), where('locationId', '==', null));

export const UNSHELVED_PAGE = 300;

export async function unshelvedCopies(orgId: string, branchId: string): Promise<Copy[]> {
  const snap = await getDocs(query(unshelvedAt(orgId, branchId), orderBy('code'), limit(UNSHELVED_PAGE)));
  return snap.docs.map((d) => withId<Copy>(d));
}

export async function unshelvedCount(orgId: string, branchId: string): Promise<number> {
  return (await getCountFromServer(unshelvedAt(orgId, branchId))).data().count;
}

/** Copies per call to copies-shelve. */
export const SHELVE_BATCH = 100;

/** Puts copies on one shelf, a batch at a time; returns how many moved. */
export async function shelveCopies(orgId: string, branchId: string, locationId: string, copyIds: string[]): Promise<number> {
  let shelved = 0;
  for (let i = 0; i < copyIds.length; i += SHELVE_BATCH) {
    const res = await command<{ shelved: number }>('copies-shelve', { orgId, branchId, locationId, copyIds: copyIds.slice(i, i + SHELVE_BATCH) });
    shelved += res.shelved;
  }
  return shelved;
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
  const res = await call<{ books: Record<string, BranchStock[]> }>('copies-availabilityMany', { orgId, bookIds });
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
    return call<CopyWhereabouts>('copies-locate', { orgId, code: scanned.trim() });
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
