// Home delivery (functions/src/delivery, docs/DELIVERY.md).
import { call, command } from './api';

export type DeliveryKind = 'DELIVER' | 'PICKUP' | 'EXCHANGE';
export type DeliveryStatus = 'REQUESTED' | 'OUT' | 'RETURNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type DeliveryMethod = 'OWN' | 'MANUAL' | 'PORTER';
export interface Geo {
  lat: number;
  lng: number;
}
export interface DeliveryAddress {
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  postalCode: string;
  geo: Geo | null;
}
export interface Item {
  loanId: string;
  copyId: string;
  copyCode: string;
  bookTitle: string;
}

export interface Delivery {
  id: string;
  branchId: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  phone: string | null;
  kind: DeliveryKind;
  status: DeliveryStatus;
  address: DeliveryAddress;
  date: string;
  slot: string | null;
  note: string;
  holdIds: string[];
  holdTitles?: string[];
  collectLoanIds: string[];
  collectTitles?: string[];
  sent: Item[];
  collected: Item[];
  fee: { amountMinor: number; status: 'FREE' | 'DUE' | 'PAID'; paymentId?: string | null; method?: string | null };
  method: DeliveryMethod | null;
  rider: { uid: string; name: string; phone: string | null } | null;
  courier: { name: string; reference: string; trackingUrl: string | null } | null;
  provider: {
    key: string;
    orderId: string | null;
    status: string;
    raw: string | null;
    trackingUrl: string | null;
    fareMinor: number | null;
    partner: { name: string | null; phone: string | null; vehicleNumber: string | null } | null;
    error: string | null;
    syncedAt?: string;
  } | null;
  outcome: 'DELIVERED' | 'FAILED' | null;
  failReason: string | null;
  handedTo?: string | null;
  cancelReason?: string | null;
  requestedBy: 'MEMBER' | 'STAFF';
  requestedAt: string;
  dispatchedAt?: string;
  closedAt?: string;
}

export interface DeliverySettings {
  enabled: boolean;
  feeMinor: number;
  pincodes: string[];
  slots: string[];
  location: Geo | null;
  methods: { OWN: boolean; MANUAL: boolean };
  couriers: Partial<Record<string, { enabled: boolean; environment: 'LIVE' | 'TEST'; hasKey: boolean }>>;
}
export interface SettingsView {
  settings: DeliverySettings;
  couriers: { key: string; label: string; kinds: string[] }[];
  riders: { uid: string; name: string; delivery: boolean }[];
  webhook: string | null;
  canConfigure: boolean;
}
export interface MemberLoan {
  loanId: string;
  copyCode: string;
  bookTitle: string;
  deliveryId?: string | null;
}

export const OPEN: DeliveryStatus[] = ['REQUESTED', 'OUT', 'RETURNING'];
const at = (orgId: string, branchId: string) => ({ orgId, branchId });

export const deliverySettings = (orgId: string, branchId: string) => call<SettingsView>('deliveries-settings', at(orgId, branchId));
export const saveDeliverySettings = (orgId: string, branchId: string, s: Omit<DeliverySettings, 'couriers'> & { couriers: Record<string, { enabled: boolean; environment: 'LIVE' | 'TEST'; apiKey: string }> }) =>
  command('deliveries-saveSettings', { ...at(orgId, branchId), ...s });
export const listDeliveries = (orgId: string, branchId: string) => call<{ open: Delivery[]; closed: Delivery[] }>('deliveries-list', at(orgId, branchId));
export const getDelivery = (orgId: string, deliveryId: string) =>
  call<{ delivery: Delivery; memberLoans: MemberLoan[]; holds: { reservationId: string; bookTitle: string; copyCode: string | null }[] }>('deliveries-get', { orgId, deliveryId });
export const myDeliveries = (orgId: string) => call<{ deliveries: (Delivery & { memberLoans: MemberLoan[] })[] }>('deliveries-mine', { orgId });

export interface RequestInput {
  branchId: string;
  memberId: string;
  kind: DeliveryKind;
  date: string;
  slot: string | null;
  address: DeliveryAddress;
  note: string;
  holdIds: string[];
  collectLoanIds: string[];
}
export const createDelivery = (orgId: string, r: RequestInput) => command<{ deliveryId: string }>('deliveries-create', { orgId, ...r });
export const requestDelivery = (orgId: string, r: RequestInput) => command<{ deliveryId: string }>('me-requestDelivery', { orgId, ...r });
export const cancelMyDelivery = (orgId: string, deliveryId: string) => command('me-cancelDelivery', { orgId, deliveryId });

export const dispatchDelivery = (
  orgId: string,
  deliveryId: string,
  d: { barcodes: string[]; method: DeliveryMethod; riderUid: string | null; courier: { name: string; reference: string; trackingUrl: string } | null; waiveFee: boolean },
) => command<{ book: string | null }>('deliveries-dispatch', { orgId, deliveryId, ...d });
export const quoteCourier = (orgId: string, deliveryId: string, courier: string) =>
  call<{ fares: { vehicle: string; fareMinor: number; etaMinutes: number | null }[] }>('deliveries-quote', { orgId, deliveryId, courier });
export const bookCourier = (orgId: string, deliveryId: string) => call('deliveries-book', { orgId, deliveryId });
export const syncDeliveries = (orgId: string, branchId: string, deliveryId: string | null = null) =>
  call<{ updated: Record<string, string>; failed: number }>('deliveries-sync', { ...at(orgId, branchId), deliveryId });
export const reportDelivery = (
  orgId: string,
  deliveryId: string,
  r: { outcome: 'DELIVERED' | 'FAILED'; collectedLoanIds: string[]; failReason: string; handedTo: string; fee: { method: string; reference: string } | null },
) => command<{ status: DeliveryStatus }>('deliveries-report', { orgId, deliveryId, ...r });
export const receiveDelivery = (orgId: string, deliveryId: string) => command<{ status: DeliveryStatus; returned: number }>('deliveries-receive', { orgId, deliveryId });
export const cancelDelivery = (orgId: string, deliveryId: string, reason: string) => command('deliveries-cancel', { orgId, deliveryId, reason });
export const recordDeliveryFee = (orgId: string, deliveryId: string, method: string, reference: string) =>
  command('deliveries-recordFee', { orgId, deliveryId, method, reference });

/** Coordinates from "12.97, 77.59" or a Google Maps link (same rules as the server). */
export function coordsFromText(text: string): Geo | null {
  let t = text.trim();
  try {
    t = decodeURIComponent(t);
  } catch {
    // Keep it as typed.
  }
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

/** The device's current position (members and riders share where they are). */
export const currentPosition = () =>
  new Promise<Geo>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share a location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      () => reject(new Error('Location permission was not given.')),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });

/** A link that opens the address in Google Maps (pin if known, else the address). */
export const mapsLink = (a: DeliveryAddress) =>
  a.geo
    ? `https://www.google.com/maps/search/?api=1&query=${a.geo.lat},${a.geo.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.line1, a.line2, a.landmark, a.city, a.postalCode].filter(Boolean).join(', '))}`;

/** Today and n days ahead in India (YYYY-MM-DD). */
export function istDate(offsetDays = 0, now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
export const oneLine = (a: DeliveryAddress) => [a.line1, a.line2, a.landmark, a.city, a.postalCode].filter(Boolean).join(', ');
