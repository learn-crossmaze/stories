import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import { AGE_GROUPS, money } from '../catalogue/model.js';
import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { dateKeyIST } from '../core/time.js';
import { id, reason } from '../core/schemas.js';

export const DURATIONS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 } as const;
export type Duration = keyof typeof DURATIONS;
const DURATION_KEYS = Object.keys(DURATIONS) as [Duration, ...Duration[]];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');

/** One way to pay for a plan: a billing period and its price. */
const option = z.strictObject({ duration: z.enum(DURATION_KEYS), priceMinor: money });
export type PlanOption = z.infer<typeof option>;

/**
 * A promotional discount inside a date window (IST): an amount off (paise) or
 * a percentage off, on every billing option or only on some.
 */
const discount = z
  .strictObject({
    type: z.enum(['AMOUNT', 'PERCENT']),
    /** Paise for AMOUNT; 1–90 for PERCENT. */
    value: z.number().int().min(1),
    from: date,
    to: date,
    /** Billing options it applies to; empty = all. */
    durations: z.array(z.enum(DURATION_KEYS)).max(4).default([]),
    label: z.string().trim().max(40).default(''),
  })
  .refine((d) => d.from <= d.to, 'the discount must end after it starts')
  .refine((d) => d.type !== 'PERCENT' || d.value <= 90, 'a percentage discount is at most 90%');
export type Discount = z.infer<typeof discount>;

const terms = {
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  /** 1–4 billing options (monthly, quarterly, half-yearly, yearly), each at most once. */
  options: z
    .array(option)
    .min(1)
    .max(4)
    .refine((o) => new Set(o.map((x) => x.duration)).size === o.length, 'each billing period can appear once'),
  depositMinor: money,
  maxSimultaneousBooks: z.number().int().min(1).max(20),
  audiences: z.array(z.enum(AGE_GROUPS)).min(1).max(3),
  deliveryEligible: z.boolean().default(false),
  discount: discount.nullable().default(null),
  renewalWindowDays: z.number().int().min(0).max(90).default(30),
};
const termsSchema = z.strictObject(terms);
export type PlanTerms = z.infer<typeof termsSchema>;

/** A plan as stored. Plans made before billing options had one `duration` and `priceMinor`, and maybe a `promo` price. */
export interface Plan extends Omit<PlanTerms, 'options' | 'discount'> {
  options?: PlanOption[];
  discount?: Discount | null;
  duration?: Duration;
  priceMinor?: number;
  promo?: { priceMinor: number; from: string; to: string } | null;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
}

/** A plan's billing options, shortest first (older plans have exactly one). */
export function planOptions(plan: Pick<Plan, 'options' | 'duration' | 'priceMinor'>): PlanOption[] {
  const list = plan.options?.length ? plan.options : plan.duration ? [{ duration: plan.duration, priceMinor: plan.priceMinor ?? 0 }] : [];
  return [...list].sort((a, b) => DURATIONS[a.duration] - DURATIONS[b.duration]);
}

export interface Price {
  duration: Duration;
  months: number;
  listPriceMinor: number;
  discountMinor: number;
  priceMinor: number;
  /** "10% off" / "Rs. 100 off", when a discount applies today. */
  discountLabel: string | null;
}

/** What an option costs today: its price, less a promotional discount running today (whole rupees, never below zero). */
export function priceFor(plan: Pick<Plan, 'options' | 'duration' | 'priceMinor' | 'discount' | 'promo'>, duration: Duration, now = new Date()): Price {
  const opt = planOptions(plan).find((o) => o.duration === duration);
  if (!opt) throw errors.invalid('This plan has no such billing option.');
  const list = opt.priceMinor;
  const today = dateKeyIST(now);
  let off = 0;
  let label: string | null = null;
  const d = plan.discount;
  if (d && today >= d.from && today <= d.to && (!d.durations.length || d.durations.includes(duration))) {
    off = d.type === 'AMOUNT' ? d.value : Math.round((list * d.value) / 100 / 100) * 100;
    label = d.label || (d.type === 'PERCENT' ? `${d.value}% off` : `Rs. ${(d.value / 100).toLocaleString('en-IN')} off`);
  } else if (!d && plan.promo && today >= plan.promo.from && today <= plan.promo.to) {
    // Older plans: a fixed promotional price.
    off = list - plan.promo.priceMinor;
    label = 'Offer price';
  }
  off = Math.max(0, Math.min(off, list));
  return { duration, months: DURATIONS[duration], listPriceMinor: list, discountMinor: off, priceMinor: list - off, discountLabel: off ? label : null };
}

/** Today's prices for every option of a plan. */
export const pricesFor = (plan: Parameters<typeof priceFor>[0], now = new Date()) => planOptions(plan).map((o) => priceFor(plan, o.duration, now));

function checkDiscount(input: PlanTerms) {
  const d = input.discount;
  if (!d) return;
  const offered = input.options.map((o) => o.duration);
  const missing = d.durations.filter((x) => !offered.includes(x));
  if (missing.length) throw errors.invalid('The discount names a billing period this plan does not offer.');
  if (d.type === 'AMOUNT') {
    const covered = input.options.filter((o) => !d.durations.length || d.durations.includes(o.duration));
    if (covered.some((o) => d.value >= o.priceMinor)) throw errors.invalid('The discount must be less than the price of every option it applies to.');
  }
}

const sorted = (input: PlanTerms): PlanTerms => ({ ...input, options: planOptions(input) });

/**
 * Creates a plan. Plans are versioned: an edit writes a new version, and each
 * subscription keeps a snapshot of the terms it was sold under.
 */
export const create = command('plans-create', z.strictObject({ orgId: id, ...terms }), async ({ actor, input, requestId }, tx) => {
  await actor.require('plans.manage', input.orgId, undefined, tx);
  const { orgId, ...rest } = input;
  checkDiscount(rest);
  const planTerms = sorted(rest);
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
    const { orgId, planId, ...rest } = input;
    checkDiscount(rest);
    const planTerms = sorted(rest);
    const ref = db.doc(`orgs/${orgId}/plans/${planId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Plan');
    if (snap.get('status') !== 'ACTIVE') throw errors.conflict('PLAN_ARCHIVED', 'Archived plans cannot be edited.');
    const version = (snap.get('version') as number) + 1;
    // Older single-option fields are dropped once the plan has options.
    tx.update(ref, { ...planTerms, duration: FieldValue.delete(), priceMinor: FieldValue.delete(), promo: FieldValue.delete(), version, effectiveFrom: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.doc(`${ref.path}/versions/${version}`), { ...planTerms, version, createdBy: actor.uid, at: FieldValue.serverTimestamp() });
    const before = snap.data() as Plan;
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
      action: 'plan.update', entityType: 'plan', entityId: planId,
      before: { version: before.version, options: planOptions(before), discount: before.discount ?? null, depositMinor: before.depositMinor, maxSimultaneousBooks: before.maxSimultaneousBooks },
      after: { version, options: planTerms.options, discount: planTerms.discount, depositMinor: planTerms.depositMinor, maxSimultaneousBooks: planTerms.maxSimultaneousBooks },
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
