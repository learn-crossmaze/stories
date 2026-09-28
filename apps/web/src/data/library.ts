import {
  collection,
  doc,
  type DocumentSnapshot,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  startAfter,
  Timestamp,
  where,
} from 'firebase/firestore';

import { callAction, toApiError } from './api';
import { services } from './services';

// Vocabularies mirrored from functions/src/catalog/model.ts and copyState.ts.
export const GENRES = ['FICTION', 'FANTASY', 'MYSTERY', 'ADVENTURE', 'SCIENCE', 'BIOGRAPHY', 'SELF_HELP', 'CLASSICS', 'COMICS', 'EDUCATIONAL'] as const;
export const AGE_GROUPS = ['CHILDREN', 'TEENS', 'ADULTS'] as const;
export const READING_LEVELS = ['EARLY_READER', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export const LANGUAGES = { en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', or: 'Odia' } as const;
export const COPY_STATUSES = ['AVAILABLE', 'RESERVED', 'ISSUED', 'IN_TRANSIT', 'UNDER_INSPECTION', 'DAMAGED', 'LOST', 'RETIRED'] as const;
export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export const DURATIONS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 } as const;

export type Genre = (typeof GENRES)[number];
export type AgeGroup = (typeof AGE_GROUPS)[number];
export type CopyStatus = (typeof COPY_STATUSES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Duration = keyof typeof DURATIONS;
export type Scope = string[] | 'ALL';

export const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

// ------------------------------------------------------------------ helpers

const db = () => services().db;
const withId = <T>(s: DocumentSnapshot) => ({ id: s.id, ...s.data() }) as T;
export const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

/** Branch-scoped staff must filter on the branch field the rules check. */
const scoped = (field: string, scope: Scope): QueryConstraint[] => (scope === 'ALL' ? [] : [where(field, 'in', scope.slice(0, 10))]);

/** Same normalization as the server's search tokens (functions/src/catalog/search.ts). */
export function queryToken(q: string): string | null {
  const words = q
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length >= 2);
  if (!words.length) return null;
  return words.sort((a, b) => b.length - a.length)[0].slice(0, 12);
}

export interface Page<T> {
  items: T[];
  cursor?: DocumentSnapshot;
}

async function page<T>(base: string, constraints: QueryConstraint[], size: number, after?: DocumentSnapshot): Promise<Page<T>> {
  const q = query(collection(db(), base), ...constraints, limit(size), ...(after ? [startAfter(after)] : []));
  const snap = await getDocs(q);
  return { items: snap.docs.map((d) => withId<T>(d)), cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1] : undefined };
}

// ------------------------------------------------------------------ catalogue

