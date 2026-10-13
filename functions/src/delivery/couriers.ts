import { request as httpsRequest } from 'node:https';

// Courier apps that Stories can book through their API (docs/DELIVERY.md §4).
// Each branch switches them on under Settings → Delivery with its own API key.
// A courier is an adapter with four calls (quote, book, track, cancel);
// adding another one (Borzo, Shadowfax, Uber Direct…) means one more adapter
// here and its entry in COURIERS — the delivery flow does not change.

export interface Point {
  lat: number;
  lng: number;
}

/** One end of a trip, as couriers want it. */
export interface Stop {
  geo: Point;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface Trip {
  /** Our delivery id: sent as the courier's request id so a retried booking is not booked twice. */
  requestId: string;
  pickup: Stop;
  drop: Stop;
  instructions: string;
}

export interface Fare {
  vehicle: string;
  fareMinor: number;
  etaMinutes: number | null;
}

/**
 * Where the courier's order is, in Stories' words:
 * BOOKED (looking for a rider) → ASSIGNED (rider on the way to pick up) →
 * IN_TRANSIT (picked up) → DELIVERED (dropped), or CANCELLED by the courier.
 */
export type CourierStatus = 'BOOKED' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | 'UNKNOWN';

export interface Booking {
  orderId: string;
  trackingUrl: string | null;
  fareMinor: number | null;
}

export interface Tracking {
  status: CourierStatus;
  raw: string;
  trackingUrl: string | null;
  fareMinor: number | null;
  partner: { name: string | null; phone: string | null; vehicleNumber: string | null } | null;
}

export interface Connection {
  apiKey: string;
  environment: 'LIVE' | 'TEST';
}

export interface Courier {
  key: CourierKey;
  label: string;
  /** Couriers carry one way (A → B): home delivery and pickups, not an exchange in one trip. */
  kinds: readonly ('DELIVER' | 'PICKUP')[];
  quote(conn: Connection, trip: Omit<Trip, 'requestId' | 'instructions'>): Promise<Fare[]>;
  book(conn: Connection, trip: Trip): Promise<Booking>;
  track(conn: Connection, orderId: string): Promise<Tracking>;
  cancel(conn: Connection, orderId: string): Promise<void>;
}

/** A courier refused or could not be reached; the message is safe to show staff. */
export class CourierError extends Error {
  constructor(
    readonly courier: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ transport

export interface HttpReply {
  status: number;
  body: string;
}
export type Transport = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, body: string | null) => Promise<HttpReply>;

const TIMEOUT_MS = 12_000;

/** HTTPS with a body on any method (Porter's quote is a GET with a JSON body, which fetch() refuses). */
const https: Transport = (method, url, headers, body) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}) }, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

let transport: Transport = https;
/** For tests: send courier calls somewhere else. */
export function setCourierTransport(t: Transport | null) {
  transport = t ?? https;
}

// ------------------------------------------------------------------ Porter

/**
 * Porter (porter.in) API v1, two-wheelers. Credentials come from Porter's API
 * integrations form (porter.in/api-integrations). Header `x-api-key`.
 * Production pfe-apigw.porter.in; UAT pfe-apigw-uat.porter.in (with an order simulator).
 */
export const PORTER_HOSTS = { LIVE: 'https://pfe-apigw.porter.in', TEST: 'https://pfe-apigw-uat.porter.in' } as const;

const minor = (v: unknown): number | null => {
  const n = (v as { minor_amount?: unknown } | null | undefined)?.minor_amount;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
};

/** Porter's order states and webhook events, mapped to ours (unknown values are kept as they come). */
export function porterStatus(raw: string): CourierStatus {
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (['open', 'created', 'booked', 'order_created', 'order_reopened', 'reopened'].includes(s)) return 'BOOKED';
  if (['accepted', 'allotted', 'order_accepted'].includes(s)) return 'ASSIGNED';
  if (['live', 'started', 'in_progress', 'picked_up', 'order_start_trip'].includes(s)) return 'IN_TRANSIT';
  if (['ended', 'completed', 'delivered', 'order_end_job', 'order_ended'].includes(s)) return 'DELIVERED';
  if (['cancelled', 'canceled', 'order_cancel', 'order_cancelled'].includes(s)) return 'CANCELLED';
  return 'UNKNOWN';
}

