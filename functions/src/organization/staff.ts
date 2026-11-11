import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { assertClaimsFit, markClaimsStale, syncClaims } from '../core/claims.js';
import { errors } from '../core/errors.js';
import { auth, db } from '../core/firebase.js';
import {
  ALL_BRANCHES,
  type Actor,
  type BranchScope,
  grantableBy,
  holds,
  isOrgWideRole,
  isPlatformRole,
  type Membership,
  type OrgType,
  type UserProfile,
} from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import { ROLES, type Role } from '../generated/rbac.js';
import { assignEmployeeCode } from '../hr/codes.js';
import { employeeCodeRef, employeesCol, findEmployeeFor, newEmployee } from '../hr/model.js';
import { type CustomRole, customFields, loadRoles, mayGive, within } from './roles.js';

const orgRole = z.enum(Object.keys(ROLES) as [Role, ...Role[]]).refine((r) => !isPlatformRole(r), 'is not an organization role');
const branchScope = z.array(z.union([z.literal(ALL_BRANCHES), id])).min(1).max(20);

/**
 * Checks that `actor` may change `target`'s membership in `orgId` from
 * `existing` to (`roles` + own roles `custom`, `branchIds`). Rules (docs/RBAC.md §4.1):
 * - Super Admin may do anything.
 * - Otherwise the actor needs `staff.manageRoles` in the org, may only add or
 *   remove ready-made roles listed for them in `grantable` and roles of the
 *   organization's own that give nothing they can't do themselves, may not
 *   touch a member who holds a role they cannot grant, and — if branch-scoped —
 *   may only act within their own branches.
 * - Nobody but a Super Admin edits their own roles.
 */
async function authorize(
  tx: Transaction,
  actor: Actor,
  orgId: string,
  targetUid: string,
  existing: Membership | null,
  roles: Role[],
  branchIds: BranchScope,
  custom: { ids: string[]; defs: Map<string, CustomRole> },
) {
  const current = existing?.status === 'ACTIVE' ? existing : null;
  for (const i of custom.ids) {
    if (!(await mayGive(actor, orgId, custom.defs.get(i)!, branchIds, tx))) {
      throw errors.forbidden(actor.isSuperAdmin ? `${custom.defs.get(i)!.name} can't be given at the chosen branches.` : "You can't give one of the selected roles.");
    }
  }
  if (actor.isSuperAdmin) return;
  if (targetUid === actor.uid) throw errors.forbidden("You can't change your own roles. Ask another administrator.");
  const mine = await actor.membership(orgId, tx);
  if (!mine || !holds(mine, 'staff.manageRoles')) throw errors.forbidden();
  const allowed = grantableBy(mine.roles);
  const myPerms = (await actor.permissions(orgId, tx)).perms;
  if (current?.roles.some((r) => !allowed.has(r)) || (current?.customPerms ?? []).some((p) => !myPerms.has(p))) {
    throw errors.forbidden('This person holds a role you cannot manage. Ask a senior administrator.');
  }
  if (roles.some((r) => !allowed.has(r))) throw errors.forbidden("You can't grant one of the selected roles.");
  if (!within(branchIds, mine.branchIds) || (current && !within(current.branchIds, mine.branchIds))) {
    throw errors.forbidden('You can only manage staff in your own branches.');
  }
}

function validateScope(orgType: OrgType, roles: Role[], branchIds: BranchScope) {
  for (const r of roles) {
    const types = (ROLES[r] as { orgTypes?: readonly OrgType[] }).orgTypes;
    if (types && !types.includes(orgType)) {
      throw errors.invalid(`${ROLES[r].label} can't be granted in a ${orgType.toLowerCase()} organization.`);
    }
  }
  const all = branchIds.includes(ALL_BRANCHES);
  if (all && branchIds.length > 1) throw errors.invalid('Choose either all branches or specific branches.');
  if (roles.some(isOrgWideRole) && !all) {
    throw errors.invalid('Organization-wide roles (HR Admin, Finance Admin, Website Editor) must cover all branches.');
  }
}

async function loadTarget(email: string) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    throw errors.conflict(
      'USER_NOT_FOUND',
      'No Stories account uses this email. Ask the person to sign up first, then try again.',
    );
  }
}

/**
 * Sets a staff member's roles and branch scope in an organization (replaces
 * any previous roles there). The person must already have a Stories account.
 */
