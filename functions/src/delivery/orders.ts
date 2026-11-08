import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { currentTerm, requireActiveTerm } from '../billing/term.js';
import { checkLimit, readIssue, readReturns, writeIssue, writeReturns } from '../circulation/circulation.js';
import { recordAudit } from '../core/audit.js';
import { type CallContext, command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id, reason } from '../core/schemas.js';
import { loadMember } from '../members/members.js';
import type { Member } from '../members/model.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';
import { bookCourier, cancelAtCourier } from './courierBooking.js';
import { courierFor } from './couriers.js';
import { checkFeeReference, collectFee, WAIVED_FEE } from './fees.js';
import { dateLabel, queueOut, summary } from './messages.js';
import {
  branchRef,
  collects,
  courierConnection,
  dateKey,
  type Delivery,
  deliveriesCol,
  deliveryAddress,
  FEE_METHODS,
  istDate,
  type Item,
  KINDS,
  loadDelivery,
  MAX_DAYS_AHEAD,
  METHODS,
  type Method,
  OPEN_STATUSES,
  sends,
  settingsOf,
} from './model.js';

// Home delivery orders (docs/DELIVERY.md §2–3): request, dispatch, the
// report from the door, receiving the bag back, cancelling. Books that leave
// the branch are issued to the member when they are dispatched (they count
// towards the plan from then on); books that come back are returned when the
// branch receives them, through the circulation desk's own code. Courier apps
// are in courierBooking.ts, the fee in fees.ts, lists in orderQueries.ts.

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

    // Books going out are issued now (same rules and member counters as the desk).
    let issue: (() => Item[]) | null = null;
    if (sends(d.kind)) {
      const { member } = await loadMember(tx, input.orgId, d.memberId);
      const term = await requireActiveTerm(tx, input.orgId, member);
      const plan = await readIssue(tx, input.orgId, d.branchId, d.memberId, input.barcodes);
      // An exchange hands over the new books as it takes the old ones: those count as coming back.
      const coming = d.kind === 'EXCHANGE' ? (await Promise.all(d.collectLoanIds.map((l) => tx.get(db.doc(`orgs/${input.orgId}/loans/${l}`))))).filter((l) => l.get('status') === 'ACTIVE').length : 0;
      checkLimit(member, term, coming, plan);
      issue = () => {
        const loanIds = writeIssue(tx, input.orgId, d.branchId, member, d.memberId, term, plan, actor.uid, null, { channel: 'DELIVERY', deliveryId: input.deliveryId, notify: false });
        return plan.copies.map((c, i) => ({ loanId: loanIds[i], copyId: c.snap.id, copyCode: c.copy.code, bookTitle: c.copy.bookTitle }));
      };
    }
    const sent: Item[] = issue?.() ?? [];
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
    if (input.fee) checkFeeReference(input.fee.method, input.fee.reference);
    const loans = await Promise.all(input.collectedLoanIds.map((l) => tx.get(db.doc(`orgs/${input.orgId}/loans/${l}`))));
    for (const l of loans) {
      if (!l.exists || l.get('memberId') !== d.memberId || l.get('status') !== 'ACTIVE') throw errors.conflict('NOT_ON_LOAN', 'One of the collected books is not on loan to this member.');
    }
    const payer = input.fee ? (await loadMember(tx, input.orgId, d.memberId)).member : null;

    const collected: Item[] = loans.map((l) => ({ loanId: l.id, copyId: l.get('copyId'), copyCode: l.get('copyCode'), bookTitle: l.get('bookTitle') }));
    const comingBack = collected.length + (delivered ? 0 : d.sent.length);
    const status = comingBack ? 'RETURNING' : delivered ? 'COMPLETED' : 'FAILED';
    const fee = input.fee ? collectFee(tx, input.orgId, input.deliveryId, d, payer!.code, input.fee.method, input.fee.reference, actor.uid) : d.fee;
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
      before: { status: 'OUT' },
      after: { status, collected: collected.map((c) => c.copyCode), feePaid: !!input.fee, feePaymentId: fee.paymentId ?? null, reason: input.failReason || null },
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

// ------------------------------------------------------------------ cancel

/**
 * Cancels a delivery. Before dispatch it simply closes; once out, anything
 * sent comes back to the branch (to be received) and a booked courier is
 * cancelled. A fee still due is waived: the visit didn't happen.
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
  const waive = d.fee.status === 'DUE';
  tx.update(ref, {
    status, cancelReason: input.reason, cancelledAt: FieldValue.serverTimestamp(), cancelledBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    ...(waive ? { fee: WAIVED_FEE } : {}),
    ...(d.status === 'OUT' ? { outcome: 'FAILED', failReason: `Cancelled: ${input.reason}` } : {}),
    ...(status === 'CANCELLED' ? { closedAt: FieldValue.serverTimestamp() } : {}),
  });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
    action: 'delivery.cancel', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
    before: { status: d.status, fee: d.fee.status }, after: { status, fee: waive ? 'FREE' : d.fee.status }, reason: input.reason,
  });
  const cancelCourier = d.status === 'OUT' && d.provider?.orderId && !['DELIVERED', 'CANCELLED'].includes(d.provider.status) ? d.provider : null;
  return { status, cancelCourier: cancelCourier ? { key: cancelCourier.key, orderId: cancelCourier.orderId!, branchId: d.branchId } : null };
}

export const cancel = command(
  'deliveries-cancel',
  z.strictObject({ orgId: id, deliveryId: id, reason }),
  (ctx, tx) => cancelDelivery(ctx, tx, (d) => ctx.actor.require('delivery.manage', ctx.input.orgId, d.branchId, tx)),
  async (r, ctx) => cancelAtCourier(ctx.input.orgId, ctx.input.deliveryId, r.cancelCourier),
);
