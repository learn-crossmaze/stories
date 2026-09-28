import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { address, contact, id, name, operatingHours, reason, weekday } from '../core/schemas.js';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, 'must be 2–8 letters or digits');

const editable = {
  name,
  address,
  contact,
  operatingHours: operatingHours.default([]),
  weeklyOffs: z.array(weekday).max(7).default([]),
};

async function activeOrg(tx: FirebaseFirestore.Transaction, orgId: string) {
  const snap = await tx.get(db.doc(`orgs/${orgId}`));
  if (!snap.exists) throw errors.notFound('Organization');
  if (snap.get('status') !== 'ACTIVE') throw errors.conflict('ORG_INACTIVE', 'This organization is not active.');
  return snap;
}

/**
 * Creates a branch. Its type follows the organization (corporate → company
 * owned, franchise → franchise). Branch codes are unique within the org and
 * never reused, reserved via orgs/{o}/branchCodes/{code}.
 */
export const create = command(
  'branches-create',
  z.strictObject({ orgId: id, code, ...editable }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('branches.manage', input.orgId, undefined, tx);
    const org = await activeOrg(tx, input.orgId);
    const codeRef = db.doc(`orgs/${input.orgId}/branchCodes/${input.code}`);
    if ((await tx.get(codeRef)).exists) {
      throw errors.conflict('BRANCH_CODE_TAKEN', `Branch code ${input.code} is already used in this organization.`);
    }
    const ref = db.collection(`orgs/${input.orgId}/branches`).doc();
    const { orgId, ...fields } = input;
    const branch = {
      ...fields,
      orgId,
      type: org.get('type') === 'FRANCHISE' ? 'FRANCHISE' : 'COMPANY_OWNED',
      timeZone: 'Asia/Kolkata',
      status: 'ACTIVE',
    };
    tx.create(codeRef, { branchId: ref.id });
    tx.create(ref, { ...branch, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
      action: 'branch.create',
      entityType: 'branch',
      entityId: ref.id,
      branchId: ref.id,
      after: branch,
    });
    return { branchId: ref.id };
  },
);

const partial = z.strictObject({
  orgId: id,
  branchId: id,
  name: editable.name.optional(),
  address: address.optional(),
  contact: contact.optional(),
  operatingHours: operatingHours.optional(),
  weeklyOffs: editable.weeklyOffs.optional(),
});

/** Edits branch details. Code, type and org are immutable. */
export const update = command('branches-update', partial, async ({ actor, input, requestId }, tx) => {
  await actor.require('branches.manage', input.orgId, input.branchId, tx);
  const ref = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
  const snap = await tx.get(ref);
  if (!snap.exists) throw errors.notFound('Branch');
  if (snap.get('status') !== 'ACTIVE') throw errors.conflict('BRANCH_ARCHIVED', 'Archived branches cannot be edited.');
  const { orgId, branchId, ...changes } = input;
  const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) throw errors.invalid('Nothing to update.');
  const before = Object.fromEntries(Object.keys(set).map((k) => [k, snap.get(k) ?? null]));
  tx.update(ref, { ...set, updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: branchId,
    branchId,
    before,
    after: set,
  });
  return { branchId };
});

/**
 * Archives a branch (soft delete: history stays). Later modules add checks
 * here, e.g. no active loans or copies still located at the branch.
 */
export const archive = command(
  'branches-archive',
  z.strictObject({ orgId: id, branchId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('branches.manage', input.orgId, input.branchId, tx);
    const ref = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Branch');
    if (snap.get('status') === 'ARCHIVED') throw errors.conflict('BRANCH_ARCHIVED', 'This branch is already archived.');
    tx.update(ref, { status: 'ARCHIVED', archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'branch.archive',
      entityType: 'branch',
      entityId: input.branchId,
      branchId: input.branchId,
      before: { status: snap.get('status') },
      after: { status: 'ARCHIVED' },
      reason: input.reason,
    });
    return { branchId: input.branchId };
  },
);
