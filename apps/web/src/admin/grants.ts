import { rolesIn, type StoriesClaims } from '../auth/claims';
import type { OrgType, StaffMembership } from '../data/org';
import { GRANTABLE, ROLES, type Role } from '../generated/rbac';

const ORG_ROLES = (Object.keys(ROLES) as Role[]).filter((r) => ROLES[r].scope !== 'platform');

const fitsOrg = (r: Role, orgType: OrgType) => {
  const types = (ROLES[r] as { orgTypes?: readonly string[] }).orgTypes;
  return !types || types.includes(orgType);
};

/** Roles this user may assign in an org — mirrors functions/src/organization/staff.ts for the UI. */
export function grantableRoles(claims: StoriesClaims, orgId: string, orgType: OrgType): Role[] {
  if (claims.sa) return ORG_ROLES.filter((r) => fitsOrg(r, orgType));
  const out = new Set<Role>();
  for (const mine of rolesIn(claims, orgId)) for (const g of GRANTABLE[mine] ?? []) out.add(g);
  return ORG_ROLES.filter((r) => out.has(r) && fitsOrg(r, orgType));
}

/** Whether the UI should offer edit/remove for a staff row (server re-checks). */
export function canManageMember(claims: StoriesClaims, uid: string, orgId: string, orgType: OrgType, m: StaffMembership): boolean {
  if (claims.sa) return true;
  if (uid === m.uid) return false;
  const grantable = new Set(grantableRoles(claims, orgId, orgType));
  if (m.status === 'ACTIVE' && m.roles.some((r) => !grantable.has(r))) return false;
  const mine = claims.o[orgId]?.b ?? [];
  return mine.includes('*') || (!m.branchIds.includes('*') && m.branchIds.every((b) => mine.includes(b)));
}

export const isOrgWide = (r: Role) => ROLES[r].scope === 'org';
