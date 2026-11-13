// Members, the member list and its renewal filters.
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
  Timestamp,
  where,
} from 'firebase/firestore';

import { call } from './api';
import { AgeGroup, db, Page, page, withId } from './common';
import type { DeliveryAddress } from './delivery';

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
  /** Where the last home delivery was booked to (with landmark and map pin): prefills the next booking. */
  deliveryAddress?: DeliveryAddress | null;
  homeBranchId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  guardian: { memberId: string; name: string; relationship: string } | null;
  /** Last four digits; the full Aadhaar number is only on the server (members-revealAadhaar). */
  aadhaarLast4?: string | null;
  /** The member asked not to get WhatsApp messages (replied STOP, or staff turned them off). */
  whatsappOptOut?: boolean;
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
  /** What search matches: the words of the name, member code and mobile number, and the starts of each (written by the server). */
  searchTokens?: string[];
}

/** The longest start of a word the server indexes (functions/src/catalogue/search.ts). */
const WORD_MAX = 12;
const SEARCH_LIMIT = 50;
/** Only what a mobile number is typed with: digits, spaces, dashes, brackets and a plus. */
const PHONE_LIKE = /^[+\d\s()-]+$/;

/**
 * The words a member search must match, longest first. A mobile number is one
 * word however it is typed ("98765 43210", "+91 98765 43210", "09876543210"):
 * numbers are indexed without the country code. Anything else is split into
 * words the way the server indexes them; one-letter pieces (the "M" of
 * "KOR-M000123") are not indexed and are ignored.
 */
export function memberQueryWords(q: string): string[] {
  if (PHONE_LIKE.test(q)) {
    let digits = q.replace(/\D/g, '');
    // "+91…" is always the country code; without the plus, 91 is one only when a whole number follows it
    // (mobile numbers themselves can start with 91).
    if (/^\+91/.test(q.replace(/[\s()-]/g, '')) || (!q.includes('+') && digits.length > 10 && digits.startsWith('91'))) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return digits.length >= 2 ? [digits.slice(0, WORD_MAX)] : [];
  }
  return wordsOf(q);
}

/** A query split into words the way the server indexes them, longest first. */
function wordsOf(q: string): string[] {
  const words = q
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length >= 2)
    .map((w) => w.slice(0, WORD_MAX));
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/**
 * Every way a query can be read, each as the words a member must match. Digits and dashes alone are a mobile
 * number, and may just as well be a member code where a branch numbers its members that way ("2026-000123",
 * indexed as "2026" and "000123"): both are searched. A plus sign or brackets can only be a mobile number.
 */
export function memberQueryReadings(q: string): string[][] {
  const phone = memberQueryWords(q);
  const readings = PHONE_LIKE.test(q) && !/[+()]/.test(q) ? [phone, wordsOf(q)] : [phone];
  return readings.filter((words, n) => words.length > 0 && readings.findIndex((other) => other.join(' ') === words.join(' ')) === n);
}

/** The members matching every typed word: the one whose member code was typed in full first, then by name. */
export function narrowMembers<M extends Pick<Member, 'code' | 'fullName' | 'searchTokens'>>(rows: M[], q: string): M[] {
  const readings = memberQueryReadings(q);
  const code = q.trim().toUpperCase();
  return rows
    .filter((m) => readings.some((words) => words.every((w) => m.searchTokens?.includes(w))))
    .sort((a, b) => Number(b.code === code) - Number(a.code === code) || a.fullName.localeCompare(b.fullName));
}

