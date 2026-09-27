import { PERMISSIONS, type Permission, ROLES, type Role } from '../generated/rbac';

/** Token claims written by the claims sync function (docs/RBAC.md §4). */
export interface StoriesClaims {
  v: number;
  sa: boolean;
  o: Record<string, { r: string[]; b: string[] }>;
}

export const NO_CLAIMS: StoriesClaims = { v: 0, sa: false, o: {} };

export function parseClaims(raw: Record<string, unknown>): StoriesClaims {
  return {
    v: typeof raw.v === 'number' ? raw.v : 0,
    sa: raw.sa === true,
    o: raw.o && typeof raw.o === 'object' ? (raw.o as StoriesClaims['o']) : {},
  };
}

export const isStaff = (c: StoriesClaims) => c.sa || Object.keys(c.o).length > 0;

/**
 * UI-only permission check: decides what to show. The server (rules and
 * functions) makes the real decision; hiding a button is never security.
 */
export function can(c: StoriesClaims, perm: Permission, orgId: string | null, branchId?: string): boolean {
  if (c.sa) return true;
  const org = orgId ? c.o[orgId] : undefined;
  if (!org) return false;
  const allowed = PERMISSIONS[perm] as readonly string[];
  if (!org.r.some((r) => allowed.includes(r))) return false;
  return branchId === undefined || org.b.includes('*') || org.b.includes(branchId);
}

export const branchScope = (c: StoriesClaims, orgId: string): string[] | 'ALL' =>
  c.sa || c.o[orgId]?.b.includes('*') ? 'ALL' : (c.o[orgId]?.b ?? []);

const byCode = Object.fromEntries(Object.entries(ROLES).map(([role, def]) => [def.code, role as Role]));
export const rolesIn = (c: StoriesClaims, orgId: string): Role[] => (c.o[orgId]?.r ?? []).map((code) => byCode[code]).filter(Boolean);
