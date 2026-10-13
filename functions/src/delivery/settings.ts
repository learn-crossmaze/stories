import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { COURIER_KEYS, COURIERS, type CourierKey } from './couriers.js';
import { DEFAULT_SETTINGS, type DeliverySettings, newWebhookToken, privateRef, settingsOf, settingsSchema } from './model.js';

// Settings → Delivery, per branch (docs/DELIVERY.md §1): fee, PIN codes, time
// slots, the branch's map location, and the ways it delivers — its own staff,
// other couriers updated by hand, and courier apps booked by API (Porter).

const RIDER_ROLES = ['DELIVERY_PERSON', 'BRANCH_MANAGER', 'LIBRARIAN', 'FRANCHISE_OWNER'];

/** Where couriers send status updates for this branch. */
const webhookPath = (orgId: string, branchId: string, token: string) =>
  `deliveryWebhook?o=${encodeURIComponent(orgId)}&b=${encodeURIComponent(branchId)}&t=${token}`;

/**
 * The branch's delivery settings (no secrets), the couriers Stories supports,
 * and who can deliver (staff at the branch with a delivery, librarian, manager
 * or owner role). The webhook URL is shown to those who configure delivery.
 */
export const settings = query('deliveries-settings', z.strictObject({ orgId: id, branchId: id }), async ({ actor, input }) => {
  const configure = await actor.can('delivery.configure', input.orgId, input.branchId);
  if (!configure) await actor.require('delivery.manage', input.orgId, input.branchId);
  const [branch, secret, staff] = await Promise.all([
    db.doc(`orgs/${input.orgId}/branches/${input.branchId}`).get(),
    privateRef(input.orgId, input.branchId).get(),
    db.collectionGroup('memberships').where('orgId', '==', input.orgId).where('status', '==', 'ACTIVE').limit(300).get(),
  ]);
  if (!branch.exists) throw errors.notFound('Branch');
  const riders = staff.docs
    .filter((m) => {
      const branches = (m.get('branchIds') as string[]) ?? [];
      return (branches.includes('*') || branches.includes(input.branchId)) && ((m.get('roles') as string[]) ?? []).some((r) => RIDER_ROLES.includes(r));
    })
    .map((m) => ({
      uid: m.ref.parent.parent!.id,
      name: (m.get('displayName') as string | null) || (m.get('email') as string),
      delivery: ((m.get('roles') as string[]) ?? []).includes('DELIVERY_PERSON'),
    }))
    .sort((a, b) => Number(b.delivery) - Number(a.delivery) || a.name.localeCompare(b.name));
  const token = secret.get('webhookToken') as string | undefined;
  return {
    settings: settingsOf(branch),
    couriers: COURIER_KEYS.map((k) => ({ key: k, label: COURIERS[k].label, kinds: COURIERS[k].kinds })),
    riders,
    webhook: configure && token ? webhookPath(input.orgId, input.branchId, token) : null,
    canConfigure: configure,
  };
});

export const saveSettings = command(
  'deliveries-saveSettings',
  z.strictObject({ orgId: id, branchId: id, ...settingsSchema }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('delivery.configure', input.orgId, input.branchId, tx);
    const ref = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
    const [branch, secret] = await Promise.all([tx.get(ref), tx.get(privateRef(input.orgId, input.branchId))]);
    if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
    const before = settingsOf(branch);

    const couriers: DeliverySettings['couriers'] = {};
    const keys: Record<string, { apiKey: string }> = {};
    for (const k of COURIER_KEYS) {
      const c = input.couriers[k];
      const apiKey = c?.apiKey || ((secret.get(`couriers.${k}.apiKey`) as string | undefined) ?? '');
      if (!c && !apiKey) continue;
      if (c?.enabled && !apiKey) throw errors.invalid(`Paste the ${COURIERS[k].label} API key to switch it on.`);
      if (c?.enabled && !input.location) throw errors.invalid(`${COURIERS[k].label} needs the branch’s map location (pickup point).`);
      couriers[k as CourierKey] = { enabled: !!c?.enabled, environment: c?.environment ?? 'LIVE', hasKey: !!apiKey };
      if (apiKey) keys[k] = { apiKey };
    }
    const anyWay = input.methods.OWN || input.methods.MANUAL || Object.values(couriers).some((c) => c?.enabled);
    if (input.enabled && !anyWay) throw errors.invalid('Switch on at least one way to deliver.');

    const next: DeliverySettings = {
      ...DEFAULT_SETTINGS,
      enabled: input.enabled,
      feeMinor: input.feeMinor,
      pincodes: [...new Set(input.pincodes)].sort(),
      slots: input.slots,
      location: input.location,
      methods: input.methods,
      couriers,
    };
    tx.update(ref, { delivery: { ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, updatedAt: FieldValue.serverTimestamp() });
    tx.set(privateRef(input.orgId, input.branchId), {
      couriers: keys,
      webhookToken: (secret.get('webhookToken') as string | undefined) ?? newWebhookToken(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'branch.delivery', entityType: 'branch', entityId: input.branchId, branchId: input.branchId,
      before: { enabled: before.enabled, feeMinor: before.feeMinor, methods: before.methods, couriers: Object.keys(before.couriers) },
      after: {
        enabled: next.enabled, feeMinor: next.feeMinor, methods: next.methods, pincodes: next.pincodes.length, slots: next.slots,
        couriers: Object.fromEntries(Object.entries(couriers).map(([k, c]) => [k, { enabled: c!.enabled, environment: c!.environment, keyChanged: !!input.couriers[k as CourierKey]?.apiKey }])),
      },
    });
    return { saved: true };
  },
);