/** Member search by name, member code or mobile number within a branch: every typed word must match. */
export async function searchMembers(orgId: string, branchId: string, q: string): Promise<Member[]> {
  const asked = new Map<string, Promise<Member[]>>();
  // Each word is asked for once, also when two readings of the query share it.
  const find = (word: string) => {
    const known = asked.get(word);
    if (known) return known;
    const rows = getDocs(
      query(collection(db(), `orgs/${orgId}/members`), where('homeBranchId', '==', branchId), where('searchTokens', 'array-contains', word), limit(SEARCH_LIMIT)),
    ).then((snap) => snap.docs.map((d) => withId<Member>(d)));
    asked.set(word, rows);
    return rows;
  };
  // Nearly always one reading; digits with dashes are looked up as a mobile number and as a member code at once.
  const found = await Promise.all(
    memberQueryReadings(q).map(async (words) => {
      // The database matches one word; the rest narrow what it returns.
      const rows = await find(words[0]);
      // A full page for a common word (a surname) may have left the member out: ask by the next word as well.
      return rows.length === SEARCH_LIMIT && words.length > 1 ? [...rows, ...(await find(words[1]))] : rows;
    }),
  );
  const byId = new Map(found.flat().map((m) => [m.id, m]));
  return narrowMembers([...byId.values()], q);
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

/** "Renewal due": the paid term ends from now up to RENEWAL_DUE_DAYS ahead. One place, so the list, its chip, the Dashboard and the menu count the same members. */
const dueSoon = ({ now, soon }: ReturnType<typeof renewalWindow>): QueryConstraint[] => [where('renewalDueAt', '>=', now), where('renewalDueAt', '<=', soon)];

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
  const due = renewalWindow();
  const { now } = due;
  const c: QueryConstraint[] = [where('homeBranchId', '==', branchId)];
  if (f.status) c.push(where('status', '==', f.status));
  if (f.audience) c.push(where('audience', '==', f.audience));
  if (f.renewal === 'ACTIVE') c.push(where('renewalDueAt', '>=', now), orderBy('renewalDueAt'));
  else if (f.renewal === 'DUE') c.push(...dueSoon(due), orderBy('renewalDueAt'));
  else if (f.renewal === 'EXPIRED') c.push(where('renewalDueAt', '<', now), orderBy('renewalDueAt', 'desc'));
  else if (f.renewal === 'NONE') c.push(where('renewalDueAt', '==', null), orderBy('fullName'));
  else c.push(orderBy('fullName'));
  return page<Member>(`orgs/${orgId}/members`, c, 50, after);
}

/** Member counts per subscription bucket at a branch (count queries: one read per 1000 members). */
export async function memberCounts(orgId: string, branchId: string): Promise<Record<'ALL' | Exclude<RenewalFilter, ''>, number>> {
  const due = renewalWindow();
  const { now } = due;
  const base = collection(db(), `orgs/${orgId}/members`);
  const at = where('homeBranchId', '==', branchId);
  const count = async (...c: QueryConstraint[]) => (await getCountFromServer(query(base, at, ...c))).data().count;
  const [ALL, ACTIVE, DUE, EXPIRED, NONE] = await Promise.all([
    count(),
    count(where('renewalDueAt', '>=', now)),
    count(...dueSoon(due)),
    count(where('renewalDueAt', '<', now)),
    count(where('renewalDueAt', '==', null)),
  ]);
  return { ALL, ACTIVE, DUE, EXPIRED, NONE };
}

/** How many members at a branch have a renewal due (the menu's count; the same members as the "Renewal due" chip). */
export async function renewalsDueCount(orgId: string, branchId: string): Promise<number> {
  const q = query(collection(db(), `orgs/${orgId}/members`), where('homeBranchId', '==', branchId), ...dueSoon(renewalWindow()));
  return (await getCountFromServer(q)).data().count;
}

/**
 * Fills plan and renewal date on members registered before the member list had them (once per branch).
 * Gives how many members were gone through: 0 when the branch had been done before.
 */
export async function indexMemberList(orgId: string, branchId: string): Promise<number> {
  return (await call<{ updated: number }>('members-indexList', { orgId, branchId })).updated;
}

export async function getMember(orgId: string, memberId: string): Promise<Member | null> {
  const s = await getDoc(doc(db(), `orgs/${orgId}/members/${memberId}`));
  return s.exists() ? withId<Member>(s) : null;
}

export async function wardsOf(orgId: string, branchId: string, guardianId: string): Promise<Member[]> {
  const snap = await getDocs(
    query(collection(db(), `orgs/${orgId}/members`), where('homeBranchId', '==', branchId), where('guardian.memberId', '==', guardianId), limit(20)),
  );
  return snap.docs.map((d) => withId<Member>(d));
}
