import {
  collection,
  collectionGroup,
  doc,
  type DocumentSnapshot,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  startAfter,
  where,
} from 'firebase/firestore';

import type { Role } from '../generated/rbac';
import { toDate } from './common';
import { services } from './services';

export type OrgType = 'CORPORATE' | 'FRANCHISE';
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface Org {
  id: string;
  name: string;
  type: OrgType;
  status: 'ACTIVE' | 'SUSPENDED';
  /** Head-office numbering (staff without a branch): employee ID pattern and the code {BRANCH} stands for. */
  numbering?: { employee?: string | null } | null;
  headOfficeCode?: string | null;
}

export interface Address {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  type: 'COMPANY_OWNED' | 'FRANCHISE';
  status: 'ACTIVE' | 'ARCHIVED';
  address: Address;
  contact: { phone: string; email: string };
  operatingHours: { day: Weekday; open: string; close: string }[];
  weeklyOffs: Weekday[];
  /** Set once the member list fields were filled for this branch's older members. */
  memberListIndexedAt?: unknown;
  /** Numbering pattern overrides for codes created at this branch. */
  numbering?: Partial<Record<'copy' | 'member' | 'location' | 'employee', string>>;
  /** Online payment gateway (secrets are never stored here). */
  payments?: {
    razorpay?: { enabled: boolean; keyId: string; mode: 'test' | 'live'; notifySms: boolean; notifyEmail: boolean; hasWebhookSecret: boolean };
  };
}

export interface Department {
  id: string;
  name: string;
  branchId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface StaffMembership {
  uid: string;
  orgId: string;
  email: string | null;
  displayName: string | null;
  roles: Role[];
  branchIds: string[];
  status: 'ACTIVE' | 'REVOKED';
  employeeId?: string | null;
}

export interface AuditEntry {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
  memberId?: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  at: Date | null;
}

const withId = <T>(snap: DocumentSnapshot) => ({ id: snap.id, ...snap.data() }) as T;

/** Super Admin: every organization. */
export async function listAllOrgs(): Promise<Org[]> {
  const snap = await getDocs(query(collection(services().db, 'orgs'), orderBy('name'), limit(200)));
  return snap.docs.map((d) => withId<Org>(d));
}

/** Organizations the user holds a role in (rules allow reading each). */
export async function getOrgs(ids: string[]): Promise<Org[]> {
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(services().db, `orgs/${id}`))));
  return snaps.filter((s) => s.exists()).map((s) => withId<Org>(s));
}

export async function listBranches(orgId: string): Promise<Branch[]> {
  const snap = await getDocs(query(collection(services().db, `orgs/${orgId}/branches`), orderBy('code')));
  return snap.docs.map((d) => withId<Branch>(d));
}

export async function getBranch(orgId: string, branchId: string): Promise<Branch | null> {
  const snap = await getDoc(doc(services().db, `orgs/${orgId}/branches/${branchId}`));
  return snap.exists() ? withId<Branch>(snap) : null;
}

export async function listDepartments(orgId: string): Promise<Department[]> {
  const snap = await getDocs(query(collection(services().db, `orgs/${orgId}/departments`), orderBy('name')));
  return snap.docs.map((d) => withId<Department>(d));
}

/**
 * Staff with roles in an org. Branch-scoped viewers must filter to their own
 * branches — the security rules only allow that query shape.
 */
export async function listStaff(orgId: string, scope: string[] | 'ALL'): Promise<StaffMembership[]> {
  const filters: QueryConstraint[] = [where('orgId', '==', orgId)];
  if (scope !== 'ALL') filters.push(where('branchIds', 'array-contains-any', scope.slice(0, 10)));
  const snap = await getDocs(query(collectionGroup(services().db, 'memberships'), ...filters, limit(300)));
  return snap.docs.map((d) => d.data() as StaffMembership).sort((a, b) => (a.displayName ?? a.email ?? '').localeCompare(b.displayName ?? b.email ?? ''));
}

export const AUDIT_PAGE_SIZE = 25;

/** One page of the audit log, newest first. Branch-scoped readers pass their branches. */
export async function listAudit(
  orgId: string,
  scope: string[] | 'ALL',
  after?: DocumentSnapshot,
): Promise<{ entries: AuditEntry[]; cursor?: DocumentSnapshot }> {
  const filters: QueryConstraint[] = [];
  if (scope !== 'ALL') filters.push(where('branchId', 'in', scope.slice(0, 10)));
  filters.push(orderBy('at', 'desc'), limit(AUDIT_PAGE_SIZE));
  if (after) filters.push(startAfter(after));
  const snap = await getDocs(query(collection(services().db, `orgs/${orgId}/auditLogs`), ...filters));
  const entries = snap.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, at: toDate(data.at) } as AuditEntry;
  });
  return { entries, cursor: snap.docs.length === AUDIT_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : undefined };
}

/**
 * A member's audit trail, newest first: entries tagged with the member, plus
 * older entries recorded against the member itself (before tagging existed).
 */
export async function memberAudit(orgId: string, memberId: string, scope: string[] | 'ALL'): Promise<AuditEntry[]> {
  const col = collection(services().db, `orgs/${orgId}/auditLogs`);
  const branch: QueryConstraint[] = scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 10))];
  const [tagged, direct] = await Promise.all(
    (['memberId', 'entityId'] as const).map((field) => getDocs(query(col, where(field, '==', memberId), ...branch, orderBy('at', 'desc'), limit(100)))),
  );
  const byId = new Map<string, AuditEntry>();
  for (const d of [...tagged.docs, ...direct.docs]) {
    const data = d.data();
    byId.set(d.id, { ...data, id: d.id, at: toDate(data.at) } as AuditEntry);
  }
  return [...byId.values()].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)).slice(0, 100);
}
