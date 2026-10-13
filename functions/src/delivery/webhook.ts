import { timingSafeEqual } from 'node:crypto';

import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';

import { courierFor, porterStatus } from './couriers.js';
import { type Delivery, deliveriesCol, privateRef } from './model.js';
import { applyTracking, syncOne } from './orders.js';

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The courier's order number in a webhook body, wherever the courier puts it. */
function orderIdOf(body: Record<string, unknown>): string | null {
  const data = (body.data ?? body.order ?? body.payload ?? {}) as Record<string, unknown>;
  const v = body.order_id ?? body.orderId ?? body.crn ?? data.order_id ?? data.orderId ?? data.crn;
  return v ? String(v) : null;
}

/**
 * Courier status updates for a branch: …/deliveryWebhook?o=<orgId>&b=<branchId>&t=<token>.
 * The token (from Settings → Delivery) proves the call is for this branch. The
 * body only says which order changed: Stories then asks the courier for the
 * order itself, and falls back to the event's status if the courier can't answer.
 */
export async function handleDeliveryWebhook(req: Request, res: { status: (n: number) => { send: (b?: unknown) => void } }) {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  const orgId = String(req.query.o ?? '');
  const branchId = String(req.query.b ?? '');
  const token = String(req.query.t ?? '');
  if (!orgId || !branchId || !token) return res.status(400).send('missing branch');
  const secret = await privateRef(orgId, branchId).get();
  const expected = secret.get('webhookToken') as string | undefined;
  if (!expected || !sameToken(token, expected)) return res.status(401).send('bad token');

  let body: Record<string, unknown>;
  try {
    body = (typeof req.body === 'object' && req.body) || JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('bad json');
  }
  const orderId = orderIdOf(body);
  if (!orderId) return res.status(200).send('ignored');
  const found = await deliveriesCol(orgId).where('provider.orderId', '==', orderId).limit(1).get();
  const doc = found.docs[0];
  if (!doc || doc.get('branchId') !== branchId) return res.status(200).send('unknown order');
  try {
    await syncOne(orgId, doc.id, 0);
  } catch (e) {
    // The courier's API didn't answer: use the status the event carries.
    const raw = String(body.status ?? body.event ?? body.event_type ?? (body.data as Record<string, unknown> | undefined)?.status ?? '');
    const d = doc.data() as Delivery;
    const c = courierFor(d.provider?.key ?? '');
    logger.warn('delivery webhook: track failed, using event status', { orderId, raw, error: (e as Error).message });
    if (raw && c) await applyTracking(orgId, doc.id, { status: porterStatus(raw), raw, trackingUrl: null, fareMinor: null, partner: null });
  }
  return res.status(200).send('ok');
}
