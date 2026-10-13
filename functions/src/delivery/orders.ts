import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { currentTerm, requireActiveTerm } from '../billing/term.js';
import { checkLimit, readIssue, readReturns, titles, writeIssue, writeReturns } from '../circulation/circulation.js';
import { recordAudit } from '../core/audit.js';
import { type CallContext, command, query } from '../core/callable.js';
import { AppError, errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import { loadMember } from '../members/members.js';
import type { Member } from '../members/model.js';
import { dateIN } from '../messaging/outbox.js';
import { queueWhatsApp, rupeesText } from '../messaging/whatsapp.js';
import { type CourierStatus, CourierError, courierFor, type Stop, type Tracking } from './couriers.js';
import {
  courierConnection,
  dateKey,
  type Delivery,
  deliveriesCol,
  deliveryAddress,
  FEE_METHODS,
  istDate,
  type Item,
  KINDS,
  MAX_DAYS_AHEAD,
  METHODS,
  type Method,
  OPEN_STATUSES,
  settingsOf,
} from './model.js';

// Home delivery orders (docs/DELIVERY.md §2–3). Books that leave the branch
// are issued to the member when they are dispatched (they count towards the
// plan from then on); books that come back are returned when the branch
// receives them, through the circulation desk's own code.

const branchRef = (orgId: string, branchId: string) => db.doc(`orgs/${orgId}/branches/${branchId}`);
const sends = (kind: string) => kind !== 'PICKUP';
const collects = (kind: string) => kind !== 'DELIVER';
const isCourier = (m: string | null) => !!m && m !== 'OWN' && m !== 'MANUAL';

/** "14 Oct 2026, 10:00–13:00" for messages. */
export const dateLabel = (date: string, slot: string | null) => `${dateIN(new Date(`${date}T12:00:00+05:30`))}${slot ? `, ${slot}` : ''}`;

/** Firestore values → JSON the app can read (timestamps as ISO strings). */
function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
export const row = (d: DocumentSnapshot) => plain({ id: d.id, ...d.data() }) as Record<string, unknown>;

/** Who is bringing the books, for the member's message. */
function deliveredBy(d: Pick<Delivery, 'method' | 'rider' | 'courier' | 'provider'>): string {
  if (d.method === 'OWN' && d.rider) return `${d.rider.name}${d.rider.phone ? ` (${d.rider.phone.replace(/^\+91/, '')})` : ''}`;
  if (d.method === 'MANUAL' && d.courier) return [d.courier.name, d.courier.reference, d.courier.trackingUrl].filter(Boolean).join(' · ');
  const label = courierFor(d.method ?? '')?.label ?? 'courier';
  return d.provider?.trackingUrl ? `${label}, track at ${d.provider.trackingUrl}` : label;
}

function queueOut(tx: Transaction | FirebaseFirestore.WriteBatch, orgId: string, deliveryId: string, d: Delivery) {
  const sent = d.sent.map((s) => s.bookTitle);
  queueWhatsApp(tx, sent.length
    ? { orgId, branchId: d.branchId, event: 'delivery_out', memberId: d.memberId, vars: { book_titles: titles(sent), delivery_by: deliveredBy(d) }, ref: { deliveryId } }
    : { orgId, branchId: d.branchId, event: 'pickup_out', memberId: d.memberId, vars: { delivery_by: deliveredBy(d) }, ref: { deliveryId } });
}

const summary = (sent: number, collected: number) =>
  [sent ? `${sent} book${sent === 1 ? '' : 's'} delivered` : '', collected ? `${collected} collected` : ''].filter(Boolean).join(', ') || 'visit done';

// ------------------------------------------------------------------ request

export const requestSchema = z.strictObject({
  orgId: id,
  branchId: id,
  memberId: id,
  kind: z.enum(KINDS),
  date: dateKey,
  slot: z.string().trim().max(40).nullable().default(null),
  address: deliveryAddress,
  note: z.string().trim().max(300).default(''),
  holdIds: z.array(id).max(10).default([]),
  collectLoanIds: z.array(id).max(10).default([]),
});

/** Whether the member's plan includes home delivery: the current term, else (for a pickup) the latest one. */
async function planAllowsDelivery(tx: Transaction, orgId: string, memberId: string, member: Member, kind: string) {
  const term = await currentTerm(tx, orgId, member);
  if (sends(kind)) {
    if (!term) throw errors.conflict('NO_ACTIVE_SUBSCRIPTION', 'Home delivery needs an active plan. Renew to have books delivered.');
    return !!term.snap.get('planSnapshot.deliveryEligible');
  }
  if (term) return !!term.snap.get('planSnapshot.deliveryEligible');
  const subs = await tx.get(db.collection(`orgs/${orgId}/subscriptions`).where('memberId', '==', memberId).orderBy('createdAt', 'desc').limit(5));
  const last = subs.docs.find((s) => ['ACTIVE', 'EXPIRED', 'UPGRADED'].includes(s.get('status')));
  return !!last?.get('planSnapshot.deliveryEligible');
}

/**
 * Books a visit (staff at the branch, or the member in the app). Checks the
 * branch delivers there and then, the holds and loans named are the member's,
 * and that the member has no other delivery open. Nothing moves yet.
 */
export async function createDelivery(
  { actor, input, requestId }: CallContext<z.infer<typeof requestSchema>>,
  tx: Transaction,
  who: 'MEMBER' | 'STAFF',
  authorize: (member: Member) => Promise<void>,
) {
  const branch = await tx.get(branchRef(input.orgId, input.branchId));
  if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
  const s = settingsOf(branch);
  if (!s.enabled) throw errors.conflict('DELIVERY_OFF', `${branch.get('name')} does not offer home delivery yet.`);
  const { member } = await loadMember(tx, input.orgId, input.memberId);
  await authorize(member);
  if (member.status !== 'ACTIVE') throw errors.conflict('MEMBER_INACTIVE', `This membership is ${member.status.toLowerCase()}.`);
  const open = await tx.get(deliveriesCol(input.orgId).where('memberId', '==', input.memberId).where('status', 'in', [...OPEN_STATUSES]).limit(1));
  if (!open.empty) throw errors.conflict('DELIVERY_OPEN', `${member.fullName} already has a home delivery booked. Change or cancel that one first.`);
  if (s.pincodes.length && !s.pincodes.includes(input.address.postalCode)) {
    throw errors.conflict('NOT_SERVICEABLE', `${branch.get('name')} does not deliver to PIN code ${input.address.postalCode} yet.`);
  }
  if (input.date < istDate(0) || input.date > istDate(MAX_DAYS_AHEAD)) throw errors.invalid(`Choose a date from today to ${MAX_DAYS_AHEAD} days ahead.`);
  if (s.slots.length && (!input.slot || !s.slots.includes(input.slot))) throw errors.invalid(`Choose a time: ${s.slots.join(', ')}.`);
  if (!sends(input.kind) && input.holdIds.length) throw errors.invalid('A pickup only collects books.');
  if (!collects(input.kind) && input.collectLoanIds.length) throw errors.invalid('A delivery only brings books. Choose "Exchange" to also send some back.');
  if (collects(input.kind) && !input.collectLoanIds.length) throw errors.invalid('Choose the books to send back.');
  if (sends(input.kind) && !input.holdIds.length && input.note.length < 3) {
    throw errors.invalid('Choose reserved books that are ready, or write which books you would like in the note.');
  }
  const holds = await Promise.all(input.holdIds.map((h) => tx.get(db.doc(`orgs/${input.orgId}/reservations/${h}`))));
  for (const h of holds) {
    if (!h.exists || h.get('memberId') !== input.memberId || h.get('status') !== 'ALLOCATED' || h.get('branchId') !== input.branchId) {
      throw errors.conflict('HOLD_NOT_READY', 'One of the reserved books is no longer waiting for you at this branch.');
    }
  }
  const loans = await Promise.all(input.collectLoanIds.map((l) => tx.get(db.doc(`orgs/${input.orgId}/loans/${l}`))));
  for (const l of loans) {
    if (!l.exists || l.get('memberId') !== input.memberId || l.get('status') !== 'ACTIVE') throw errors.conflict('NOT_ON_LOAN', 'One of the books to collect is not on loan to you any more.');
  }
  if (who === 'MEMBER' && !(await planAllowsDelivery(tx, input.orgId, input.memberId, member, input.kind))) {
    throw errors.conflict('PLAN_NO_DELIVERY', 'Your plan does not include home delivery. Ask the branch, or choose a plan with delivery.');
  }
  let phone = member.phone;
  if (!phone && member.guardian?.memberId) {
    phone = ((await tx.get(db.doc(`orgs/${input.orgId}/members/${member.guardian.memberId}`))).get('phone') as string | null) ?? null;
  }

  const ref = deliveriesCol(input.orgId).doc();
  const delivery: Delivery = {
    branchId: input.branchId,
    memberId: input.memberId,
    memberCode: member.code,
    memberName: member.fullName,
    phone,
    kind: input.kind,
    status: 'REQUESTED',
    address: input.address,
    date: input.date,
    slot: input.slot,
    note: input.note,
    holdIds: input.holdIds,
    collectLoanIds: input.collectLoanIds,
    sent: [],
    collected: [],
    fee: s.feeMinor > 0 ? { amountMinor: s.feeMinor, status: 'DUE' } : { amountMinor: 0, status: 'FREE' },
    method: null,
    rider: null,
    courier: null,
    provider: null,
    outcome: null,
    failReason: null,
    requestedBy: who,
  };
  tx.create(ref, {
    ...delivery,
    holdTitles: holds.map((h) => h.get('bookTitle') as string),
    collectTitles: loans.map((l) => l.get('bookTitle') as string),
    requestedByUid: actor.uid,
    requestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  queueWhatsApp(tx, { orgId: input.orgId, branchId: input.branchId, event: 'delivery_requested', memberId: input.memberId, vars: { delivery_date: dateLabel(input.date, input.slot) }, ref: { deliveryId: ref.id } });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'delivery.request', entityType: 'delivery', entityId: ref.id, branchId: input.branchId, memberId: input.memberId,
    after: { kind: input.kind, date: input.date, slot: input.slot, holds: input.holdIds.length, collect: input.collectLoanIds.length, by: who },
  });
  return { deliveryId: ref.id };
}

export const create = command('deliveries-create', requestSchema, (ctx, tx) =>
  createDelivery(ctx, tx, 'STAFF', () => ctx.actor.require('delivery.manage', ctx.input.orgId, ctx.input.branchId, tx)),
);

// ------------------------------------------------------------------ dispatch

const courierInput = z.strictObject({
  name: z.string().trim().min(2).max(60),
  reference: z.string().trim().max(60).default(''),
  trackingUrl: z.url().max(300).or(z.literal('')).default(''),
});

async function loadDelivery(tx: Pick<Transaction, 'get'> | null, orgId: string, deliveryId: string) {
  const ref = deliveriesCol(orgId).doc(deliveryId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw errors.notFound('Delivery');
  return { ref, snap, d: snap.data() as Delivery };
}

/** The rider: an active staff member of the organization who works at the branch. */
async function loadRider(tx: Transaction, orgId: string, branchId: string, uid: string) {
  const [membership, user, employee] = await Promise.all([
    tx.get(db.doc(`users/${uid}/memberships/${orgId}`)),
    tx.get(db.doc(`users/${uid}`)),
    tx.get(db.collection(`orgs/${orgId}/employees`).where('uid', '==', uid).limit(1)),
  ]);
  const branches = (membership.get('branchIds') as string[] | undefined) ?? [];
  if (!membership.exists || membership.get('status') !== 'ACTIVE' || !(branches.includes('*') || branches.includes(branchId))) {
    throw errors.conflict('RIDER_NOT_AT_BRANCH', 'Choose someone who works at this branch.');
  }
  const name = (employee.docs[0]?.get('fullName') as string | undefined) ?? (user.get('displayName') as string | undefined) ?? (membership.get('email') as string);
  return { uid, name, phone: (employee.docs[0]?.get('phone') as string | null | undefined) ?? null };
}

export const dispatch = command(
  'deliveries-dispatch',
  z.strictObject({
    orgId: id,
    deliveryId: id,
    barcodes: z.array(z.string().trim().toUpperCase().min(4).max(32)).max(10).default([]),
    method: z.enum(METHODS),
    riderUid: id.nullable().default(null),
    courier: courierInput.nullable().default(null),
    waiveFee: z.boolean().default(false),
  }),
  async ({ actor, input, requestId }, tx) => {
    const { ref, d } = await loadDelivery(tx, input.orgId, input.deliveryId);
    await actor.require('delivery.assign', input.orgId, d.branchId, tx);
    if (d.status !== 'REQUESTED') throw errors.conflict('NOT_REQUESTED', 'This delivery has already been dispatched or closed.');
    const branch = await tx.get(branchRef(input.orgId, d.branchId));
    const s = settingsOf(branch);
    if (!s.enabled) throw errors.conflict('DELIVERY_OFF', 'Home delivery is switched off for this branch.');
    if (new Set(input.barcodes).size !== input.barcodes.length) throw errors.invalid('The same copy is listed twice.');
    if (sends(d.kind) && !input.barcodes.length) throw errors.invalid('Scan the books going out.');
    if (!sends(d.kind) && input.barcodes.length) throw errors.invalid('A pickup sends no books.');

    let rider: Delivery['rider'] = null;
    let courier: Delivery['courier'] = null;
    let provider: Delivery['provider'] = null;
    const method = input.method as Method;
    if (method === 'OWN') {
      if (!s.methods.OWN) throw errors.conflict('METHOD_OFF', 'Delivery by the branch’s own staff is switched off in Settings → Delivery.');
      if (!input.riderUid) throw errors.invalid('Choose who is delivering.');
      rider = await loadRider(tx, input.orgId, d.branchId, input.riderUid);
    } else if (method === 'MANUAL') {
      if (!s.methods.MANUAL) throw errors.conflict('METHOD_OFF', 'Other couriers are switched off in Settings → Delivery.');
      if (!input.courier) throw errors.invalid('Enter the courier’s name.');
      courier = { name: input.courier.name, reference: input.courier.reference, trackingUrl: input.courier.trackingUrl || null };
    } else {
      const c = courierFor(method)!;
      await courierConnection(input.orgId, d.branchId, method, tx);
      if (!(c.kinds as readonly string[]).includes(d.kind)) throw errors.conflict('COURIER_ONE_WAY', `${c.label} carries one way: send an exchange with your own staff, or as a delivery and a pickup.`);
      if (!s.location) throw errors.conflict('NO_BRANCH_LOCATION', `Set the branch’s map location in Settings → Delivery before booking ${c.label}.`);
      if (!d.address.geo) throw errors.conflict('NO_MEMBER_LOCATION', `${c.label} needs the member’s map location. Add it to the delivery address first.`);
      provider = { key: method as never, orderId: null, status: 'BOOKING', raw: null, trackingUrl: null, fareMinor: null, partner: null, error: null };
    }

    // Books going out are issued now (same rules as the desk).
    let sent: Item[] = [];
    let memberWrite: (() => void) | null = null;
    if (sends(d.kind)) {
      const { snap: memberSnap, member } = await loadMember(tx, input.orgId, d.memberId);
      const term = await requireActiveTerm(tx, input.orgId, member);
      const plan = await readIssue(tx, input.orgId, d.branchId, d.memberId, input.barcodes);
      // An exchange hands over the new books as it takes the old ones: those count as coming back.
      const coming = d.kind === 'EXCHANGE' ? (await Promise.all(d.collectLoanIds.map((l) => tx.get(db.doc(`orgs/${input.orgId}/loans/${l}`))))).filter((l) => l.get('status') === 'ACTIVE').length : 0;
      checkLimit(member, term, coming, plan);
      memberWrite = () => {
        const loanIds = writeIssue(tx, input.orgId, d.branchId, member, d.memberId, term, plan, actor.uid, null, { channel: 'DELIVERY', deliveryId: input.deliveryId, notify: false });
        sent = plan.copies.map((c, i) => ({ loanId: loanIds[i], copyId: c.snap.id, copyCode: c.copy.code, bookTitle: c.copy.bookTitle }));
        const fulfilled = plan.copies.filter((c) => c.reservation).length;
        tx.update(memberSnap.ref, {
          ...(term.rollover ?? {}),
          activeLoanCount: FieldValue.increment(plan.copies.length),
          allocatedCount: FieldValue.increment(-fulfilled),
          lifetimeLoans: FieldValue.increment(plan.copies.length),
          updatedAt: FieldValue.serverTimestamp(),
        });
      };
    }
    memberWrite?.();
    const fee = input.waiveFee ? { amountMinor: 0, status: 'FREE' as const } : d.fee;
    const next: Delivery = { ...d, status: 'OUT', method, rider, courier, provider, sent, fee };
    tx.update(ref, {
      status: 'OUT', method, rider, courier, provider, sent, fee,
      dispatchedAt: FieldValue.serverTimestamp(), dispatchedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    });
    // Courier apps: the member is told once the booking is made (with the tracking link).
    if (!provider) queueOut(tx, input.orgId, input.deliveryId, next);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'delivery.dispatch', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
      before: { status: 'REQUESTED' },
      after: { status: 'OUT', method, rider: rider?.name ?? null, courier: courier?.name ?? null, copies: sent.map((x) => x.copyCode), fee: fee.status },
    });
    return { deliveryId: input.deliveryId, loanIds: sent.map((x) => x.loanId), book: provider ? method : null };
  },
  async (result, ctx) => {
    if (result.book) await bookCourier(ctx.input.orgId, result.deliveryId);
  },
);

