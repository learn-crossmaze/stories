import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, name, reason } from '../core/schemas.js';
import { hrConfigRef } from './model.js';

/** Designations (job titles) are org-wide: orgs/{o}/designations/{d}. */
export const createDesignation = command(
  'designations-create',
  z.strictObject({ orgId: id, name }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const dup = await tx.get(db.collection(`orgs/${input.orgId}/designations`).where('nameLower', '==', input.name.toLowerCase()).limit(1));
    if (!dup.empty) throw errors.conflict('DUPLICATE', 'A designation with this name already exists.');
    const ref = db.collection(`orgs/${input.orgId}/designations`).doc();
    const data = { orgId: input.orgId, name: input.name, nameLower: input.name.toLowerCase(), status: 'ACTIVE' };
    tx.create(ref, { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, { action: 'designation.create', entityType: 'designation', entityId: ref.id, after: data });
    return { designationId: ref.id };
  },
);

export const renameDesignation = command(
  'designations-rename',
  z.strictObject({ orgId: id, designationId: id, name }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const ref = db.doc(`orgs/${input.orgId}/designations/${input.designationId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Designation');
    const dup = await tx.get(db.collection(`orgs/${input.orgId}/designations`).where('nameLower', '==', input.name.toLowerCase()).limit(1));
    if (!dup.empty && dup.docs[0].id !== input.designationId) throw errors.conflict('DUPLICATE', 'A designation with this name already exists.');
    // Employee records keep the name they were given (their history says when it changed).
    tx.update(ref, { name: input.name, nameLower: input.name.toLowerCase(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'designation.rename',
      entityType: 'designation',
      entityId: input.designationId,
      before: { name: snap.get('name') },
      after: { name: input.name },
    });
    return { designationId: input.designationId };
  },
);

export const archiveDesignation = command(
  'designations-archive',
  z.strictObject({ orgId: id, designationId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const ref = db.doc(`orgs/${input.orgId}/designations/${input.designationId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Designation');
    if (snap.get('status') === 'ARCHIVED') throw errors.conflict('ARCHIVED', 'This designation is already archived.');
    tx.update(ref, { status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'designation.archive',
      entityType: 'designation',
      entityId: input.designationId,
      before: { status: snap.get('status') },
      after: { status: 'ARCHIVED' },
      reason: input.reason,
    });
    return { designationId: input.designationId };
  },
);

const checklist = z
  .array(
    z.strictObject({
      key: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, 'must be lower-case letters, digits or dashes'),
      label: z.string().trim().min(2).max(100),
      required: z.boolean(),
    }),
  )
  .min(1)
  .max(30)
  .refine((items) => new Set(items.map((i) => i.key)).size === items.length, 'has an item twice');

/**
 * Onboarding and offboarding checklist templates (orgs/{o}/config/hr). New
 * checklists copy the template; checklists already started keep theirs.
 */
export const setChecklists = command(
  'hr-setChecklists',
  z.strictObject({ orgId: id, onboarding: checklist, offboarding: checklist }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const before = await tx.get(hrConfigRef(input.orgId));
    tx.set(hrConfigRef(input.orgId), { onboarding: input.onboarding, offboarding: input.offboarding, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'hr.setChecklists',
      entityType: 'hrConfig',
      entityId: 'hr',
      before: before.exists ? { onboarding: before.get('onboarding') ?? null, offboarding: before.get('offboarding') ?? null } : null,
      after: { onboarding: input.onboarding, offboarding: input.offboarding },
    });
    return { ok: true };
  },
);
