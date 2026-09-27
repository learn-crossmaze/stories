import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, name, reason } from '../core/schemas.js';

/** Creates a department, org-wide (`branchId: null`) or for one branch. */
export const create = command(
  'departments-create',
  z.strictObject({ orgId: id, name, branchId: id.nullable().default(null) }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('departments.manage', input.orgId, input.branchId ?? undefined, tx);
    if (input.branchId) {
      const branch = await tx.get(db.doc(`orgs/${input.orgId}/branches/${input.branchId}`));
      if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
    }
    const ref = db.collection(`orgs/${input.orgId}/departments`).doc();
    const dept = { orgId: input.orgId, name: input.name, branchId: input.branchId, status: 'ACTIVE' };
    tx.create(ref, { ...dept, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'department.create',
      entityType: 'department',
      entityId: ref.id,
      branchId: input.branchId,
      after: dept,
    });
    return { departmentId: ref.id };
  },
);

export const rename = command(
  'departments-rename',
  z.strictObject({ orgId: id, departmentId: id, name }),
  async ({ actor, input, requestId }, tx) => {
    const ref = db.doc(`orgs/${input.orgId}/departments/${input.departmentId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Department');
    await actor.require('departments.manage', input.orgId, snap.get('branchId') ?? undefined, tx);
    tx.update(ref, { name: input.name, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'department.rename',
      entityType: 'department',
      entityId: input.departmentId,
      branchId: snap.get('branchId') ?? null,
      before: { name: snap.get('name') },
      after: { name: input.name },
    });
    return { departmentId: input.departmentId };
  },
);

export const archive = command(
  'departments-archive',
  z.strictObject({ orgId: id, departmentId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const ref = db.doc(`orgs/${input.orgId}/departments/${input.departmentId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Department');
    await actor.require('departments.manage', input.orgId, snap.get('branchId') ?? undefined, tx);
    if (snap.get('status') === 'ARCHIVED') throw errors.conflict('ARCHIVED', 'This department is already archived.');
    tx.update(ref, { status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'department.archive',
      entityType: 'department',
      entityId: input.departmentId,
      branchId: snap.get('branchId') ?? null,
      before: { status: snap.get('status') },
      after: { status: 'ARCHIVED' },
      reason: input.reason,
    });
    return { departmentId: input.departmentId };
  },
);
