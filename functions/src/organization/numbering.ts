import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { BRANCH_KINDS, HEAD_OFFICE_CODE, patternField } from '../core/numbering.js';
import { requireFor } from '../hr/model.js';
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

/**
 * Sets how head-office staff (no branch) are numbered: the employee ID
 * pattern ('' = the default) and the code {BRANCH} stands for ('' = HO).
 * Needs branches.manage across all branches. New IDs only.
 */
export const setHeadOfficeNumbering = command(
  'orgs-setNumbering',
  z.strictObject({
    orgId: id,
    employee: patternField('employee'),
    headOfficeCode: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'must be 2–8 letters or digits')]).default(''),
  }),
  async ({ actor, input, requestId }, tx) => {
    await requireFor(actor, 'branches.manage', input.orgId, null, tx);
    const ref = db.doc(`orgs/${input.orgId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Organization');
    const before = { employee: (snap.get('numbering.employee') as string | undefined) ?? null, headOfficeCode: (snap.get('headOfficeCode') as string | undefined) ?? null };
    const after = { employee: input.employee || null, headOfficeCode: input.headOfficeCode || null };
    tx.update(ref, { numbering: { employee: after.employee }, headOfficeCode: after.headOfficeCode, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'org.numbering',
      entityType: 'org',
      entityId: input.orgId,
      before,
      after: { ...after, effective: `${after.employee ?? 'default'} with ${after.headOfficeCode ?? HEAD_OFFICE_CODE}` },
    });
    return { orgId: input.orgId };
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
