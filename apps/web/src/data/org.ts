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
  Timestamp,
  where,
} from 'firebase/firestore';

import type { Role } from '../generated/rbac';
import { services } from './services';

export type OrgType = 'CORPORATE' | 'FRANCHISE';
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface Org {
  id: string;
  name: string;
  type: OrgType;
  status: 'ACTIVE' | 'SUSPENDED';
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
}

export interface AuditEntry {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
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
  return snap.docs
    .map((d) => d.data() as StaffMembership)
    .sort((a, b) => (a.displayName ?? a.email ?? '').localeCompare(b.displayName ?? b.email ?? ''));
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
    return { ...data, id: d.id, at: data.at instanceof Timestamp ? data.at.toDate() : null } as AuditEntry;
  });
  return { entries, cursor: snap.docs.length === AUDIT_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : undefined };
}