// ------------------------------------------------------------------ courier apps

function stopOf(kind: 'BRANCH' | 'MEMBER', d: Delivery, branch: DocumentSnapshot): Stop {
  if (kind === 'BRANCH') {
    const a = branch.get('address') as { line1: string; line2?: string; city: string; state: string; postalCode: string };
    return {
      geo: settingsOf(branch).location!, name: `Stories ${branch.get('name')}`, phone: String(branch.get('contact.phone') ?? '').replace(/\s/g, ''),
      line1: a.line1, line2: a.line2 ?? '', landmark: '', city: a.city, state: a.state, postalCode: a.postalCode,
    };
  }
  return {
    geo: d.address.geo!, name: d.memberName, phone: d.phone ?? '', line1: d.address.line1, line2: d.address.line2, landmark: d.address.landmark,
    city: d.address.city, state: d.address.state, postalCode: d.address.postalCode,
  };
}

function tripOf(d: Delivery, branch: DocumentSnapshot) {
  const out = d.kind === 'DELIVER';
  return {
    pickup: stopOf(out ? 'BRANCH' : 'MEMBER', d, branch),
    drop: stopOf(out ? 'MEMBER' : 'BRANCH', d, branch),
    instructions: out
      ? `Library books for ${d.memberName} (${d.sent.length} in a sealed bag). ${d.note}`.trim()
      : `Collect library books from ${d.memberName} and bring them to the Stories branch. ${d.note}`.trim(),
  };
}

