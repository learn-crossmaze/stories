import { ORG_WIDE, PERMISSION_CODES, PERMISSIONS, type Permission, ROLES, type Role } from '../generated/rbac';

/** Token claims written by the claims sync function (docs/RBAC.md §4). */
export interface StoriesClaims {
  v: number;
  sa: boolean;
  /** Per organization: ready-made role codes, branch scope, and every permission held there (2-character codes). */
  o: Record<string, { r: string[]; b: string[]; p?: string }>;
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

const PERM_OF_CODE = new Map(Object.entries(PERMISSION_CODES).map(([p, code]) => [code, p as Permission]));

const ALL_PERMS = new Set(Object.keys(PERMISSION_CODES) as Permission[]);
const cache = new WeakMap<object, Set<Permission>>();

/** The permissions in one organization's claims: `p`, or, for a token from before `p` existed, its roles' permissions. */
function decode(org: StoriesClaims['o'][string]): Set<Permission> {
  const hit = cache.get(org);
  if (hit) return hit;
  const out = new Set<Permission>();
  if (typeof org.p === 'string') {
    for (let i = 0; i + 1 < org.p.length; i += 2) {
      const perm = PERM_OF_CODE.get(org.p.slice(i, i + 2));
      if (perm) out.add(perm);
    }
  } else {
    for (const [perm, codes] of Object.entries(PERMISSIONS) as [Permission, readonly string[]][]) {
      if (org.r.some((r) => codes.includes(r)) && (org.b.includes('*') || !ORG_WIDE.includes(perm))) out.add(perm);
    }
  }
  cache.set(org, out);
  return out;
}

/** Everything the person may do in an organization, read from the token (ready-made roles and their own roles alike). */
export function permsIn(c: StoriesClaims, orgId: string | null): Set<Permission> {
  if (c.sa) return ALL_PERMS;
  const org = orgId ? c.o[orgId] : undefined;
  return org ? decode(org) : new Set();
}

/** What everyone on staff may do: looking branches up and their own tasks. Anything more starts on the Dashboard. */
const SELF_SERVICE = new Set<Permission>(['branches.view', 'tasks.execute']);

/** Where a staff member lands after signing in: the Dashboard, or My profile for those who only use My employment. */
export function staffHome(c: StoriesClaims): '/admin' | '/me' {
  if (c.sa) return '/admin';
  return Object.keys(c.o).some((o) => [...permsIn(c, o)].some((p) => !SELF_SERVICE.has(p))) ? '/admin' : '/me';
}

/**
 * UI-only permission check: decides what to show. The server (rules and
 * functions) makes the real decision; hiding a button is never security.
 */
export function can(c: StoriesClaims, perm: Permission, orgId: string | null, branchId?: string): boolean {
  if (c.sa) return true;
  const org = orgId ? c.o[orgId] : undefined;
  if (!org) return false;
  if (!decode(org).has(perm)) return false;
  return branchId === undefined || org.b.includes('*') || org.b.includes(branchId);
}

export const branchScope = (c: StoriesClaims, orgId: string): string[] | 'ALL' =>
  c.sa || c.o[orgId]?.b.includes('*') ? 'ALL' : (c.o[orgId]?.b ?? []);

const byCode = Object.fromEntries(Object.entries(ROLES).map(([role, def]) => [def.code, role as Role]));
export const rolesIn = (c: StoriesClaims, orgId: string): Role[] => (c.o[orgId]?.r ?? []).map((code) => byCode[code]).filter(Boolean);
