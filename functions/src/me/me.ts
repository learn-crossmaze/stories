import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query, requestIdSchema } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id } from '../core/schemas.js';
import { cancelReservation, placeReservation } from '../circulation/reservations.js';
import type { Member } from '../members/model.js';
import { requestOnlinePayment, settleOpenRequests } from '../payments/online.js';
import { effectivePrice, type Plan } from '../subscriptions/plans.js';
import { cancelPendingSubscription, startSubscription } from '../subscriptions/subscriptions.js';

// Member self-service ("me-*"): a signed-in member sees and acts on their own
// memberships and those of the children they are guardian for. Access is by
// ownership (members.accountHolderUid), never by staff roles.

const MEMBER_REASON = 'Cancelled by the member';

/**
 * Links member records whose email matches the caller's verified sign-in email
 * (and that no one has claimed yet) to this account. Staff enter the email at
 * registration; the member then just signs in with it.
 */
async function linkByEmail(actor: Actor): Promise<number> {
  if (!actor.email || !actor.emailVerified) return 0;
  const lower = actor.email.toLowerCase();
  // emailLower matches regardless of how staff capitalised it; `email` also finds members saved before emailLower existed.
  const [byLower, byEmail] = await Promise.all([
    db.collectionGroup('members').where('emailLower', '==', lower).limit(20).get(),
    db.collectionGroup('members').where('email', 'in', [...new Set([actor.email, lower])]).limit(20).get(),
  ]);
  const found = new Map([...byLower.docs, ...byEmail.docs].map((d) => [d.ref.path, d]));
  let linked = 0;
  for (const d of found.values()) {
    if (d.get('accountHolderUid')) continue;
    const orgId = d.ref.parent.parent!.id;
    const done = await db.runTransaction(async (tx) => {
      const snap = await tx.get(d.ref);
      if (snap.get('accountHolderUid') || snap.get('status') === 'CLOSED') return false;
      tx.update(d.ref, { accountHolderUid: actor.uid, updatedAt: FieldValue.serverTimestamp() });
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email }, orgId, {
        action: 'member.linkAccount', entityType: 'member', entityId: d.id, branchId: snap.get('homeBranchId'), memberId: d.id,
        after: { accountHolderUid: actor.uid, email: actor.email },
      });
      return true;
    });
    if (done) linked++;
  }
  return linked;
}

/** The caller's own member records plus the children they are guardian for. */
async function myMembers(actor: Actor) {
  const own = await db.collectionGroup('members').where('accountHolderUid', '==', actor.uid).limit(20).get();
  const all = new Map(own.docs.map((d) => [d.ref.path, d]));
  const byOrg = new Map<string, string[]>();
  for (const d of own.docs) {
    const orgId = d.ref.parent.parent!.id;
    byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), d.id]);
  }
  for (const [orgId, ids] of byOrg) {
    const wards = await db.collection(`orgs/${orgId}/members`).where('guardian.memberId', 'in', ids.slice(0, 30)).limit(20).get();
    for (const w of wards.docs) all.set(w.ref.path, w);
  }
  return [...all.values()].filter((d) => d.get('status') !== 'CLOSED');
}

/** Throws unless the caller holds this member's account or is the guardian's account holder. */
async function requireOwner(actor: Actor, member: Pick<Member, 'accountHolderUid' | 'guardian'>, orgId: string, tx?: Transaction) {
  if (member.accountHolderUid && member.accountHolderUid === actor.uid) return;
  if (member.guardian?.memberId) {
    const ref = db.doc(`orgs/${orgId}/members/${member.guardian.memberId}`);
    const guardian = tx ? await tx.get(ref) : await ref.get();
    if (guardian.exists && guardian.get('accountHolderUid') === actor.uid) return;
  }
  throw errors.forbidden('This membership is not linked to your account.');
}