/**
 * Books the courier for a dispatched delivery (after the dispatch commits).
 * A failure is saved on the delivery for staff to retry or switch method; it
 * never undoes the dispatch.
 */
export async function bookCourier(orgId: string, deliveryId: string): Promise<{ booked: boolean; error: string | null }> {
  const ref = deliveriesCol(orgId).doc(deliveryId);
  const snap = await ref.get();
  const d = snap.data() as Delivery & { provider: NonNullable<Delivery['provider']> & { attempts?: number } };
  if (!snap.exists || d.status !== 'OUT' || !d.provider || d.provider.orderId) return { booked: false, error: null };
  const courier = courierFor(d.provider.key)!;
  const attempts = (d.provider.attempts ?? 0) + 1;
  try {
    const conn = await courierConnection(orgId, d.branchId, d.provider.key);
    const branch = await branchRef(orgId, d.branchId).get();
    const booking = await courier.book(conn, { requestId: attempts === 1 ? deliveryId : `${deliveryId}-${attempts}`, ...tripOf(d, branch) });
    const batch = db.batch();
    const provider = { ...d.provider, orderId: booking.orderId, status: 'BOOKED', trackingUrl: booking.trackingUrl, fareMinor: booking.fareMinor, error: null, attempts, syncedAt: FieldValue.serverTimestamp() };
    batch.update(ref, { provider, updatedAt: FieldValue.serverTimestamp() });
    queueOut(batch, orgId, deliveryId, { ...d, provider: { ...d.provider, trackingUrl: booking.trackingUrl } });
    await batch.commit();
    return { booked: true, error: null };
  } catch (e) {
    const known = e instanceof CourierError || e instanceof AppError;
    const error = known ? (e as Error).message : `Could not book ${courier.label}. Try again.`;
    if (!known) logger.error('courier booking', e);
    await ref.update({ 'provider.status': 'BOOKING_FAILED', 'provider.error': error, 'provider.attempts': attempts, updatedAt: FieldValue.serverTimestamp() });
    return { booked: false, error };
  }
}

