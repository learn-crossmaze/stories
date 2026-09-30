import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { id } from '../core/schemas.js';
import { activeLocation } from './copies.js';
import { copyRef, logEvent, type Copy } from './copyOps.js';
import { describeStatus } from './copyState.js';

/** Copies per call (each writes the copy and an event; a transaction takes 500). */
export const SHELVE_MAX = 100;

/** Copies that are in the building and can sit on a shelf (not on loan, travelling or gone). */
const SHELVABLE = ['AVAILABLE', 'RESERVED', 'UNDER_INSPECTION', 'DAMAGED'];

/**
 * Puts many copies on one shelf at once (Collection → Shelve books): new
 * stock and returned books that are back on the floor but not yet shelved.
 * All or none: a copy at another branch, or out on loan, stops the batch.
 * Copies already on that shelf are left as they are.
 */
export const shelve = command(
  'copies-shelve',
  z.strictObject({
    orgId: id,
    branchId: id,
    locationId: id,
    copyIds: z
      .array(id)
      .min(1)
      .max(SHELVE_MAX, `shelve at most ${SHELVE_MAX} copies at a time`)
      .refine((v) => new Set(v).size === v.length, 'contains a copy twice'),
  }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('copies.manage', input.orgId, input.branchId, tx);
    await activeLocation(tx, input.orgId, input.branchId, input.locationId);
    const snaps = await tx.getAll(...input.copyIds.map((c) => copyRef(input.orgId, c)));
    for (const s of snaps) {
      if (!s.exists) throw errors.notFound('Copy');
      const copy = s.data() as Copy;
      if (copy.currentBranchId !== input.branchId) throw errors.conflict('OTHER_BRANCH', `Copy ${copy.code} is not at this branch.`);
      if (!SHELVABLE.includes(copy.status)) throw errors.conflict('COPY_STATE', `Copy ${copy.code} is ${describeStatus(copy.status)}.`);
    }
    const moved = snaps.filter((s) => s.get('locationId') !== input.locationId);
    for (const s of moved) {
      const copy = s.data() as Copy;
      tx.update(s.ref, { locationId: input.locationId, updatedAt: FieldValue.serverTimestamp() });
      logEvent(tx, s.ref.path, {
        type: 'SHELVED', actorUid: actor.uid, fromStatus: copy.status, toStatus: copy.status, condition: copy.condition,
        ref: { from: copy.locationId, to: input.locationId },
      });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'copies.shelve', entityType: 'location', entityId: input.locationId, branchId: input.branchId,
      after: { codes: moved.map((s) => s.get('code') as string) },
    });
    return { shelved: moved.length, unchanged: snaps.length - moved.length };
  },
);
