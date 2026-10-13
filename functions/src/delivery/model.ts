import { randomBytes } from 'node:crypto';

import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { address } from '../core/schemas.js';
import { COURIER_KEYS, type Connection, type CourierKey, courierFor } from './couriers.js';

// Home delivery (docs/DELIVERY.md). A delivery is one visit to a member:
// DELIVER (books to them), PICKUP (books back) or EXCHANGE (both). It is done
// by the branch's own rider, by any other courier entered by hand, or by a
// courier app booked through its API (Porter).
//
//   REQUESTED ──dispatch──▶ OUT ──rider/courier reports──▶ RETURNING ──branch receives──▶ COMPLETED / FAILED
//       │                   │                                  (only when books come back)
//       └──cancel──▶ CANCELLED   └─▶ COMPLETED (nothing to bring back) / FAILED (nothing was sent)

export const KINDS = ['DELIVER', 'PICKUP', 'EXCHANGE'] as const;
export type Kind = (typeof KINDS)[number];
export const OPEN_STATUSES = ['REQUESTED', 'OUT', 'RETURNING'] as const;
export type Status = (typeof OPEN_STATUSES)[number] | 'COMPLETED' | 'FAILED' | 'CANCELLED';
/** OWN: the branch's own staff; MANUAL: any courier, updated by hand; PORTER…: booked through the courier's API. */
export const METHODS = ['OWN', 'MANUAL', ...COURIER_KEYS] as const;
export type Method = (typeof METHODS)[number];

export const MAX_DAYS_AHEAD = 14;
export const FEE_METHODS = ['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_CARD'] as const;

export const geo = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const deliveryAddress = address.extend({
  landmark: z.string().trim().max(120).default(''),
  geo: geo.nullable().default(null),
});
export type DeliveryAddress = z.infer<typeof deliveryAddress>;
const slot = z.string().trim().min(3).max(40);
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');

/** Public settings on the branch document (`delivery`); secrets are in private/delivery. */
export interface DeliverySettings {
  enabled: boolean;
  /** Charged per visit to the member, in paise (0 = free). */
  feeMinor: number;
  /** PIN codes the branch delivers to (empty = any). */
  pincodes: string[];
  /** Time windows members can choose, e.g. "10:00–13:00" (empty = no slots, staff call to fix a time). */
  slots: string[];
  /** The branch's map location: couriers need it as the pickup point. */
  location: { lat: number; lng: number } | null;
  /** Ways the branch delivers. */
  methods: { OWN: boolean; MANUAL: boolean };
  couriers: Partial<Record<CourierKey, { enabled: boolean; environment: 'LIVE' | 'TEST'; hasKey: boolean }>>;
}

export const DEFAULT_SETTINGS: DeliverySettings = {
  enabled: false,
  feeMinor: 0,
  pincodes: [],
  slots: [],
  location: null,
  methods: { OWN: true, MANUAL: true },
  couriers: {},
};

export const settingsOf = (branch: DocumentSnapshot): DeliverySettings => {
  const s = (branch.get('delivery') as Partial<DeliverySettings> | undefined) ?? {};
  return { ...DEFAULT_SETTINGS, ...s, methods: { ...DEFAULT_SETTINGS.methods, ...(s.methods ?? {}) }, couriers: s.couriers ?? {} };
};

/** What members see about a branch's delivery service. */
export const publicSettings = (s: DeliverySettings) => ({
  enabled: s.enabled,
  feeMinor: s.feeMinor,
  pincodes: s.pincodes,
  slots: s.slots,
  maxDaysAhead: MAX_DAYS_AHEAD,
});

export const settingsSchema = {
  enabled: z.boolean(),
  feeMinor: z.number().int().min(0).max(1_000_000),
  pincodes: z.array(z.string().trim().regex(/^\d{6}$/, 'must be 6-digit PIN codes')).max(300).default([]),
  slots: z.array(slot).max(8).default([]),
  location: geo.nullable().default(null),
  methods: z.strictObject({ OWN: z.boolean(), MANUAL: z.boolean() }),
  couriers: z
    .partialRecord(z.enum(COURIER_KEYS), z.strictObject({ enabled: z.boolean(), environment: z.enum(['LIVE', 'TEST']), apiKey: z.string().trim().max(400).default('') }))
    .default({}),
};

export const privateRef = (orgId: string, branchId: string) => db.doc(`orgs/${orgId}/branches/${branchId}/private/delivery`);
export const deliveriesCol = (orgId: string) => db.collection(`orgs/${orgId}/deliveries`);
export const newWebhookToken = () => randomBytes(18).toString('hex');

/** A courier's API connection for a branch (reads only). */
export async function courierConnection(orgId: string, branchId: string, key: string, tx?: Pick<Transaction, 'get'>): Promise<Connection> {
  const ref = db.doc(`orgs/${orgId}/branches/${branchId}`);
  const [branch, secret] = await Promise.all([tx ? tx.get(ref) : ref.get(), tx ? tx.get(privateRef(orgId, branchId)) : privateRef(orgId, branchId).get()]);
  const c = settingsOf(branch).couriers[key as CourierKey];
  const apiKey = secret.get(`couriers.${key}.apiKey`) as string | undefined;
  if (!courierFor(key) || !c?.enabled || !apiKey) {
    throw errors.conflict('COURIER_OFF', `${courierFor(key)?.label ?? key} is not set up for this branch. Add its API key under Settings → Delivery.`);
  }
  return { apiKey, environment: c.environment };
}

/**
 * Reads coordinates from what staff or members paste: "12.97, 77.59", or a
 * Google Maps link (…/@12.97,77.59,17z, ?q=12.97,77.59, !3d12.97!4d77.59).
 */
export function coordsFromText(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.trim());
  const patterns = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Today in India as YYYY-MM-DD, and n days later. */
export function istDate(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getTime() + 5.5 * 3_600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export interface Item {
  loanId: string;
  copyId: string;
  copyCode: string;
  bookTitle: string;
}

export interface Delivery {
  branchId: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  phone: string | null;
  kind: Kind;
  status: Status;
  address: DeliveryAddress;
  date: string;
  slot: string | null;
  note: string;
  holdIds: string[];
  collectLoanIds: string[];
  sent: Item[];
  collected: Item[];
  fee: { amountMinor: number; status: 'FREE' | 'DUE' | 'PAID'; paymentId?: string | null; method?: string | null };
  method: Method | null;
  rider: { uid: string; name: string; phone: string | null } | null;
  courier: { name: string; reference: string; trackingUrl: string | null } | null;
  provider: {
    key: CourierKey;
    orderId: string | null;
    status: string;
    raw: string | null;
    trackingUrl: string | null;
    fareMinor: number | null;
    partner: { name: string | null; phone: string | null; vehicleNumber: string | null } | null;
    error: string | null;
  } | null;
  outcome: 'DELIVERED' | 'FAILED' | null;
  failReason: string | null;
  requestedBy: 'MEMBER' | 'STAFF';
}
