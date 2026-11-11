// Roles of one's own (docs/RBAC.md §2.1): besides the ready-made roles in permissions.json, Super Admins and Branch
// Owners make roles permission by permission, in Master control → Roles. A role's permissions are copied onto each
// holder's membership (`customPerms`), so every check stays a plain read of the membership; changing a role updates
// its holders and their sign-in tokens.
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { markClaimsStale, syncClaims } from '../core/claims.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { type Actor, ALL_BRANCHES, type BranchScope, type Membership } from '../core/rbac.js';
import { id } from '../core/schemas.js';
import { PERMISSIONS, type Permission, ROLES, type Role, SUPER_ADMIN_ONLY } from '../generated/rbac.js';

export const rolesCol = () => db.collection('roles');

export interface CustomRole {
  name: string;
  description: string;
  permissions: Permission[];
  /** The organization it belongs to; null: every organization (made by a Super Admin). */
  orgId: string | null;
  /** Where it may be given (['*']: anywhere in the organization). A Branch Owner's roles stay in their branches. */
  branchIds: BranchScope;
  /** Holders must cover all branches (like HR Admin). */
  wholeOrg: boolean;
  status: 'ACTIVE';
  version: number;
  createdBy: string;
}

export const within = (inner: BranchScope, outer: BranchScope) =>
  outer.includes(ALL_BRANCHES) || (!inner.includes(ALL_BRANCHES) && inner.every((b) => outer.includes(b)));

const permission = z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]]);

/** Loads roles of one's own by id (read phase); a missing one is an error. */
export async function loadRoles(tx: Transaction, ids: readonly string[]): Promise<Map<string, CustomRole>> {
  const snaps = ids.length ? await tx.getAll(...ids.map((i) => rolesCol().doc(i))) : [];
  const out = new Map<string, CustomRole>();
  for (const s of snaps) {
    if (!s.exists || s.get('status') !== 'ACTIVE') throw errors.notFound('One of the roles');
    out.set(s.id, s.data() as CustomRole);
  }
  return out;
}

/** What a membership's own roles give, for storing on it. */
export function customFields(ids: readonly string[], roles: Map<string, CustomRole>) {
  const perms = new Set<Permission>();
  for (const i of ids) for (const p of roles.get(i)?.permissions ?? []) perms.add(p);
  return { customRoles: [...ids], customPerms: [...perms].sort(), customRoleNames: ids.map((i) => roles.get(i)?.name ?? i) };
}

/**
 * Whether `actor` may give `role` at `branchIds` in `orgId`: a Super Admin always; anyone else who may give roles
 * there (staff.manageRoles) and holds every permission in it, within the branches it may be given at.
 */
export async function mayGive(actor: Actor, orgId: string, role: CustomRole, branchIds: BranchScope, tx: Transaction): Promise<boolean> {
  if (role.orgId && role.orgId !== orgId) return false;
  if (!within(branchIds, role.orgId ? role.branchIds : [ALL_BRANCHES])) return false;
  if (role.wholeOrg && !branchIds.includes(ALL_BRANCHES)) return false;
  if (actor.isSuperAdmin) return true;
  const { perms } = await actor.permissions(orgId, tx);
  return perms.has('staff.manageRoles') && role.permissions.every((p) => perms.has(p));
}

/** Whether `actor` may make or change a role with these settings (and, when changing, as it was). */
async function mayAuthor(actor: Actor, role: Pick<CustomRole, 'orgId' | 'permissions' | 'branchIds' | 'wholeOrg'>, tx: Transaction) {
  if (role.permissions.some((p) => SUPER_ADMIN_ONLY.includes(p))) throw errors.invalid('One of the permissions is for Super Admins only.');
  if (actor.isSuperAdmin) return;
  if (!role.orgId) throw errors.forbidden('Only a Super Admin makes roles for every organization.');
  const { perms, branchIds } = await actor.permissions(role.orgId, tx);
  if (!perms.has('roles.manage')) throw errors.forbidden();
  if (!role.permissions.every((p) => perms.has(p))) throw errors.forbidden("A role can only give what you may do yourself. Untick the permissions you don't have.");
  if (!within(role.branchIds, branchIds)) throw errors.forbidden('A role you make can only be given in your own branches.');
  if (role.wholeOrg && !branchIds.includes(ALL_BRANCHES)) throw errors.forbidden('Only someone with all branches makes a role for the whole organization.');
}

const holdersOf = (roleId: string) => db.collectionGroup('memberships').where('customRoles', 'array-contains', roleId).where('status', '==', 'ACTIVE');

