import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { branchPatterns, LOCATION_KIND_CODES, reserveCodes } from '../core/numbering.js';
import { id } from '../core/schemas.js';

/**
 * Shelf/desk locations inside a branch, e.g. A-03-2 "Children, bay 3, shelf 2".
 * Leave the code blank to number it with the branch's shelf pattern.
 */
export const create = command(
  'locations-create',
  z.strictObject({
    orgId: id,
    branchId: id,
    code: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,16}$/, 'must be up to 16 letters, digits or dashes')]).default(''),
    label: z.string().trim().min(2).max(80),
    kind: z.enum(['SHELF', 'DISPLAY', 'DESK', 'BACKROOM']),
  }),
  async ({ actor, input }, tx) => {
    await actor.require('copies.manage', input.orgId, input.branchId, tx);
    const branchRef = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
    const branch = await tx.get(branchRef);
    if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
    const col = branchRef.collection('locations');
    const inUse = async (codes: string[]) =>
      (await tx.get(col.where('code', 'in', codes).where('status', '==', 'ACTIVE'))).docs.map((d) => d.get('code') as string);
    const auto = input.code
      ? null
      : await reserveCodes(tx, {
          kind: 'location',
          pattern: branchPatterns(branch).location,
          values: { BRANCH: branch.get('code'), KIND: LOCATION_KIND_CODES[input.kind] },
          base: `${branchRef.path}/counters`,
          taken: inUse,
        });
    const code = auto ? auto.codes[0] : input.code;
    if (!auto && (await inUse([code])).length) throw errors.conflict('DUPLICATE_LOCATION', `Location ${code} already exists in this branch.`);
    auto?.commit();
    const ref = col.doc();
    tx.create(ref, { code, label: input.label, kind: input.kind, status: 'ACTIVE', createdAt: FieldValue.serverTimestamp() });
    return { locationId: ref.id, code };
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
