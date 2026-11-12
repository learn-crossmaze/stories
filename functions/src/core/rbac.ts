import type { Transaction } from 'firebase-admin/firestore';

import { CORPORATE_ONLY, GRANTABLE, ORG_WIDE, PERMISSIONS, type Permission, ROLES, type Role } from '../generated/rbac.js';
import { db } from './firebase.js';
import { errors } from './errors.js';

export type BranchScope = string[]; // ['*'] = every branch in the org

export interface Membership {
  orgId: string;
  orgName: string;
  orgType: OrgType;
  uid: string;
  email: string | null;
  displayName: string | null;
  /** Ready-made roles (permissions.json). */
  roles: Role[];
  /** Roles of the organization's own (roles/{id}); their permissions are copied into `customPerms` and kept in step. */
  customRoles?: string[];
  customPerms?: Permission[];
  customRoleNames?: string[];
  branchIds: BranchScope;
  status: 'ACTIVE' | 'REVOKED';
  employeeId?: string | null;
}

export type OrgType = 'CORPORATE' | 'FRANCHISE';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  status: 'ACTIVE' | 'DISABLED';
  platformRoles: 'SUPER_ADMIN'[];
  claimsVersion: number;
}

export const ALL_BRANCHES = '*';

export const roleCode = (r: Role) => ROLES[r].code;
export const isOrgWideRole = (r: Role) => ROLES[r]?.scope === 'org';
export const isPlatformRole = (r: Role) => ROLES[r]?.scope === 'platform';

const ORG_WIDE_SET = new Set<string>(ORG_WIDE);

/** Whether the ready-made roles give `perm` (ignoring branch scope; see `permissionsOf`). */
export function rolesGrant(roles: readonly Role[], perm: Permission): boolean {
  const allowed = PERMISSIONS[perm] as readonly string[];
  return roles.some((r) => ROLES[r] && allowed.includes(roleCode(r)));
}

/**
 * Everything a membership allows (docs/RBAC.md §3): its ready-made roles' permissions and its own roles', less the
 * organization-wide ones when the person's access doesn't cover all branches, and head office's (the shared catalogue,
 * the website) outside the corporate organization.
 */
export function permissionsOf(m: Pick<Membership, 'roles' | 'customPerms' | 'branchIds' | 'status'> & { orgType?: OrgType }): Set<Permission> {
  const out = new Set<Permission>();
  if (m.status !== 'ACTIVE') return out;
  const codes = new Set(m.roles.filter((r) => ROLES[r]).map(roleCode) as string[]);
  for (const [perm, list] of Object.entries(PERMISSIONS) as [Permission, readonly string[]][]) {
    if (list.some((c) => codes.has(c))) out.add(perm);
  }
  for (const p of m.customPerms ?? []) if (p in PERMISSIONS) out.add(p);
  if (!m.branchIds.includes(ALL_BRANCHES)) for (const p of ORG_WIDE_SET) out.delete(p as Permission);
  if (m.orgType && m.orgType !== 'CORPORATE') for (const p of CORPORATE_ONLY) out.delete(p);
  return out;
}

/** Whether a membership allows `perm` (anywhere in its branch scope). */
export const holds = (m: Membership, perm: Permission) => permissionsOf(m).has(perm);

export const coversBranch = (scope: BranchScope, branchId: string) =>
  scope.includes(ALL_BRANCHES) || scope.includes(branchId);

/**
 * The calling user, resolved from the *authoritative* Firestore documents
 * (not from token claims, which can lag a revocation by up to an hour).
 */
export class Actor {
  private memberships = new Map<string, Membership | null>();
  /** The membership the command pipeline read through the transaction attempt now running (see `prime`). */
  private primed: { tx: Transaction; orgId: string; membership: Membership | null } | null = null;

  constructor(
    readonly uid: string,
    readonly email: string | null,
    readonly emailVerified: boolean,
    readonly profile: UserProfile | null,
  ) {}

  get isSuperAdmin() {
    return this.profile?.status === 'ACTIVE' && (this.profile.platformRoles ?? []).includes('SUPER_ADMIN');
  }

