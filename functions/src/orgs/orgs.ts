import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, name } from '../core/schemas.js';

export const orgType = z.enum(['CORPORATE', 'FRANCHISE']);

/** Creates an organization. Super Admin only (`org.manage`). */
export const create = command(
  'orgs-create',
  z.strictObject({ name, type: orgType }),
  async ({ actor, input, requestId }, tx) => {
    if (!actor.isSuperAdmin) throw errors.forbidden();
    const ref = db.collection('orgs').doc();
    const org = { name: input.name, type: input.type, status: 'ACTIVE' as const };
    tx.create(ref, { ...org, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, ref.id, {
      action: 'org.create',
      entityType: 'org',
      entityId: ref.id,
      after: org,
    });
    return { orgId: ref.id };
  },
);

/** Renames or (de)activates an organization. The type is immutable. */
export const update = command(
  'orgs-update',
  z.strictObject({ orgId: id, name: name.optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }),
  async ({ actor, input, requestId }, tx) => {
    if (!actor.isSuperAdmin) throw errors.forbidden();
    const ref = db.doc(`orgs/${input.orgId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Organization');
    const before = { name: snap.get('name'), status: snap.get('status') };
    const after = { name: input.name ?? before.name, status: input.status ?? before.status };
    tx.update(ref, { ...after, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'org.update',
      entityType: 'org',
      entityId: input.orgId,
      before,
      after,
    });
    return { orgId: input.orgId };
  },
);