/** Books the courier again: after a failed booking, or when the courier cancelled. */
export const book = query('deliveries-book', z.strictObject({ orgId: id, deliveryId: id }), async ({ actor, input }) => {
  const { ref, d } = await loadDelivery(null, input.orgId, input.deliveryId);
  await actor.require('delivery.assign', input.orgId, d.branchId);
  if (d.status !== 'OUT' || !isCourier(d.method) || !d.provider) throw errors.conflict('NOT_COURIER', 'Only a dispatched courier delivery can be booked.');
  if (d.provider.orderId && d.provider.status !== 'CANCELLED') throw errors.conflict('ALREADY_BOOKED', 'The courier is already booked for this delivery.');
  if (d.provider.orderId) await ref.update({ 'provider.orderId': null, 'provider.partner': null, 'provider.trackingUrl': null });
  const r = await bookCourier(input.orgId, input.deliveryId);
  if (r.error) throw errors.conflict('COURIER_ERROR', r.error);
  return r;
});

/** Fares from the courier for a delivery (before or after dispatching). */
export const quote = query('deliveries-quote', z.strictObject({ orgId: id, deliveryId: id, courier: z.string().min(2).max(20) }), async ({ actor, input }) => {
  const { d } = await loadDelivery(null, input.orgId, input.deliveryId);
  await actor.require('delivery.assign', input.orgId, d.branchId);
  const c = courierFor(input.courier);
  if (!c) throw errors.invalid('Unknown courier.');
  const branch = await branchRef(input.orgId, d.branchId).get();
  if (!settingsOf(branch).location) throw errors.conflict('NO_BRANCH_LOCATION', 'Set the branch’s map location in Settings → Delivery first.');
  if (!d.address.geo) throw errors.conflict('NO_MEMBER_LOCATION', 'Add the member’s map location to the delivery address first.');
  const conn = await courierConnection(input.orgId, d.branchId, c.key);
  const trip = tripOf({ ...d, kind: d.kind === 'PICKUP' ? 'PICKUP' : 'DELIVER' }, branch);
  try {
    return { fares: await c.quote(conn, trip) };
  } catch (e) {
    if (e instanceof CourierError) throw errors.conflict('COURIER_ERROR', e.message);
    throw e;
  }
});

