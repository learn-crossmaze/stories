import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';

/** Shelf/desk locations inside a branch, e.g. A-03-2 "Children, bay 3, shelf 2". */
export const create = command(
  'locations-create',
  z.strictObject({
    orgId: id,
    branchId: id,
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,16}$/, 'must be up to 16 letters, digits or dashes'),
    label: z.string().trim().min(2).max(80),
    kind: z.enum(['SHELF', 'DISPLAY', 'DESK', 'BACKROOM']),
  }),
  async ({ actor, input }, tx) => {
    await actor.require('copies.manage', input.orgId, input.branchId, tx);
    const col = db.collection(`orgs/${input.orgId}/branches/${input.branchId}/locations`);
    const dup = await tx.get(col.where('code', '==', input.code).where('status', '==', 'ACTIVE').limit(1));
    if (!dup.empty) throw errors.conflict('DUPLICATE_LOCATION', `Location ${input.code} already exists in this branch.`);
    const ref = col.doc();
    tx.create(ref, { code: input.code, label: input.label, kind: input.kind, status: 'ACTIVE', createdAt: FieldValue.serverTimestamp() });
    return { locationId: ref.id };
  },
);

export const archive = command(
  'locations-archive',
  z.strictObject({ orgId: id, branchId: id, locationId: id }),
  async ({ actor, input }, tx) => {
    await actor.require('copies.manage', input.orgId, input.branchId, tx);
    const ref = db.doc(`orgs/${input.orgId}/branches/${input.branchId}/locations/${input.locationId}`);
    if (!(await tx.get(ref)).exists) throw errors.notFound('Location');
    tx.update(ref, { status: 'ARCHIVED' });
    return { locationId: input.locationId };
  },
);
