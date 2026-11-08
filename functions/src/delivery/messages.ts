import type { Transaction, WriteBatch } from 'firebase-admin/firestore';

import { titles } from '../circulation/circulation.js';
import { dateIN } from '../messaging/outbox.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';
import { courierFor } from './couriers.js';
import type { Delivery } from './model.js';

// What home delivery tells the member (docs/WHATSAPP.md), shared by the order modules.

/** "14 Oct 2026, 10:00–13:00" for messages. */
export const dateLabel = (date: string, slot: string | null) => `${dateIN(new Date(`${date}T12:00:00+05:30`))}${slot ? `, ${slot}` : ''}`;

/** Who is bringing the books, for the member's message. */
function deliveredBy(d: Pick<Delivery, 'method' | 'rider' | 'courier' | 'provider'>): string {
  if (d.method === 'OWN' && d.rider) return `${d.rider.name}${d.rider.phone ? ` (${d.rider.phone.replace(/^\+91/, '')})` : ''}`;
  if (d.method === 'MANUAL' && d.courier) return [d.courier.name, d.courier.reference, d.courier.trackingUrl].filter(Boolean).join(' · ');
  const label = courierFor(d.method ?? '')?.label ?? 'courier';
  return d.provider?.trackingUrl ? `${label}, track at ${d.provider.trackingUrl}` : label;
}

/** "Your books are on the way" (or "we're coming to collect"). */
export function queueOut(tx: Transaction | WriteBatch, orgId: string, deliveryId: string, d: Delivery) {
  const sent = d.sent.map((s) => s.bookTitle);
  queueWhatsApp(tx, sent.length
    ? { orgId, branchId: d.branchId, event: 'delivery_out', memberId: d.memberId, vars: { book_titles: titles(sent), delivery_by: deliveredBy(d) }, ref: { deliveryId } }
    : { orgId, branchId: d.branchId, event: 'pickup_out', memberId: d.memberId, vars: { delivery_by: deliveredBy(d) }, ref: { deliveryId } });
}

/** "2 books delivered, 1 collected". */
export const summary = (sent: number, collected: number) =>
  [sent ? `${sent} book${sent === 1 ? '' : 's'} delivered` : '', collected ? `${collected} collected` : ''].filter(Boolean).join(', ') || 'visit done';