async function porter<T>(conn: Connection, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let reply: HttpReply;
  try {
    reply = await transport(method, `${PORTER_HOSTS[conn.environment]}${path}`, { 'x-api-key': conn.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body ? JSON.stringify(body) : null);
  } catch {
    throw new CourierError('Porter', 0, "Porter didn't answer. Try again in a minute.");
  }
  let json: Record<string, unknown> = {};
  try {
    json = reply.body ? (JSON.parse(reply.body) as Record<string, unknown>) : {};
  } catch {
    // Not JSON (e.g. a gateway error page).
  }
  if (reply.status === 401 || reply.status === 403) {
    throw new CourierError('Porter', reply.status, 'Porter rejected the API key. Check it under Settings → Delivery (live keys work only with Live, test keys with Test).');
  }
  if (reply.status < 200 || reply.status >= 300) {
    const message = String(json.message ?? (json.error as { message?: string } | undefined)?.message ?? json.error ?? `Porter answered ${reply.status}.`);
    throw new CourierError('Porter', reply.status, `Porter: ${message}`);
  }
  return json as T;
}

const porterAddress = (s: Stop) => ({
  apartment_address: s.line2,
  street_address1: s.line1,
  street_address2: '',
  landmark: s.landmark,
  city: s.city,
  state: s.state,
  pincode: s.postalCode,
  country: 'India',
  lat: s.geo.lat,
  lng: s.geo.lng,
  contact_details: { name: s.name, phone_number: s.phone },
});

const PORTER: Courier = {
  key: 'PORTER',
  label: 'Porter',
  kinds: ['DELIVER', 'PICKUP'],
  async quote(conn, trip) {
    const res = await porter<{ vehicles?: { type?: string; fare?: unknown; eta?: { value?: number; unit?: string } | null }[] }>(conn, 'GET', '/v1/get_quote', {
      pickup_details: { lat: trip.pickup.geo.lat, lng: trip.pickup.geo.lng },
      drop_details: { lat: trip.drop.geo.lat, lng: trip.drop.geo.lng },
      customer: { name: trip.drop.name, mobile: { country_code: '+91', number: trip.drop.phone.replace(/^\+91/, '') } },
    });
    return (res.vehicles ?? [])
      .map((v) => ({
        vehicle: String(v.type ?? 'Vehicle'),
        fareMinor: minor(v.fare) ?? 0,
        etaMinutes: typeof v.eta?.value === 'number' ? Math.round(v.eta.unit?.startsWith('s') ? v.eta.value / 60 : v.eta.value) : null,
      }))
      .filter((f) => f.fareMinor > 0);
  },
  async book(conn, trip) {
    const res = await porter<Record<string, unknown>>(conn, 'POST', '/v1/orders/create', {
      request_id: trip.requestId,
      delivery_instructions: { instructions_list: trip.instructions ? [{ type: 'text', description: trip.instructions }] : [] },
      pickup_details: { address: porterAddress(trip.pickup) },
      drop_details: { address: porterAddress(trip.drop) },
      additional_comments: trip.instructions,
    });
    const orderId = String(res.order_id ?? '');
    if (!orderId) throw new CourierError('Porter', 200, 'Porter did not return an order number. Check the order in Porter before booking again.');
    return { orderId, trackingUrl: (res.tracking_url as string | undefined) ?? null, fareMinor: minor(res.estimated_fare_details) ?? minor(res.estimated_price) };
  },
  async track(conn, orderId) {
    const res = await porter<Record<string, unknown>>(conn, 'GET', `/v1/orders/${encodeURIComponent(orderId)}`);
    const raw = String(res.status ?? '');
    const fare = res.fare_details as { actual_fare_details?: unknown; estimated_fare_details?: unknown } | undefined;
    const p = res.partner_info as { name?: string; phone_number?: string; mobile?: { country_code?: string; mobile_number?: string }; vehicle_number?: string } | undefined;
    const phone = p?.phone_number ?? (p?.mobile?.mobile_number ? `${p.mobile.country_code ?? '+91'}${p.mobile.mobile_number}` : null);
    return {
      status: porterStatus(raw),
      raw,
      trackingUrl: (res.tracking_url as string | undefined) ?? null,
      fareMinor: minor(fare?.actual_fare_details) ?? minor(fare?.estimated_fare_details),
      partner: p ? { name: p.name ?? null, phone: phone ?? null, vehicleNumber: p.vehicle_number ?? null } : null,
    };
  },
  async cancel(conn, orderId) {
    await porter(conn, 'POST', `/v1/orders/${encodeURIComponent(orderId)}/cancel`, {});
  },
};

/** Every courier Stories can book by API. */
export const COURIERS = { PORTER } as const;
export type CourierKey = 'PORTER';
export const COURIER_KEYS = Object.keys(COURIERS) as [CourierKey, ...CourierKey[]];
export const courierFor = (key: string): Courier | null => (COURIERS as Record<string, Courier>)[key] ?? null;