export const setRoles = command(
  'staff-setRoles',
  z.strictObject({
    orgId: id,
    email: z.email().transform((e) => e.toLowerCase()),
    roles: z.array(orgRole).max(5).refine((r) => new Set(r).size === r.length, 'contains a role twice'),
    /** Roles of the organization's own (Master control → Roles). */
    customRoles: z.array(id).max(5).default([]).refine((r) => new Set(r).size === r.length, 'contains a role twice'),
    branchIds: branchScope,
    /** Blank keeps the current ID, or numbers a new one with the first branch's employee pattern. */
    employeeId: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, 'must be 2–24 letters, digits or dashes')]).default(''),
  }),
  async ({ actor, input, requestId }, tx) => {
    const target = await loadTarget(input.email);
    const orgSnap = await tx.get(db.doc(`orgs/${input.orgId}`));
    if (!orgSnap.exists || orgSnap.get('status') !== 'ACTIVE') throw errors.notFound('Organization');
    const orgType = orgSnap.get('type') as OrgType;
    if (!input.roles.length && !input.customRoles.length) throw errors.invalid('Choose at least one role.');
    validateScope(orgType, input.roles, input.branchIds);

    const ref = db.doc(`users/${target.uid}/memberships/${input.orgId}`);
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Membership) : null;
    const defs = await loadRoles(tx, input.customRoles);
    await authorize(tx, actor, input.orgId, target.uid, existing, input.roles, input.branchIds, { ids: input.customRoles, defs });
    const custom = customFields(input.customRoles, defs);

    const branches = input.branchIds.includes(ALL_BRANCHES)
      ? []
      : await Promise.all(input.branchIds.map((b) => tx.get(db.doc(`orgs/${input.orgId}/branches/${b}`))));
    if (branches.some((b) => !b.exists || b.get('status') !== 'ACTIVE')) throw errors.notFound('One of the branches');
    const profile = await tx.get(db.doc(`users/${target.uid}`));
    if (!profile.exists) {
      throw errors.conflict('NO_PROFILE', 'This person needs to sign in to Stories once before roles can be granted.');
    }
    await assertClaimsFit(tx, target.uid, profile.data() as UserProfile, {
      orgId: input.orgId, orgName: orgSnap.get('name'), orgType, uid: target.uid, email: null, displayName: null,
      roles: input.roles, ...custom, branchIds: input.branchIds, status: 'ACTIVE',
    });
    // Every staff member has one employee record (People); link or create it, never duplicate it.
    const email = target.email ?? input.email;
    const linked = await findEmployeeFor(tx, input.orgId, target.uid, email);
    if (linked?.get('status') === 'OFFBOARDED') {
      throw errors.conflict('EMPLOYEE_OFFBOARDED', 'This person has been offboarded. Rehire them in People before granting roles.');
    }
    const employeeDoc = linked?.ref ?? employeesCol(input.orgId).doc();
    const current = (linked?.get('code') as string | undefined) ?? existing?.employeeId ?? null;
    const stale = existing?.employeeId && existing.employeeId !== current ? await tx.get(employeeCodeRef(input.orgId, existing.employeeId)) : null;
    const staffId = await assignEmployeeCode(tx, input.orgId, { uid: target.uid, employeeDocId: employeeDoc.id }, current, input.employeeId, branches[0] ?? null);

    const membership: Membership = {
      orgId: input.orgId,
      orgName: orgSnap.get('name'),
      orgType,
      uid: target.uid,
      email: target.email ?? input.email,
      displayName: target.displayName ?? null,
      roles: input.roles,
      ...custom,
      branchIds: input.branchIds,
      status: 'ACTIVE',
    };
    staffId.commit();
    // A roles-only ID the person had before their HR record was linked is released.
    if (stale?.exists && stale.id !== staffId.employeeId && stale.get('uid') === target.uid && (stale.get('employeeDocId') ?? employeeDoc.id) === employeeDoc.id) {
      tx.delete(stale.ref);
    }
    if (linked) {
      tx.update(employeeDoc, { uid: target.uid, email, emailLower: email.toLowerCase(), code: staffId.employeeId, updatedAt: FieldValue.serverTimestamp() });
    } else {
      const firstBranch = input.branchIds.includes(ALL_BRANCHES) ? null : input.branchIds[0];
      tx.create(employeeDoc, {
        ...newEmployee({ orgId: input.orgId, code: staffId.employeeId, fullName: target.displayName || email, status: 'ACTIVE', source: 'ROLES', uid: target.uid, email, branchId: firstBranch }),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(ref, { ...membership, employeeId: staffId.employeeId, grantedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    markClaimsStale(tx, target.uid);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'staff.setRoles',
      entityType: 'membership',
      entityId: target.uid,
      branchId: input.branchIds.length === 1 && input.branchIds[0] !== ALL_BRANCHES ? input.branchIds[0] : null,
      before: existing ? { roles: existing.roles, customRoles: existing.customRoleNames ?? [], branchIds: existing.branchIds, status: existing.status } : null,
      after: { roles: input.roles, customRoles: custom.customRoleNames, branchIds: input.branchIds, status: 'ACTIVE', employeeId: staffId.employeeId, employeeDocId: employeeDoc.id },
    });
    return { uid: target.uid };
  },
  async ({ uid }) => {
    await syncClaims(uid);
  },
);

/** Removes all of a person's roles in an organization. History is kept. */
export const revoke = command(
  'staff-revoke',
  z.strictObject({ orgId: id, uid: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const ref = db.doc(`users/${input.uid}/memberships/${input.orgId}`);
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Membership) : null;
    if (!existing || existing.status !== 'ACTIVE') throw errors.notFound('Active staff role');
    await authorize(tx, actor, input.orgId, input.uid, existing, [], existing.branchIds, { ids: [], defs: new Map() });
    tx.update(ref, { status: 'REVOKED', roles: [], customRoles: [], customPerms: [], customRoleNames: [], revokedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    markClaimsStale(tx, input.uid);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'staff.revoke',
      entityType: 'membership',
      entityId: input.uid,
      before: { roles: existing.roles, customRoles: existing.customRoleNames ?? [], branchIds: existing.branchIds, status: existing.status },
      after: { roles: [], status: 'REVOKED' },
      reason: input.reason,
    });
    return { uid: input.uid };
  },
  async ({ uid }) => {
    await syncClaims(uid);
  },
);