export interface RefItem {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Book {
  id: string;
  code: string;
  isbn: string | null;
  title: string;
  subtitle: string;
  authorIds: string[];
  authorNames: string[];
  publisherId: string | null;
  publisherName: string | null;
  categoryIds: string[];
  categoryNames: string[];
  language: keyof typeof LANGUAGES;
  genres: Genre[];
  ageGroup: AgeGroup;
  minAge: number | null;
  readingLevel: (typeof READING_LEVELS)[number];
  contentTags: string[];
  synopsis: string;
  edition: string;
  publicationYear: number | null;
  keywords: string[];
  replacementPriceMinor: number;
  status: 'ACTIVE' | 'ARCHIVED';
  coverUrl?: string | null;
}

export async function listRefs(kind: 'authors' | 'publishers' | 'categories'): Promise<RefItem[]> {
  const snap = await getDocs(query(collection(db(), kind), orderBy('nameNormalized'), limit(500)));
  return snap.docs.map((d) => withId<RefItem>(d));
}

export const BOOK_PAGE = 25;

/** Catalogue search: one token (prefix) + optional age group, ordered by title. */
export function searchBooks(q: string, ageGroup: AgeGroup | '', after?: DocumentSnapshot, status: Book['status'] | '' = '') {
  const token = queryToken(q);
  const c: QueryConstraint[] = [];
  if (status) c.push(where('status', '==', status));
  if (token) c.push(where('searchTokens', 'array-contains', token));
  if (ageGroup) c.push(where('ageGroup', '==', ageGroup));
  c.push(orderBy('titleNormalized'));
  return page<Book>('books', c, BOOK_PAGE, after);
}

export async function getBook(id: string): Promise<Book | null> {
  const s = await getDoc(doc(db(), `books/${id}`));
  return s.exists() ? withId<Book>(s) : null;
}

// ------------------------------------------------------------------ inventory

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
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/copies`), where('currentBranchId', '==', branchId), where('bookId', '==', bookId), orderBy('code'), limit(200)));
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

// ------------------------------------------------------------------ members

export interface Member {
  id: string;
  code: string;
  fullName: string;
  dob: string;
  audience: AgeGroup;
  isMinor: boolean;
  phone: string | null;
  email: string | null;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string } | null;
  homeBranchId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  guardian: { memberId: string; name: string; relationship: string } | null;
  activeSubscriptionId: string | null;
  nextSubscriptionId: string | null;
  subscriptionEndsAt: unknown;
  /** Plan of the latest paid term (kept after it expires). */
  planName?: string | null;
  /** End of the latest paid term, including a pre-paid renewal: the date to renew by. */
  renewalDueAt?: unknown;
  activeLoanCount: number;
  allocatedCount: number;
  waitingCount: number;
  lifetimeLoans: number;
  lifetimeExchanges: number;
}

/** Member search by name, member code or phone (one token), within a branch. */
export async function searchMembers(orgId: string, branchId: string, q: string): Promise<Member[]> {
  const token = queryToken(q.replace(/^\+?91/, ''));
  if (!token) return [];
  const snap = await getDocs(
    query(collection(db(), `orgs/${orgId}/members`), where('homeBranchId', '==', branchId), where('searchTokens', 'array-contains', token), limit(20)),
  );
  return snap.docs.map((d) => withId<Member>(d)).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Subscription filter on the member list. */
export type RenewalFilter = '' | 'ACTIVE' | 'DUE' | 'EXPIRED' | 'NONE';
/** "Renewal due" means the paid term ends within this many days. */
export const RENEWAL_DUE_DAYS = 15;

export interface MemberFilters {
  status: Member['status'] | '';
  audience: AgeGroup | '';
  renewal: RenewalFilter;
}

function renewalWindow() {
  return { now: Timestamp.now(), soon: Timestamp.fromMillis(Date.now() + RENEWAL_DUE_DAYS * 86_400_000) };
}

/** Which renewal bucket a member falls in (same rules as the list filters). */
export function renewalState(m: Pick<Member, 'renewalDueAt'>): Exclude<RenewalFilter, ''> {
  const end = m.renewalDueAt as Timestamp | null | undefined;
  if (!end) return 'NONE';
  const left = end.toMillis() - Date.now();
  return left < 0 ? 'EXPIRED' : left <= RENEWAL_DUE_DAYS * 86_400_000 ? 'DUE' : 'ACTIVE';
}

/**
 * The branch's members, 50 at a time: alphabetical, or by renewal date when
 * filtering by subscription (soonest first; most recently lapsed first for expired).
 */
export async function listMembers(orgId: string, branchId: string, f: MemberFilters, after?: DocumentSnapshot): Promise<Page<Member>> {
  const { now, soon } = renewalWindow();
  const c: QueryConstraint[] = [where('homeBranchId', '==', branchId)];
  if (f.status) c.push(where('status', '==', f.status));
  if (f.audience) c.push(where('audience', '==', f.audience));
  if (f.renewal === 'ACTIVE') c.push(where('renewalDueAt', '>=', now), orderBy('renewalDueAt'));
  else if (f.renewal === 'DUE') c.push(where('renewalDueAt', '>=', now), where('renewalDueAt', '<=', soon), orderBy('renewalDueAt'));
  else if (f.renewal === 'EXPIRED') c.push(where('renewalDueAt', '<', now), orderBy('renewalDueAt', 'desc'));
  else if (f.renewal === 'NONE') c.push(where('renewalDueAt', '==', null), orderBy('fullName'));
  else c.push(orderBy('fullName'));
  return page<Member>(`orgs/${orgId}/members`, c, 50, after);
}

/** Member counts per subscription bucket at a branch (count queries: one read per 1000 members). */
export async function memberCounts(orgId: string, branchId: string): Promise<Record<'ALL' | Exclude<RenewalFilter, ''>, number>> {
  const { now, soon } = renewalWindow();
  const base = collection(db(), `orgs/${orgId}/members`);
  const at = where('homeBranchId', '==', branchId);
  const count = async (...c: QueryConstraint[]) => (await getCountFromServer(query(base, at, ...c))).data().count;
  const [ALL, ACTIVE, DUE, EXPIRED, NONE] = await Promise.all([
    count(),
    count(where('renewalDueAt', '>=', now)),
    count(where('renewalDueAt', '>=', now), where('renewalDueAt', '<=', soon)),
    count(where('renewalDueAt', '<', now)),
    count(where('renewalDueAt', '==', null)),
  ]);
  return { ALL, ACTIVE, DUE, EXPIRED, NONE };
}

/** Fills plan and renewal date on members registered before the member list had them (once per branch). */
export async function indexMemberList(orgId: string, branchId: string): Promise<void> {
  await callAction(services().fns, 'members-indexList', { orgId, branchId });
}

export async function getMember(orgId: string, memberId: string): Promise<Member | null> {
  const s = await getDoc(doc(db(), `orgs/${orgId}/members/${memberId}`));
  return s.exists() ? withId<Member>(s) : null;
}

export async function wardsOf(orgId: string, branchId: string, guardianId: string): Promise<Member[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/members`), where('homeBranchId', '==', branchId), where('guardian.memberId', '==', guardianId), limit(20)));
  return snap.docs.map((d) => withId<Member>(d));
}