async function requireOwnerOf(actor: Actor, orgId: string, memberId: string, tx?: Transaction) {
  const ref = db.doc(`orgs/${orgId}/members/${memberId}`);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw errors.notFound('Member');
  await requireOwner(actor, snap.data() as Member, orgId, tx);
}

/** Firestore values → JSON the app can read (timestamps as ISO strings). */
function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
const rows = (s: FirebaseFirestore.QuerySnapshot) => s.docs.map((d) => plain({ id: d.id, ...d.data() }));

/**
 * Everything the member app shows, for every membership the caller may see:
 * profile, branch, current and past subscriptions, payments, open online
 * payment requests, loans, reservations, deposit and its ledger, and the plans
 * they can buy. Links matching memberships by email first.
 */
export const overview = query('me-overview', z.strictObject({}), async ({ actor }) => {
  const linked = await linkByEmail(actor);
  const members = await myMembers(actor);
  const orgNames = new Map<string, string>();
  const result = await Promise.all(
    members.map(async (m) => {
      const orgId = m.ref.parent.parent!.id;
      const member = m.data() as Member & { address: unknown };
      const o = (path: string) => db.collection(`orgs/${orgId}/${path}`);
      const [org, branch, subs, payments, loans, reservations, deposit, ledger, plans] = await Promise.all([
        orgNames.has(orgId) ? null : db.doc(`orgs/${orgId}`).get(),
        db.doc(`orgs/${orgId}/branches/${member.homeBranchId}`).get(),
        o('subscriptions').where('memberId', '==', m.id).orderBy('createdAt', 'desc').limit(12).get(),
        o('payments').where('memberId', '==', m.id).orderBy('at', 'desc').limit(30).get(),
        o('loans').where('memberId', '==', m.id).orderBy('issuedAt', 'desc').limit(50).get(),
        o('reservations').where('memberId', '==', m.id).orderBy('queuedAt', 'desc').limit(30).get(),
        db.doc(`orgs/${orgId}/depositAccounts/${m.id}`).get(),
        db.collection(`orgs/${orgId}/depositAccounts/${m.id}/transactions`).orderBy('at', 'desc').limit(30).get(),
        o('plans').where('status', '==', 'ACTIVE').get(),
      ]);
      if (org) orgNames.set(orgId, (org.get('name') as string) ?? '');
      const pending = subs.docs.find((s) => s.get('status') === 'PENDING_PAYMENT');
      const requests = pending
        ? await o('paymentRequests').where('subscriptionId', '==', pending.id).where('status', '==', 'OPEN').get()
        : null;
      const razorpay = branch.get('payments.razorpay') as { enabled?: boolean } | undefined;
      return {
        orgId,
        orgName: orgNames.get(orgId) ?? '',
        memberId: m.id,
        self: member.accountHolderUid === actor.uid,
        member: plain({
          code: member.code, fullName: member.fullName, dob: member.dob, audience: member.audience, isMinor: member.isMinor,
          phone: member.phone, email: member.email, address: member.address ?? null, status: member.status, guardian: member.guardian,
          activeSubscriptionId: member.activeSubscriptionId, nextSubscriptionId: member.nextSubscriptionId,
          subscriptionEndsAt: member.subscriptionEndsAt, renewalDueAt: member.renewalDueAt ?? null, planName: member.planName ?? null,
          activeLoanCount: member.activeLoanCount, allocatedCount: member.allocatedCount, waitingCount: member.waitingCount,
          lifetimeLoans: member.lifetimeLoans, lifetimeExchanges: member.lifetimeExchanges,
        }),
        branch: {
          id: branch.id, name: (branch.get('name') as string) ?? '', phone: (branch.get('contact.phone') as string) ?? '',
          email: (branch.get('contact.email') as string) ?? '', address: plain(branch.get('address') ?? null),
          operatingHours: plain(branch.get('operatingHours') ?? []), onlinePayments: !!razorpay?.enabled,
        },
        subscriptions: rows(subs),
        payments: rows(payments),
        paymentRequests: requests ? rows(requests) : [],
        loans: rows(loans),
        reservations: rows(reservations),
        deposit: deposit.exists ? { balanceMinor: deposit.get('balanceMinor') as number, status: deposit.get('status') as string } : null,
        ledger: rows(ledger),
        plans: plans.docs
          .map((p) => ({ id: p.id, ...(p.data() as Plan) }))
          .filter((p) => p.audiences.includes(member.audience))
          .map((p) =>
            plain({
              id: p.id, name: p.name, description: p.description, duration: p.duration, priceMinor: effectivePrice(p), listPriceMinor: p.priceMinor,
              depositMinor: p.depositMinor, maxSimultaneousBooks: p.maxSimultaneousBooks, deliveryEligible: p.deliveryEligible,
              renewalWindowDays: p.renewalWindowDays,
            }),
          ),
      };
    }),
  );
  result.sort((a, b) => Number(b.self) - Number(a.self) || String((a.member as { fullName: string }).fullName).localeCompare(String((b.member as { fullName: string }).fullName)));
  return { linked, emailVerified: actor.emailVerified, email: actor.email, memberships: result };
});