// ------------------------------------------------------------------ list

/**
 * The roles for an organization: the ready-made ones (with their permissions), and those of its own (with who holds
 * them, and whether you may change or give each). For Master control → Roles and for giving roles in Staff.
 */
export const list = query('roles-list', z.strictObject({ orgId: id }), async ({ actor, input }) => {
  const { perms, branchIds } = await actor.permissions(input.orgId);
  if (!actor.isSuperAdmin && !perms.has('roles.manage') && !perms.has('staff.manageRoles')) throw errors.forbidden();
  const [own, everyOrg, members] = await Promise.all([
    rolesCol().where('orgId', '==', input.orgId).get(),
    rolesCol().where('orgId', '==', null).get(),
    db.collectionGroup('memberships').where('orgId', '==', input.orgId).where('status', '==', 'ACTIVE').get(),
  ]);
  const holders = new Map<string, number>();
  const standardHolders = new Map<string, number>();
  for (const m of members.docs.map((d) => d.data() as Membership)) {
    for (const r of m.customRoles ?? []) holders.set(r, (holders.get(r) ?? 0) + 1);
    for (const r of m.roles) standardHolders.set(r, (standardHolders.get(r) ?? 0) + 1);
  }
  const mayAuthorRole = (r: CustomRole) =>
    actor.isSuperAdmin ||
    (!!r.orgId && perms.has('roles.manage') && r.permissions.every((p) => perms.has(p)) && within(r.branchIds, branchIds) && (!r.wholeOrg || branchIds.includes(ALL_BRANCHES)));
  const custom = [...own.docs, ...everyOrg.docs]
    .filter((d) => d.get('status') === 'ACTIVE')
    .map((d) => {
      const r = d.data() as CustomRole;
      return {
        id: d.id,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        everyOrg: !r.orgId,
        branchIds: r.branchIds,
        wholeOrg: r.wholeOrg,
        holders: holders.get(d.id) ?? 0,
        canEdit: mayAuthorRole(r),
        canGive: actor.isSuperAdmin || (perms.has('staff.manageRoles') && r.permissions.every((p) => perms.has(p))),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const standard = (Object.keys(ROLES) as Role[])
    .filter((r) => ROLES[r].scope !== 'platform')
    .map((r) => ({
      key: r,
      holders: standardHolders.get(r) ?? 0,
      permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => (PERMISSIONS[p] as readonly string[]).includes(ROLES[r].code)),
    }));
  return { standard, custom };
});

// ------------------------------------------------------------------ save

const roleInput = z.strictObject({
  orgId: id,
  /** Absent: a new role. */
  roleId: id.nullish(),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).default(''),
  permissions: z.array(permission).min(1).max(Object.keys(PERMISSIONS).length).refine((p) => new Set(p).size === p.length, 'contains a permission twice'),
  branchIds: z.array(z.union([z.literal(ALL_BRANCHES), id])).min(1).max(20).default([ALL_BRANCHES]),
  wholeOrg: z.boolean().default(false),
  /** Super Admins: a role for every organization. */
  everyOrg: z.boolean().default(false),
});

/**
 * Makes a role, or changes one (its holders get the change straight away). Names are unique among the roles an
 * organization can use, ready-made ones included.
 */
export const save = command('roles-save', roleInput, async ({ actor, input, requestId }, tx) => {
  if (input.branchIds.includes(ALL_BRANCHES) && input.branchIds.length > 1) throw errors.invalid('Choose either all branches or specific branches.');
  if (input.wholeOrg && !input.branchIds.includes(ALL_BRANCHES)) throw errors.invalid('A role for the whole organization is given with all branches.');
  if (input.everyOrg && !input.branchIds.includes(ALL_BRANCHES)) throw errors.invalid('A role for every organization is given with all branches.');
  const orgSnap = await tx.get(db.doc(`orgs/${input.orgId}`));
  if (!orgSnap.exists) throw errors.notFound('Organization');
  const next: Pick<CustomRole, 'orgId' | 'permissions' | 'branchIds' | 'wholeOrg'> = {
    orgId: input.everyOrg ? null : input.orgId,
    permissions: [...input.permissions].sort(),
    branchIds: input.branchIds,
    wholeOrg: input.wholeOrg,
  };
  const ref = input.roleId ? rolesCol().doc(input.roleId) : rolesCol().doc();
  const [snap, own, everyOrg] = await Promise.all([
    input.roleId ? tx.get(ref) : Promise.resolve(null),
    tx.get(rolesCol().where('orgId', '==', input.orgId)),
    tx.get(rolesCol().where('orgId', '==', null)),
  ]);
  const before = snap?.exists ? (snap.data() as CustomRole) : null;
  if (input.roleId && (!before || before.status !== 'ACTIVE')) throw errors.notFound('Role');
  if (before && before.orgId && before.orgId !== input.orgId) throw errors.notFound('Role');
  if (before && !before.orgId !== input.everyOrg) throw errors.invalid("A role's organization can't be changed. Make a new role instead.");
  // You change a role only if you could have made it as it was, and as it will be.
  if (before) await mayAuthor(actor, before, tx);
  await mayAuthor(actor, next, tx);
  if (input.branchIds.some((b) => b !== ALL_BRANCHES)) {
    const branches = await tx.getAll(...input.branchIds.map((b) => db.doc(`orgs/${input.orgId}/branches/${b}`)));
    if (branches.some((b) => !b.exists)) throw errors.notFound('One of the branches');
  }
  const lower = input.name.toLowerCase();
  const taken =
    (Object.values(ROLES) as { label: string }[]).some((r) => r.label.toLowerCase() === lower) ||
    [...own.docs, ...everyOrg.docs].some((d) => d.id !== ref.id && d.get('status') === 'ACTIVE' && String(d.get('name')).toLowerCase() === lower);
  if (taken) throw errors.conflict('ROLE_NAME_TAKEN', 'A role with this name already exists. Choose another name.');

  // Holders: still fit where the role may be given, and get its new permissions and name.
  const holders = before ? (await tx.get(holdersOf(ref.id))).docs : [];
  const others = [...new Set(holders.flatMap((h) => ((h.get('customRoles') as string[]) ?? []).filter((r) => r !== ref.id)))];
  const otherRoles = await loadRoles(tx, others);
  for (const h of holders) {
    const m = h.data() as Membership;
    if (next.orgId && m.orgId !== next.orgId) continue;
    if ((next.orgId && !within(m.branchIds, next.branchIds)) || (next.wholeOrg && !m.branchIds.includes(ALL_BRANCHES))) {
      throw errors.conflict('ROLE_HELD_ELSEWHERE', `${m.displayName ?? m.email ?? 'Someone'} holds this role outside the branches you chose. Change their roles first.`);
    }
  }
  const role: CustomRole = {
    name: input.name,
    description: input.description,
    ...next,
    status: 'ACTIVE',
    version: (before?.version ?? 0) + 1,
    createdBy: (before as { createdBy?: string } | null)?.createdBy ?? actor.uid,
  };
  tx.set(ref, { ...role, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(), ...(before ? {} : { createdAt: FieldValue.serverTimestamp() }) });
  const all = new Map([...otherRoles, [ref.id, role]]);
  const uids: string[] = [];
  for (const h of holders) {
    const m = h.data() as Membership;
    tx.update(h.ref, { ...customFields(m.customRoles ?? [], all), updatedAt: FieldValue.serverTimestamp() });
    markClaimsStale(tx, m.uid);
    uids.push(m.uid);
  }
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: before ? 'roles.update' : 'roles.create',
    entityType: 'role',
    entityId: ref.id,
    before: before ? { name: before.name, permissions: before.permissions, branchIds: before.branchIds, wholeOrg: before.wholeOrg } : null,
    after: { name: role.name, permissions: role.permissions, branchIds: role.branchIds, wholeOrg: role.wholeOrg, everyOrg: !role.orgId, holders: uids.length },
  });
  return { roleId: ref.id, uids };
}, async ({ uids }) => {
  await Promise.all(uids.map((u) => syncClaims(u)));
});

// ------------------------------------------------------------------ delete

/** Deletes a role no one holds (take it away from people first, in Staff). */
export const remove = command('roles-delete', z.strictObject({ orgId: id, roleId: id }), async ({ actor, input, requestId }, tx) => {
  const ref = rolesCol().doc(input.roleId);
  const [snap, holders] = await Promise.all([tx.get(ref), tx.get(holdersOf(input.roleId).limit(1))]);
  const role = snap.exists ? (snap.data() as CustomRole) : null;
  if (!role || role.status !== 'ACTIVE' || (role.orgId && role.orgId !== input.orgId)) throw errors.notFound('Role');
  await mayAuthor(actor, role, tx);
  if (!holders.empty) throw errors.conflict('ROLE_HELD', 'Someone still holds this role. Take it away from them in Staff first.');
  tx.delete(ref);
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'roles.delete',
    entityType: 'role',
    entityId: input.roleId,
    before: { name: role.name, permissions: role.permissions },
    after: null,
  });
  return { roleId: input.roleId };
});