  /**
   * Hands over the membership document the command pipeline (core/callable.ts) has just read through `tx`, in the
   * transaction's first read, so the handler's permission check needs no read of its own. The pipeline calls this on
   * every attempt of the transaction with that attempt's own read (a retry reuses the same `tx` object, so nothing
   * may be remembered from one attempt to the next) and clears it when the transaction ends.
   */
  prime(tx: Transaction, orgId: string, snap: FirebaseFirestore.DocumentSnapshot): void {
    this.primed = { tx, orgId, membership: active(snap) };
  }

  clearPrime(): void {
    this.primed = null;
  }

  /** A membership document read at the start of a query, for permission checks outside a transaction. */
  seed(orgId: string, snap: FirebaseFirestore.DocumentSnapshot): void {
    this.memberships.set(orgId, active(snap));
  }

  /**
   * Reads through `tx` when given, so permission checks and writes see one
   * consistent snapshot. Nothing read through a transaction is kept beyond the
   * attempt: either the pipeline has just read it in this attempt (`prime`), or
   * it is read here, and a retried transaction reads it again.
   */
  async membership(orgId: string, tx?: Transaction): Promise<Membership | null> {
    if (tx && this.primed && this.primed.tx === tx && this.primed.orgId === orgId) return this.primed.membership;
    const ref = db.doc(`users/${this.uid}/memberships/${orgId}`);
    if (tx) return active(await tx.get(ref));
    if (!this.memberships.has(orgId)) this.memberships.set(orgId, active(await ref.get()));
    return this.memberships.get(orgId)!;
  }

  async can(perm: Permission, orgId: string, branchId?: string, tx?: Transaction): Promise<boolean> {
    if (this.isSuperAdmin) return true;
    const m = await this.membership(orgId, tx);
    if (!m || !holds(m, perm)) return false;
    return branchId === undefined || coversBranch(m.branchIds, branchId);
  }

  /**
   * The shared catalogue belongs to head office: a permission counts only if
   * held in a CORPORATE organization (franchises can't edit shared titles).
   * A command passes its `tx`; a read that writes nothing may leave it out
   * (a plain query, read afresh on every call: nothing is cached).
   */
  async canCatalog(perm: Permission, tx?: Transaction): Promise<boolean> {
    if (this.isSuperAdmin) return true;
    const held = db.collection(`users/${this.uid}/memberships`).where('status', '==', 'ACTIVE');
    const snaps = await (tx ? tx.get(held) : held.get());
    return snaps.docs.some((d) => {
      const m = d.data() as Membership;
      return m.orgType === 'CORPORATE' && holds(m, perm);
    });
  }

  /** What this person may do in an organization (every permission for a Super Admin). */
  async permissions(orgId: string, tx?: Transaction): Promise<{ perms: Set<Permission>; branchIds: BranchScope }> {
    if (this.isSuperAdmin) return { perms: new Set(Object.keys(PERMISSIONS) as Permission[]), branchIds: [ALL_BRANCHES] };
    const m = await this.membership(orgId, tx);
    return { perms: m ? permissionsOf(m) : new Set(), branchIds: m?.branchIds ?? [] };
  }

  async requireCatalog(perm: Permission, tx?: Transaction): Promise<void> {
    if (!(await this.canCatalog(perm, tx))) throw errors.forbidden();
  }

  async require(perm: Permission, orgId: string, branchId?: string, tx?: Transaction): Promise<void> {
    if (!(await this.can(perm, orgId, branchId, tx))) throw errors.forbidden();
  }
}

function active(snap: FirebaseFirestore.DocumentSnapshot): Membership | null {
  const m = snap.exists ? (snap.data() as Membership) : null;
  return m?.status === 'ACTIVE' ? m : null;
}

/** Roles a grantor may assign in an org (union over their roles). */
export function grantableBy(grantorRoles: readonly Role[]): Set<Role> {
  const out = new Set<Role>();
  for (const r of grantorRoles) for (const g of GRANTABLE[r] ?? []) out.add(g);
  return out;
}
