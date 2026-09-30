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
import { AgeGroup, db, Page, page, queryToken, withId } from './common';

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
  /** Last four digits; the full Aadhaar number is only on the server (members-revealAadhaar). */
  aadhaarLast4?: string | null;
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
  await call('members-indexList', { orgId, branchId });
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
