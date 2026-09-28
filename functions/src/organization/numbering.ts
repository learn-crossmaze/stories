import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { BRANCH_KINDS, patternField } from '../core/numbering.js';
import { id } from '../core/schemas.js';

/**
 * Sets a branch's numbering patterns for copies, members, shelves and
 * employee IDs ('' = the default). Only new records use the new patterns.
 */
export const setBranchNumbering = command(
  'branches-setNumbering',
  z.strictObject({
    orgId: id,
    branchId: id,
    copy: patternField('copy'),
    member: patternField('member'),
    location: patternField('location'),
    employee: patternField('employee'),
  }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('branches.manage', input.orgId, input.branchId, tx);
    const ref = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Branch');
    if (snap.get('status') !== 'ACTIVE') throw errors.conflict('BRANCH_ARCHIVED', 'Archived branches cannot be edited.');
    const numbering = Object.fromEntries(BRANCH_KINDS.filter((k) => input[k]).map((k) => [k, input[k]]));
    tx.update(ref, { numbering, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'branch.numbering',
      entityType: 'branch',
      entityId: input.branchId,
      branchId: input.branchId,
      before: { numbering: snap.get('numbering') ?? {} },
      after: { numbering },
    });
    return { branchId: input.branchId };
  },
);

/** Sets the catalogue-wide book code pattern ('' = BOOK-{SEQ:6}). */
export const setBookNumbering = command(
  'books-setNumbering',
  z.strictObject({ book: patternField('book') }),
  async ({ actor, input, requestId }, tx) => {
    await actor.requireCatalog('books.edit', tx);
    const ref = db.doc('config/numbering');
    const before = await tx.get(ref);
    tx.set(ref, { book: input.book || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
      action: 'book.numbering',
      entityType: 'config',
      entityId: 'numbering',
      before: { book: (before.get('book') as string | undefined) ?? null },
      after: { book: input.book || null },
    });
    return { book: input.book };
  },
);
