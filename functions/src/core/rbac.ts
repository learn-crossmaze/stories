import type { Transaction } from 'firebase-admin/firestore';

import { GRANTABLE, PERMISSIONS, type Permission, ROLES, type Role } from '../generated/rbac.js';
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
  roles: Role[];
  branchIds: BranchScope;
  status: 'ACTIVE' | 'REVOKED';
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
export const isOrgWideRole = (r: Role) => ROLES[r].scope === 'org';
export const isPlatformRole = (r: Role) => ROLES[r].scope === 'platform';

export function rolesGrant(roles: readonly Role[], perm: Permission): boolean {
  const allowed = PERMISSIONS[perm] as readonly string[];
  return roles.some((r) => allowed.includes(roleCode(r)));
}

export const coversBranch = (scope: BranchScope, branchId: string) =>
  scope.includes(ALL_BRANCHES) || scope.includes(branchId);

/**
 * The calling user, resolved from the *authoritative* Firestore documents
 * (not from token claims, which can lag a revocation by up to an hour).
 */
export class Actor {
  private memberships = new Map<string, Membership | null>();

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
   * Reads through `tx` when given (never cached: a retried transaction must
   * re-read), so permission checks and writes see one consistent snapshot.
   */
  async membership(orgId: string, tx?: Transaction): Promise<Membership | null> {
    const ref = db.doc(`users/${this.uid}/memberships/${orgId}`);
    if (tx) return active(await tx.get(ref));
    if (!this.memberships.has(orgId)) this.memberships.set(orgId, active(await ref.get()));
    return this.memberships.get(orgId)!;
  }

  async can(perm: Permission, orgId: string, branchId?: string, tx?: Transaction): Promise<boolean> {
    if (this.isSuperAdmin) return true;
    const m = await this.membership(orgId, tx);
    if (!m || !rolesGrant(m.roles, perm)) return false;
    return branchId === undefined || coversBranch(m.branchIds, branchId);
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
