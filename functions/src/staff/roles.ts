import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { syncClaims } from '../core/claims.js';
import { errors } from '../core/errors.js';
import { auth, db } from '../core/firebase.js';
import {
  ALL_BRANCHES,
  type Actor,
  type BranchScope,
  grantableBy,
  isOrgWideRole,
  isPlatformRole,
  type Membership,
  type OrgType,
  rolesGrant,
} from '../core/rbac.js';
import { branchPatterns, reserveCodes } from '../core/numbering.js';
import { id, reason } from '../core/schemas.js';
import { ROLES, type Role } from '../generated/rbac.js';

const orgRole = z.enum(Object.keys(ROLES) as [Role, ...Role[]]).refine((r) => !isPlatformRole(r), 'is not an organization role');
const branchScope = z.array(z.union([z.literal(ALL_BRANCHES), id])).min(1).max(20);

const within = (inner: BranchScope, outer: BranchScope) =>
  outer.includes(ALL_BRANCHES) || (!inner.includes(ALL_BRANCHES) && inner.every((b) => outer.includes(b)));

/**
 * Checks that `actor` may change `target`'s membership in `orgId` from
 * `existing` to (`roles`, `branchIds`). Rules (docs/RBAC.md):
 * - Super Admin may do anything.
 * - Otherwise the actor needs `staff.manageRoles` in the org, may only add or
 *   remove roles listed for them in `grantable`, may not touch a member who
 *   holds a role they cannot grant, and — if branch-scoped — may only act
 *   within their own branches.
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
) {
  if (actor.isSuperAdmin) return;
  if (targetUid === actor.uid) throw errors.forbidden("You can't change your own roles. Ask another administrator.");
  const mine = await actor.membership(orgId, tx);
  if (!mine || !rolesGrant(mine.roles, 'staff.manageRoles')) throw errors.forbidden();
  const allowed = grantableBy(mine.roles);
  const current = existing?.status === 'ACTIVE' ? existing : null;
  if (current?.roles.some((r) => !allowed.has(r))) {
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
    throw errors.invalid('Organization-wide roles (admins, franchise owner) must cover all branches.');
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

const employeeIdRef = (orgId: string, employeeId: string) => db.doc(`orgs/${orgId}/employeeIds/${employeeId}`);

/**
 * Employee IDs are unique in the organization (orgs/{o}/employeeIds/{id}) and
 * kept when roles change or are revoked. Reads only; call `commit()` to write.
 */
async function assignEmployeeId(
  tx: Transaction,
  orgId: string,
  uid: string,
  current: string | null,
  requested: string,
  branch: FirebaseFirestore.DocumentSnapshot | null,
) {
  if (requested && requested !== current) {
    const taken = await tx.get(employeeIdRef(orgId, requested));
    if (taken.exists && taken.get('uid') !== uid) {
      throw errors.conflict('EMPLOYEE_ID_TAKEN', `Employee ID ${requested} already belongs to someone else in this organization.`);
    }
    return {
      employeeId: requested,
      commit() {
        if (current) tx.delete(employeeIdRef(orgId, current));
        tx.set(employeeIdRef(orgId, requested), { uid });
      },
    };
  }
  if (current) return { employeeId: current, commit() {} };
  const next = await reserveCodes(tx, {
    kind: 'employee',
    pattern: branchPatterns(branch).employee,
    values: { BRANCH: branch?.get('code') },
    base: `orgs/${orgId}/counters`,
    taken: async (codes) => (await Promise.all(codes.map((c) => tx.get(employeeIdRef(orgId, c))))).filter((d) => d.exists).map((d) => d.id),
  });
  const [employeeId] = next.codes;
  return {
    employeeId,
    commit() {
      next.commit();
      tx.create(employeeIdRef(orgId, employeeId), { uid });
    },
  };
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
    roles: z.array(orgRole).min(1).max(5).refine((r) => new Set(r).size === r.length, 'contains a role twice'),
    branchIds: branchScope,
    /** Blank keeps the current ID, or numbers a new one with the first branch's employee pattern. */
    employeeId: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, 'must be 2–24 letters, digits or dashes')]).default(''),
  }),
  async ({ actor, input, requestId }, tx) => {
    const target = await loadTarget(input.email);
    const orgSnap = await tx.get(db.doc(`orgs/${input.orgId}`));
    if (!orgSnap.exists || orgSnap.get('status') !== 'ACTIVE') throw errors.notFound('Organization');
    const orgType = orgSnap.get('type') as OrgType;
    validateScope(orgType, input.roles, input.branchIds);

    const ref = db.doc(`users/${target.uid}/memberships/${input.orgId}`);
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Membership) : null;
    await authorize(tx, actor, input.orgId, target.uid, existing, input.roles, input.branchIds);

    const branches = input.branchIds.includes(ALL_BRANCHES)
      ? []
      : await Promise.all(input.branchIds.map((b) => tx.get(db.doc(`orgs/${input.orgId}/branches/${b}`))));
    if (branches.some((b) => !b.exists || b.get('status') !== 'ACTIVE')) throw errors.notFound('One of the branches');
    const profile = await tx.get(db.doc(`users/${target.uid}`));
    if (!profile.exists) {
      throw errors.conflict('NO_PROFILE', 'This person needs to sign in to Stories once before roles can be granted.');
    }
    const staffId = await assignEmployeeId(tx, input.orgId, target.uid, existing?.employeeId ?? null, input.employeeId, branches[0] ?? null);

    const membership: Membership = {
      orgId: input.orgId,
      orgName: orgSnap.get('name'),
      orgType,
      uid: target.uid,
      email: target.email ?? input.email,
      displayName: target.displayName ?? null,
      roles: input.roles,
      branchIds: input.branchIds,
      status: 'ACTIVE',
    };
    staffId.commit();
    tx.set(ref, { ...membership, employeeId: staffId.employeeId, grantedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'staff.setRoles',
      entityType: 'membership',
      entityId: target.uid,
      branchId: input.branchIds.length === 1 && input.branchIds[0] !== ALL_BRANCHES ? input.branchIds[0] : null,
      before: existing ? { roles: existing.roles, branchIds: existing.branchIds, status: existing.status } : null,
      after: { roles: input.roles, branchIds: input.branchIds, status: 'ACTIVE', employeeId: staffId.employeeId },
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
    await authorize(tx, actor, input.orgId, input.uid, existing, [], existing.branchIds);
    tx.update(ref, { status: 'REVOKED', roles: [], revokedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'staff.revoke',
      entityType: 'membership',
      entityId: input.uid,
      before: { roles: existing.roles, branchIds: existing.branchIds, status: existing.status },
      after: { roles: [], status: 'REVOKED' },
      reason: input.reason,
    });
    return { uid: input.uid };
  },
  async ({ uid }) => {
    await syncClaims(uid);
  },
);