/**
 * Applies the courier's latest state. When the courier drops the books, a
 * delivery is done and a pickup's books are at the branch to be received.
 */
export async function applyTracking(orgId: string, deliveryId: string, t: Tracking) {
  await db.runTransaction(async (tx) => {
    const { ref, d } = await loadDelivery(tx, orgId, deliveryId);
    if (!d.provider) return;
    const provider = {
      ...d.provider,
      status: t.status === 'UNKNOWN' ? d.provider.status : t.status,
      raw: t.raw || d.provider.raw,
      trackingUrl: t.trackingUrl ?? d.provider.trackingUrl,
      fareMinor: t.fareMinor ?? d.provider.fareMinor,
      partner: t.partner ?? d.provider.partner,
      syncedAt: FieldValue.serverTimestamp(),
    };
    const done = t.status === 'DELIVERED' && d.status === 'OUT' && !d.outcome;
    if (!done) {
      tx.update(ref, { provider, updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (d.kind === 'PICKUP') {
      const loans = await Promise.all(d.collectLoanIds.map((l) => tx.get(db.doc(`orgs/${orgId}/loans/${l}`))));
      const collected = loans.filter((l) => l.get('status') === 'ACTIVE').map((l) => ({ loanId: l.id, copyId: l.get('copyId'), copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle') }));
      tx.update(ref, { provider, outcome: 'DELIVERED', collected, status: collected.length ? 'RETURNING' : 'COMPLETED', reportedAt: FieldValue.serverTimestamp(), ...(collected.length ? {} : { closedAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() });
      queueWhatsApp(tx, { orgId, branchId: d.branchId, event: 'delivery_completed', memberId: d.memberId, vars: { delivery_summary: summary(0, collected.length) }, ref: { deliveryId } });
    } else {
      tx.update(ref, { provider, outcome: 'DELIVERED', status: 'COMPLETED', reportedAt: FieldValue.serverTimestamp(), closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      queueWhatsApp(tx, { orgId, branchId: d.branchId, event: 'delivery_completed', memberId: d.memberId, vars: { delivery_summary: summary(d.sent.length, 0) }, ref: { deliveryId } });
    }
    recordAudit(tx, { actorUid: 'system' }, orgId, {
      action: 'delivery.courierDone', entityType: 'delivery', entityId: deliveryId, branchId: d.branchId, memberId: d.memberId,
      after: { courier: d.provider.key, orderId: d.provider.orderId },
    });
  });
}

/** Asks the courier where an order is (Porter allows one track call per order per minute). */
export async function syncOne(orgId: string, deliveryId: string, minAgeMs = 60_000): Promise<CourierStatus | null> {
  const snap = await deliveriesCol(orgId).doc(deliveryId).get();
  const d = snap.data() as (Delivery & { provider: { syncedAt?: Timestamp } }) | undefined;
  if (!d?.provider?.orderId || !['OUT', 'RETURNING'].includes(d.status)) return null;
  if (d.provider.syncedAt && Date.now() - d.provider.syncedAt.toMillis() < minAgeMs) return null;
  const c = courierFor(d.provider.key)!;
  const conn = await courierConnection(orgId, d.branchId, c.key);
  const t = await c.track(conn, d.provider.orderId);
  await applyTracking(orgId, deliveryId, t);
  return t.status;
}

/** Refreshes the branch's courier orders on the board (or one delivery), skipping those checked in the last minute. */
export const sync = query('deliveries-sync', z.strictObject({ orgId: id, branchId: id, deliveryId: id.nullable().default(null) }), async ({ actor, input }) => {
  await actor.require('delivery.manage', input.orgId, input.branchId);
  const ids = input.deliveryId
    ? [input.deliveryId]
    : (await deliveriesCol(input.orgId).where('branchId', '==', input.branchId).where('status', '==', 'OUT').limit(30).get()).docs
        .filter((d) => d.get('provider.orderId'))
        .slice(0, 10)
        .map((d) => d.id);
  const updated: Record<string, string> = {};
  const failed: string[] = [];
  for (const deliveryId of ids) {
    try {
      const s = await syncOne(input.orgId, deliveryId);
      if (s) updated[deliveryId] = s;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (input.deliveryId && failed.length) throw errors.conflict('COURIER_ERROR', failed[0]);
  return { updated, failed: failed.length };
});

// ------------------------------------------------------------------ at the door

/** The assigned rider, or anyone who manages deliveries at the branch. */
async function requireRiderOrManager(actor: Actor, orgId: string, d: Delivery, tx: Transaction) {
  if (d.rider?.uid === actor.uid && ((await actor.can('delivery.execute', orgId, d.branchId, tx)) || (await actor.can('delivery.manage', orgId, d.branchId, tx)))) return;
  await actor.require('delivery.manage', orgId, d.branchId, tx);
}

export const report = command(
  'deliveries-report',
  z.strictObject({
    orgId: id,
    deliveryId: id,
    outcome: z.enum(['DELIVERED', 'FAILED']),
    collectedLoanIds: z.array(id).max(10).default([]),
    failReason: z.string().trim().max(200).default(''),
    handedTo: z.string().trim().max(80).default(''),
    fee: z.strictObject({ method: z.enum(FEE_METHODS), reference: z.string().trim().max(60).default('') }).nullable().default(null),
  }),
  async ({ actor, input, requestId }, tx) => {
    const { ref, d } = await loadDelivery(tx, input.orgId, input.deliveryId);
    await requireRiderOrManager(actor, input.orgId, d, tx);
    if (d.status !== 'OUT') throw errors.conflict('NOT_OUT', 'This delivery is not out for delivery.');
    const delivered = input.outcome === 'DELIVERED';
    if (!delivered && input.failReason.length < 3) throw errors.invalid('Say why it could not be done (e.g. nobody at home).');
    if (!delivered && input.collectedLoanIds.length) throw errors.invalid('Nothing is collected on a visit that did not happen.');
    if (!collects(d.kind) && input.collectedLoanIds.length) throw errors.invalid('This delivery does not collect books.');
    if (input.fee && (!delivered || d.fee.status !== 'DUE')) throw errors.invalid('There is no delivery fee to collect.');
    if (input.fee && input.fee.method !== 'OFFLINE_CASH' && input.fee.reference.length < 4) throw errors.invalid('Enter the UPI or card reference for the fee.');
    const loans = await Promise.all(input.collectedLoanIds.map((l) => tx.get(db.doc(`orgs/${input.orgId}/loans/${l}`))));
    for (const l of loans) {
      if (!l.exists || l.get('memberId') !== d.memberId || l.get('status') !== 'ACTIVE') throw errors.conflict('NOT_ON_LOAN', 'One of the collected books is not on loan to this member.');
    }
    const payer = input.fee ? (await loadMember(tx, input.orgId, d.memberId)).member : null;

    const collected: Item[] = loans.map((l) => ({ loanId: l.id, copyId: l.get('copyId'), copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle') }));
    const comingBack = collected.length + (delivered ? 0 : d.sent.length);
    const status = comingBack ? 'RETURNING' : delivered ? 'COMPLETED' : 'FAILED';
    let fee = d.fee;
    if (input.fee) {
      const payRef = db.collection(`orgs/${input.orgId}/payments`).doc();
      tx.create(payRef, {
        memberId: d.memberId, memberCode: payer!.code, branchId: d.branchId, subscriptionId: null, deliveryId: input.deliveryId,
        purpose: 'DELIVERY_FEE', direction: 'IN', lines: [{ type: 'DELIVERY_FEE', amountMinor: d.fee.amountMinor }], amountMinor: d.fee.amountMinor,
        currency: 'INR', method: input.fee.method, reference: input.fee.reference || null, gateway: null, status: 'SUCCESS', recordedBy: actor.uid,
        at: FieldValue.serverTimestamp(),
      });
      fee = { ...d.fee, status: 'PAID', paymentId: payRef.id, method: input.fee.method };
    }
    tx.update(ref, {
      status, outcome: input.outcome, collected, fee, failReason: delivered ? null : input.failReason, handedTo: input.handedTo || null,
      reportedAt: FieldValue.serverTimestamp(), reportedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
      ...(status === 'RETURNING' ? {} : { closedAt: FieldValue.serverTimestamp() }),
    });
    queueWhatsApp(tx, delivered
      ? { orgId: input.orgId, branchId: d.branchId, event: 'delivery_completed', memberId: d.memberId, vars: { delivery_summary: summary(d.sent.length, collected.length) }, ref: { deliveryId: input.deliveryId } }
      : { orgId: input.orgId, branchId: d.branchId, event: 'delivery_failed', memberId: d.memberId, vars: { reason: input.failReason }, ref: { deliveryId: input.deliveryId } });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: delivered ? 'delivery.delivered' : 'delivery.failed', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
      before: { status: 'OUT' }, after: { status, collected: collected.map((c) => c.copyCode), feePaid: !!input.fee, reason: input.failReason || null },
    });
    return { status };
  },
);

/**
 * The bag is back at the branch: collected books (and any that could not be
 * delivered) are returned through the desk's return code and go to inspection.
 */
export const receive = command('deliveries-receive', z.strictObject({ orgId: id, deliveryId: id }), async ({ actor, input, requestId }, tx) => {
  const { ref, d } = await loadDelivery(tx, input.orgId, input.deliveryId);
  await actor.require('delivery.manage', input.orgId, d.branchId, tx);
  if (d.status !== 'RETURNING') throw errors.conflict('NOT_RETURNING', 'There is nothing to receive for this delivery.');
  const failed = d.outcome === 'FAILED';
  const groups = [
    { items: d.collected, notify: true },
    { items: failed ? d.sent : [], notify: false },
  ];
  const read = await Promise.all(groups.map(async (g) => {
    const loans = await Promise.all(g.items.map((i) => tx.get(db.doc(`orgs/${input.orgId}/loans/${i.loanId}`))));
    const codes = g.items.filter((_, k) => loans[k].get('status') === 'ACTIVE').map((i) => i.copyCode);
    return { ...g, items: codes.length ? await readReturns(tx, input.orgId, codes, d.memberId) : [] };
  }));
  const member = await tx.get(db.doc(`orgs/${input.orgId}/members/${d.memberId}`));
  const total = read.reduce((n, g) => n + g.items.length, 0);
  for (const g of read) writeReturns(tx, input.orgId, d.branchId, g.items, actor.uid, null, { notify: g.notify });
  for (const i of read[1].items) tx.update(i.loan.ref, { returnReason: 'DELIVERY_FAILED' });
  const exchanged = d.kind === 'EXCHANGE' && !failed ? Math.min(d.sent.length, read[0].items.length) : 0;
  if (member.exists && total) {
    tx.update(member.ref, { activeLoanCount: FieldValue.increment(-total), ...(exchanged ? { lifetimeExchanges: FieldValue.increment(exchanged) } : {}), updatedAt: FieldValue.serverTimestamp() });
  }
  const status = failed ? 'FAILED' : 'COMPLETED';
  tx.update(ref, { status, receivedAt: FieldValue.serverTimestamp(), receivedBy: actor.uid, closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'delivery.receive', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
    before: { status: 'RETURNING' }, after: { status, returned: read.flatMap((g) => g.items.map((i) => i.copy.code)) },
  });
  return { status, returned: total };
});

// ------------------------------------------------------------------ cancel and fee

/**
 * Cancels a delivery. Before dispatch it simply closes; once out, anything
 * sent comes back to the branch (to be received) and a booked courier is cancelled.
 */
export async function cancelDelivery(
  { actor, input, requestId }: CallContext<{ orgId: string; deliveryId: string; reason: string }>,
  tx: Transaction,
  authorize: (d: Delivery) => Promise<void>,
  onlyRequested = false,
) {
  const { ref, d } = await loadDelivery(tx, input.orgId, input.deliveryId);
  await authorize(d);
  if (d.status !== 'REQUESTED' && (onlyRequested || d.status !== 'OUT')) {
    throw errors.conflict('CANNOT_CANCEL', onlyRequested ? 'It is already on the way: call the branch to change it.' : 'Only a delivery that is booked or out can be cancelled.');
  }
  const status = d.status === 'OUT' && d.sent.length ? 'RETURNING' : 'CANCELLED';
  tx.update(ref, {
    status, cancelReason: input.reason, cancelledAt: FieldValue.serverTimestamp(), cancelledBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    ...(d.status === 'OUT' ? { outcome: 'FAILED', failReason: `Cancelled: ${input.reason}` } : {}),
    ...(status === 'CANCELLED' ? { closedAt: FieldValue.serverTimestamp() } : {}),
  });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'delivery.cancel', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
    before: { status: d.status }, after: { status }, reason: input.reason,
  });
  const cancelCourier = d.status === 'OUT' && d.provider?.orderId && !['DELIVERED', 'CANCELLED'].includes(d.provider.status) ? d.provider : null;
  return { status, cancelCourier: cancelCourier ? { key: cancelCourier.key, orderId: cancelCourier.orderId!, branchId: d.branchId } : null };
}

async function cancelAtCourier(orgId: string, deliveryId: string, c: { key: string; orderId: string; branchId: string } | null) {
  if (!c) return;
  try {
    await courierFor(c.key)!.cancel(await courierConnection(orgId, c.branchId, c.key), c.orderId);
    await deliveriesCol(orgId).doc(deliveryId).update({ 'provider.status': 'CANCELLED', 'provider.error': null });
  } catch (e) {
    await deliveriesCol(orgId).doc(deliveryId).update({ 'provider.error': `Cancel it in ${courierFor(c.key)?.label ?? c.key} too: ${(e as Error).message}` });
  }
}

export const cancel = command(
  'deliveries-cancel',
  z.strictObject({ orgId: id, deliveryId: id, reason }),
  (ctx, tx) => cancelDelivery(ctx, tx, (d) => ctx.actor.require('delivery.manage', ctx.input.orgId, d.branchId, tx)),
  async (r, ctx) => cancelAtCourier(ctx.input.orgId, ctx.input.deliveryId, r.cancelCourier),
);

/** Records the delivery fee paid at the counter later, or waives it. */
export const recordFee = command(
  'deliveries-recordFee',
  z.strictObject({ orgId: id, deliveryId: id, method: z.enum([...FEE_METHODS, 'WAIVED']), reference: z.string().trim().max(60).default('') }),
  async ({ actor, input, requestId }, tx) => {
    const { ref, d } = await loadDelivery(tx, input.orgId, input.deliveryId);
    await actor.require('delivery.manage', input.orgId, d.branchId, tx);
    if (d.fee.status !== 'DUE') throw errors.conflict('NO_FEE_DUE', 'No delivery fee is due on this delivery.');
    if (input.method !== 'WAIVED' && input.method !== 'OFFLINE_CASH' && input.reference.length < 4) throw errors.invalid('Enter the UPI or card reference.');
    let fee: Delivery['fee'] = { amountMinor: 0, status: 'FREE', method: 'WAIVED' };
    if (input.method !== 'WAIVED') {
      const { member } = await loadMember(tx, input.orgId, d.memberId);
      const payRef = db.collection(`orgs/${input.orgId}/payments`).doc();
      tx.create(payRef, {
        memberId: d.memberId, memberCode: member.code, branchId: d.branchId, subscriptionId: null, deliveryId: input.deliveryId,
        purpose: 'DELIVERY_FEE', direction: 'IN', lines: [{ type: 'DELIVERY_FEE', amountMinor: d.fee.amountMinor }], amountMinor: d.fee.amountMinor,
        currency: 'INR', method: input.method, reference: input.reference || null, gateway: null, status: 'SUCCESS', recordedBy: actor.uid,
        at: FieldValue.serverTimestamp(),
      });
      fee = { ...d.fee, status: 'PAID', paymentId: payRef.id, method: input.method };
    }
    tx.update(ref, { fee, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'delivery.fee', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
      before: { fee: d.fee.status, amount: rupeesText(d.fee.amountMinor) }, after: { fee: fee.status, method: input.method },
    });
    return { fee: fee.status };
  },
);

// ------------------------------------------------------------------ lists

/** The branch's delivery board: everything open, and what closed in the last two weeks. */
export const list = query('deliveries-list', z.strictObject({ orgId: id, branchId: id }), async ({ actor, input }) => {
  await actor.require('delivery.manage', input.orgId, input.branchId);
  const since = Timestamp.fromMillis(Date.now() - 14 * 86_400_000);
  const [open, closed] = await Promise.all([
    deliveriesCol(input.orgId).where('branchId', '==', input.branchId).where('status', 'in', [...OPEN_STATUSES]).orderBy('requestedAt', 'asc').limit(200).get(),
    deliveriesCol(input.orgId).where('branchId', '==', input.branchId).where('closedAt', '>=', since).orderBy('closedAt', 'desc').limit(60).get(),
  ]);
  return { open: open.docs.map(row), closed: closed.docs.map(row) };
});

/** The rider's run: deliveries assigned to the caller that are out. */
export const mine = query('deliveries-mine', z.strictObject({ orgId: id }), async ({ actor, input }) => {
  const snap = await deliveriesCol(input.orgId).where('rider.uid', '==', actor.uid).where('status', '==', 'OUT').limit(50).get();
  const rows = snap.docs.map(row);
  // Books the member has out, so the rider can tick what they collect.
  const loans = await Promise.all(
    snap.docs.map((d) =>
      collects(d.get('kind'))
        ? db.collection(`orgs/${input.orgId}/loans`).where('memberId', '==', d.get('memberId')).where('status', '==', 'ACTIVE').limit(20).get()
        : null,
    ),
  );
  return {
    deliveries: rows.map((r, i) => ({
      ...r,
      memberLoans: loans[i]?.docs.filter((l) => l.get('deliveryId') !== r.id).map((l) => ({ loanId: l.id, copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle') })) ?? [],
    })),
  };
});

/** One delivery with the member's books out (for the dispatch and report dialogs). */
export const get = query('deliveries-get', z.strictObject({ orgId: id, deliveryId: id }), async ({ actor, input }) => {
  const snap = await deliveriesCol(input.orgId).doc(input.deliveryId).get();
  if (!snap.exists) throw errors.notFound('Delivery');
  const d = snap.data() as Delivery;
  if (d.rider?.uid !== actor.uid) await actor.require('delivery.manage', input.orgId, d.branchId);
  const [loans, holds] = await Promise.all([
    db.collection(`orgs/${input.orgId}/loans`).where('memberId', '==', d.memberId).where('status', '==', 'ACTIVE').limit(20).get(),
    db.collection(`orgs/${input.orgId}/reservations`).where('memberId', '==', d.memberId).where('status', '==', 'ALLOCATED').limit(20).get(),
  ]);
  return {
    delivery: row(snap),
    memberLoans: loans.docs.map((l) => ({ loanId: l.id, copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle'), deliveryId: l.get('deliveryId') ?? null })),
    holds: holds.docs.filter((h) => h.get('branchId') === d.branchId).map((h) => ({ reservationId: h.id, bookTitle: h.get('bookTitle'), copyCode: h.get('allocatedCopyCode') })),
  };
});