// ------------------------------------------------------------------ plans, subscriptions, money

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
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/subscriptions`), where('memberId', '==', memberId), ...scoped('branchId', scope), orderBy('createdAt', 'desc'), limit(20)));
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
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/payments`), where('memberId', '==', memberId), ...scoped('branchId', scope), orderBy('at', 'desc'), limit(30)));
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
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/depositAdjustments`), where('memberId', '==', memberId), ...scoped('branchId', scope), orderBy('createdAt', 'desc'), limit(20)));
  return snap.docs.map((d) => withId<Adjustment>(d));
}

export async function pendingAdjustments(orgId: string, scope: Scope): Promise<Adjustment[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/depositAdjustments`), where('status', '==', 'PENDING'), ...scoped('branchId', scope), orderBy('createdAt', 'asc'), limit(100)));
  return snap.docs.map((d) => withId<Adjustment>(d));
}

// ------------------------------------------------------------------ circulation

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
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/reservations`), where('memberId', '==', memberId), ...scoped('branchId', scope), orderBy('queuedAt', 'desc'), limit(20)));
  return snap.docs.map((d) => withId<Reservation>(d));
}

export async function branchReservations(orgId: string, branchId: string, status: Reservation['status']): Promise<Reservation[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/reservations`), where('branchId', '==', branchId), where('status', '==', status), orderBy('queuedAt', 'asc'), limit(100)));
  return snap.docs.map((d) => withId<Reservation>(d));
}

export async function listTransfers(orgId: string, branchId: string, direction: 'out' | 'in'): Promise<Transfer[]> {
  const snap = await getDocs(
    query(collection(db(), `orgs/${orgId}/transfers`), where(direction === 'out' ? 'fromBranchId' : 'toBranchId', '==', branchId), orderBy('createdAt', 'desc'), limit(50)),
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
export async function getBookNumbering(): Promise<string | null> {
  const s = await getDoc(doc(db(), 'config/numbering'));
  return (s.get('book') as string | null | undefined) ?? null;
}
