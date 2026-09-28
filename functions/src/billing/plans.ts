import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import { AGE_GROUPS, money } from '../catalogue/model.js';
import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';

export const DURATIONS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 } as const;
export type Duration = keyof typeof DURATIONS;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');

const terms = {
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  duration: z.enum(Object.keys(DURATIONS) as [Duration, ...Duration[]]),
  priceMinor: money,
  depositMinor: money,
  maxSimultaneousBooks: z.number().int().min(1).max(20),
  audiences: z.array(z.enum(AGE_GROUPS)).min(1).max(3),
  deliveryEligible: z.boolean().default(false),
  promo: z
    .strictObject({ priceMinor: money, from: date, to: date })
    .refine((p) => p.from <= p.to, 'promotion must end after it starts')
    .nullable()
    .default(null),
  renewalWindowDays: z.number().int().min(0).max(90).default(30),
};
const termsSchema = z.strictObject(terms);
export type PlanTerms = z.infer<typeof termsSchema>;

export interface Plan extends PlanTerms {
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
}

/** Price that applies today (promotion if the date is inside its window, IST). */
export function effectivePrice(plan: PlanTerms, now = new Date()): number {
  if (!plan.promo) return plan.priceMinor;
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return today >= plan.promo.from && today <= plan.promo.to ? plan.promo.priceMinor : plan.priceMinor;
}

/**
 * Creates a plan. Plans are versioned: an edit writes a new version, and each
 * subscription keeps a snapshot of the terms it was sold under.
 */
export const create = command('plans-create', z.strictObject({ orgId: id, ...terms }), async ({ actor, input, requestId }, tx) => {
  await actor.require('plans.manage', input.orgId, undefined, tx);
  const { orgId, ...planTerms } = input;
  const ref = db.collection(`orgs/${orgId}/plans`).doc();
  const plan = { ...planTerms, status: 'ACTIVE', version: 1 };
  tx.create(ref, { ...plan, effectiveFrom: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  tx.create(db.doc(`${ref.path}/versions/1`), { ...planTerms, version: 1, createdBy: actor.uid, at: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
    action: 'plan.create', entityType: 'plan', entityId: ref.id, after: plan,
  });
  return { planId: ref.id };
});

/** Publishes new terms as the next version. Existing subscriptions are unaffected. */
export const update = command(
  'plans-update',
  z.strictObject({ orgId: id, planId: id, ...terms }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('plans.manage', input.orgId, undefined, tx);
    const { orgId, planId, ...planTerms } = input;
    const ref = db.doc(`orgs/${orgId}/plans/${planId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Plan');
    if (snap.get('status') !== 'ACTIVE') throw errors.conflict('PLAN_ARCHIVED', 'Archived plans cannot be edited.');
    const version = (snap.get('version') as number) + 1;
    tx.update(ref, { ...planTerms, version, effectiveFrom: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.doc(`${ref.path}/versions/${version}`), { ...planTerms, version, createdBy: actor.uid, at: FieldValue.serverTimestamp() });
    const before = snap.data() as Plan;
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
      action: 'plan.update', entityType: 'plan', entityId: planId,
      before: { version: before.version, priceMinor: before.priceMinor, depositMinor: before.depositMinor, maxSimultaneousBooks: before.maxSimultaneousBooks },
      after: { version, priceMinor: planTerms.priceMinor, depositMinor: planTerms.depositMinor, maxSimultaneousBooks: planTerms.maxSimultaneousBooks },
    });
    return { planId, version };
  },
);

/** Stops selling a plan. Members on it keep their terms until expiry. */
export const archive = command('plans-archive', z.strictObject({ orgId: id, planId: id, reason }), async ({ actor, input, requestId }, tx) => {
  await actor.require('plans.manage', input.orgId, undefined, tx);
  const ref = db.doc(`orgs/${input.orgId}/plans/${input.planId}`);
  if (!(await tx.get(ref)).exists) throw errors.notFound('Plan');
  tx.update(ref, { status: 'ARCHIVED', archivedAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'plan.archive', entityType: 'plan', entityId: input.planId, reason: input.reason,
  });
  return { planId: input.planId };
});