/** A member (or their guardian) chooses a plan: a subscription waiting for payment is created. */
export const subscribe = command('me-subscribe', z.strictObject({ orgId: id, memberId: id, planId: id }), (ctx, tx) =>
  startSubscription(ctx, tx, (member) => requireOwner(ctx.actor, member, ctx.input.orgId, tx)),
);

/** Drops the member's own unpaid subscription (to choose a different plan). */
export const cancelPending = command('me-cancelPending', z.strictObject({ orgId: id, subscriptionId: id }), (ctx, tx) =>
  cancelPendingSubscription({ ...ctx, input: { ...ctx.input, reason: MEMBER_REASON } }, tx, (sub) =>
    requireOwnerOf(ctx.actor, ctx.input.orgId, sub.get('memberId'), tx),
  ),
);

/**
 * Opens a Razorpay payment page for the member's unpaid subscription (the
 * branch must have online payments on). The app opens the returned URL; the
 * webhook, or me-checkPayment on return, activates the subscription.
 */
export const pay = query('me-pay', z.strictObject({ orgId: id, subscriptionId: id, requestId: requestIdSchema }), (ctx) =>
  requestOnlinePayment({ ...ctx, input: { ...ctx.input, channel: 'LINK' } }, (sub) => requireOwnerOf(ctx.actor, ctx.input.orgId, sub.get('memberId')), false),
);

/** After returning from the payment page: asks Razorpay and activates the subscription if paid. */
export const checkPayment = query('me-checkPayment', z.strictObject({ orgId: id, subscriptionId: id }), async ({ actor, input }) => {
  const sub = await db.doc(`orgs/${input.orgId}/subscriptions/${input.subscriptionId}`).get();
  if (!sub.exists) throw errors.notFound('Subscription');
  await requireOwnerOf(actor, input.orgId, sub.get('memberId'));
  if (sub.get('status') === 'ACTIVE') return { paid: true };
  if (sub.get('status') !== 'PENDING_PAYMENT') return { paid: false };
  return { paid: await settleOpenRequests(input.orgId, input.subscriptionId) };
});

/** Reserves a title for the member at a branch of their library. */
export const reserve = command('me-reserve', z.strictObject({ orgId: id, memberId: id, bookId: id, branchId: id }), (ctx, tx) =>
  placeReservation(ctx, tx, (member) => requireOwner(ctx.actor, member, ctx.input.orgId, tx)),
);

/** Cancels the member's own reservation (a held copy goes to the next person waiting). */
export const cancelReservationByMember = command('me-cancelReservation', z.strictObject({ orgId: id, reservationId: id }), (ctx, tx) =>
  cancelReservation({ ...ctx, input: { ...ctx.input, reason: MEMBER_REASON } }, tx, (res) => requireOwnerOf(ctx.actor, ctx.input.orgId, res.get('memberId'), tx)),
);
