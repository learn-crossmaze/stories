import { randomUUID } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';

import * as deposits from '../../src/billing/deposits.js';
import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import { db } from '../../src/core/firebase.js';
import * as me from '../../src/members/me.js';
import * as members from '../../src/members/members.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as roles from '../../src/organization/roles.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// The counter's one-step sale: subscriptions-create with `payment` sells or renews a plan and
// takes the counter payment in the same transaction (the two-step path stays, see phase1 and payments).

const DAY = 86_400_000;
const PRICE = 30000;
const DEPOSIT = 100000;

let sa: TestUser, lib: TestUser, fin: TestUser, fin2: TestUser;
let org: string, central: string, planId: string;

type Sale = { subscriptionId: string; amountDue: { subscriptionMinor: number; depositMinor: number; totalMinor: number }; paymentId: string; startAt: string; endAt: string };

const path = (p: string) => db.doc(`orgs/${org}/${p}`);
const get = async (p: string) => (await path(p).get()).data()!;
const all = async (collection: string) => (await db.collection(`orgs/${org}/${collection}`).get()).docs;
const cash = (amountMinor: number) => ({ method: 'OFFLINE_CASH', amountMinor });
const sell = (memberId: string, payment: Record<string, unknown>, by = lib, requestId: string = randomUUID()) =>
  call<Sale>(subs.create, by, { orgId: org, memberId, planId, payment }, requestId);
/** The audit entries of the sale, by action (their order within one commit is not defined). */
const saleAudit = async () =>
  (await all('auditLogs')).map((d) => d.data()).filter((a) => ['subscription.create', 'payment.recordOffline'].includes(a.action));
/** What a sale writes, counted: for "nothing was written" checks. */
const written = async () => ({ subscriptions: (await all('subscriptions')).length, payments: (await all('payments')).length, audit: (await saleAudit()).length });
const ledgerOf = async (memberId: string) => (await path(`depositAccounts/${memberId}`).collection('transactions').get()).docs.map((d) => d.data());

async function register(fullName: string) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  return (await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName, dob: '1990-05-01', phone })).memberId;
}

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [lib, fin, fin2] = await Promise.all(['lib', 'fin', 'fin2'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: fin.email, roles: ['FINANCE_ADMIN'], branchIds: ['*'] });
  await call(staff.setRoles, sa, { orgId: org, email: fin2.email, roles: ['FINANCE_ADMIN'], branchIds: ['*'] });
  // A monthly plan as the owner makes one: renewal opens 30 days before the end (the default), which is
  // about as long as the term itself.
  planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Monthly Two', options: [{ duration: 'MONTHLY', priceMinor: PRICE }], depositMinor: DEPOSIT, maxSimultaneousBooks: 2,
    audiences: ['CHILDREN', 'TEENS', 'ADULTS'],
  })).planId;
  expect((await get(`plans/${planId}`)).renewalWindowDays).toBe(30);
});

describe('selling a plan and taking the counter payment in one step', () => {
  it('a new member is active at once: one payment, the deposit in the ledger, both audit entries, nothing left waiting', async () => {
    const m = await register('Asha');
    const before = Date.now();
    const sale = await sell(m, { method: 'OFFLINE_UPI', amountMinor: PRICE + DEPOSIT, reference: 'UPI123456' });
    expect(sale.amountDue).toEqual({ subscriptionMinor: PRICE, depositMinor: DEPOSIT, totalMinor: PRICE + DEPOSIT });

    const sub = await get(`subscriptions/${sale.subscriptionId}`);
    expect(sub).toMatchObject({ status: 'ACTIVE', kind: 'NEW', paymentId: sale.paymentId, createdBy: lib.uid, memberId: m, branchId: central, exchangesThisTerm: 0 });
    expect(sub.planSnapshot).toMatchObject({ name: 'Monthly Two', duration: 'MONTHLY', months: 1, priceMinor: PRICE });
    expect(sub.startAt.toDate().toISOString()).toBe(sale.startAt);
    expect(sub.endAt.toDate().toISOString()).toBe(sale.endAt);
    expect(sub.startAt.toMillis()).toBeGreaterThanOrEqual(before);
    expect(sub.endAt.toMillis() - sub.startAt.toMillis()).toBeGreaterThan(27 * DAY);
    expect(sub.createdAt).toBeInstanceOf(Timestamp);
    expect(sub.activatedAt).toBeInstanceOf(Timestamp);

    const payments = await all('payments');
    expect(payments.map((p) => p.id)).toEqual([sale.paymentId]);
    expect(payments[0].data()).toMatchObject({
      memberId: m, subscriptionId: sale.subscriptionId, purpose: 'SUBSCRIPTION', direction: 'IN', amountMinor: PRICE + DEPOSIT, method: 'OFFLINE_UPI',
      reference: 'UPI123456', status: 'SUCCESS', recordedBy: lib.uid,
      lines: [{ type: 'SUBSCRIPTION', amountMinor: PRICE }, { type: 'DEPOSIT', amountMinor: DEPOSIT }],
    });

    const member = await get(`members/${m}`);
    expect(member).toMatchObject({ activeSubscriptionId: sale.subscriptionId, nextSubscriptionId: null, planName: 'Monthly Two' });
    expect(member.renewalDueAt.toMillis()).toBe(sub.endAt.toMillis());
    expect(member.subscriptionEndsAt.toMillis()).toBe(sub.endAt.toMillis());

    expect(await get(`depositAccounts/${m}`)).toMatchObject({ balanceMinor: DEPOSIT, status: 'OPEN' });
    expect(await ledgerOf(m)).toMatchObject([{ type: 'DEPOSIT_COLLECTED', deltaMinor: DEPOSIT, balanceAfterMinor: DEPOSIT, reference: { paymentId: sale.paymentId, subscriptionId: sale.subscriptionId } }]);

    const audit = await saleAudit();
    expect(audit.map((a) => a.action).sort()).toEqual(['payment.recordOffline', 'subscription.create']);
    for (const a of audit) expect(a).toMatchObject({ entityId: sale.subscriptionId, memberId: m, branchId: central, actorUid: lib.uid });
    expect(audit.find((a) => a.action === 'payment.recordOffline')!.after).toMatchObject({ status: 'ACTIVE', paymentId: sale.paymentId, amountMinor: PRICE + DEPOSIT, method: 'OFFLINE_UPI' });
    expect(audit.find((a) => a.action === 'subscription.create')!.after).toMatchObject({ planId, kind: 'NEW', amountDue: sale.amountDue });

    // Nothing waits for payment, so the payment step has nothing to take.
    expect((await db.collection(`orgs/${org}/subscriptions`).where('status', '==', 'PENDING_PAYMENT').get()).size).toBe(0);
    expect(await failure(call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId: sale.subscriptionId, ...cash(PRICE + DEPOSIT) }))).toBe('NOT_PENDING');
  });

  it('a renewal paid before the term ends starts when it ends, and is kept as the next subscription', async () => {
    const m = await register('Asha');
    const first = await sell(m, cash(PRICE + DEPOSIT));
    const endsAt = Timestamp.fromMillis(Date.now() + 3 * DAY);
    await path(`subscriptions/${first.subscriptionId}`).update({ endAt: endsAt });

    const renewal = await sell(m, cash(PRICE)); // the deposit is already held
    expect(renewal.amountDue).toEqual({ subscriptionMinor: PRICE, depositMinor: 0, totalMinor: PRICE });
    expect(renewal.startAt).toBe(endsAt.toDate().toISOString());
    const sub = await get(`subscriptions/${renewal.subscriptionId}`);
    expect(sub).toMatchObject({ status: 'ACTIVE', kind: 'RENEWAL', previousSubscriptionId: first.subscriptionId, paymentId: renewal.paymentId });
    expect(sub.startAt.toMillis()).toBe(endsAt.toMillis());

    const member = await get(`members/${m}`);
    expect(member).toMatchObject({ activeSubscriptionId: first.subscriptionId, nextSubscriptionId: renewal.subscriptionId });
    expect(member.renewalDueAt.toMillis()).toBe(sub.endAt.toMillis());
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(DEPOSIT);
    expect(await ledgerOf(m)).toHaveLength(1);
    // Renewed once already: a third sale is refused, paid or not, and writes nothing.
    const counts = await written();
    expect(await failure(sell(m, cash(PRICE)))).toBe('RENEWAL_EXISTS');
    expect(await written()).toEqual(counts);
  });

  it('after a pre-paid renewal has started, the next renewal moves the member on in the same step', async () => {
    const m = await register('Asha');
    const first = await sell(m, cash(PRICE + DEPOSIT));
    await path(`subscriptions/${first.subscriptionId}`).update({ endAt: Timestamp.fromMillis(Date.now() + 3 * DAY) });
    const second = await sell(m, cash(PRICE));
    // Time passes: the first term is over and the pre-paid one is running, with three days left.
    const secondEnds = Timestamp.fromMillis(Date.now() + 3 * DAY);
    await path(`subscriptions/${first.subscriptionId}`).update({ startAt: Timestamp.fromMillis(Date.now() - 40 * DAY), endAt: Timestamp.fromMillis(Date.now() - DAY) });
    await path(`subscriptions/${second.subscriptionId}`).update({ startAt: Timestamp.fromMillis(Date.now() - DAY), endAt: secondEnds });

    const third = await sell(m, cash(PRICE));
    expect(third.startAt).toBe(secondEnds.toDate().toISOString());
    expect(await get(`subscriptions/${third.subscriptionId}`)).toMatchObject({ status: 'ACTIVE', kind: 'RENEWAL', previousSubscriptionId: second.subscriptionId });
    const member = await get(`members/${m}`);
    expect(member).toMatchObject({ activeSubscriptionId: second.subscriptionId, nextSubscriptionId: third.subscriptionId });
    expect(member.subscriptionEndsAt.toMillis()).toBe(secondEnds.toMillis());
  });

  it('charges only the deposit top-up the balance does not cover', async () => {
    const m = await register('Asha');
    const first = await sell(m, cash(PRICE + DEPOSIT));
    const { adjustmentId } = await call<{ adjustmentId: string }>(deposits.proposeAdjustment, fin, { orgId: org, memberId: m, kind: 'DEDUCTION', amountMinor: 25000, reason: 'Water damage' });
    await call(deposits.decideAdjustment, fin2, { orgId: org, adjustmentId, decision: 'APPROVE' });
    await path(`subscriptions/${first.subscriptionId}`).update({ endAt: Timestamp.fromMillis(Date.now() + 2 * DAY) });

    const counts = await written();
    expect(await failure(sell(m, cash(PRICE)))).toBe('INVALID_INPUT'); // the top-up is due as well
    expect(await written()).toEqual(counts);
    const renewal = await sell(m, cash(PRICE + 25000));
    expect(renewal.amountDue).toEqual({ subscriptionMinor: PRICE, depositMinor: 25000, totalMinor: PRICE + 25000 });
    expect((await get(`payments/${renewal.paymentId}`)).lines).toEqual([{ type: 'SUBSCRIPTION', amountMinor: PRICE }, { type: 'DEPOSIT', amountMinor: 25000 }]);
    const account = await get(`depositAccounts/${m}`);
    const ledger = await ledgerOf(m);
    expect(account.balanceMinor).toBe(DEPOSIT);
    expect(ledger.reduce((sum, e) => sum + e.deltaMinor, 0)).toBe(account.balanceMinor);
    expect(ledger.filter((e) => e.type === 'DEPOSIT_COLLECTED').map((e) => e.deltaMinor).sort((a, b) => a - b)).toEqual([25000, DEPOSIT]);
  });

  it('a member coming back opens the closed deposit again; a deposit being settled blocks the sale', async () => {
    const m = await register('Asha');
    const first = await sell(m, cash(PRICE + DEPOSIT));
    await path(`subscriptions/${first.subscriptionId}`).update({ endAt: Timestamp.fromMillis(Date.now() - 1000) });
    await call(deposits.startSettlement, fin, { orgId: org, memberId: m });
    const counts = await written();
    expect(await failure(sell(m, cash(PRICE)))).toBe('DEPOSIT_SETTLING');
    expect(await written()).toEqual(counts);
    await call(deposits.refund, fin, { orgId: org, memberId: m, method: 'OFFLINE_CASH' });
    expect(await get(`depositAccounts/${m}`)).toMatchObject({ balanceMinor: 0, status: 'CLOSED' });

    const back = await sell(m, cash(PRICE + DEPOSIT));
    expect(await get(`subscriptions/${back.subscriptionId}`)).toMatchObject({ status: 'ACTIVE', kind: 'NEW' });
    const account = await get(`depositAccounts/${m}`);
    expect(account).toMatchObject({ balanceMinor: DEPOSIT, status: 'OPEN' });
    expect(account.reopenedAt).toBeInstanceOf(Timestamp);
    expect((await ledgerOf(m)).reduce((sum, e) => sum + e.deltaMinor, 0)).toBe(DEPOSIT);
    const paid = (await saleAudit()).find((a) => a.action === 'payment.recordOffline' && a.entityId === back.subscriptionId)!;
    expect(paid.after).toMatchObject({ depositReopened: true });
  });

  it('refuses a wrong amount, a missing reference and people who may not take payments, and writes nothing', async () => {
    const m = await register('Asha');
    const none = { subscriptions: 0, payments: 0, audit: 0 };
    expect(await failure(sell(m, cash(PRICE)))).toBe('INVALID_INPUT'); // the deposit is due too
    expect(await failure(sell(m, cash(PRICE + DEPOSIT + 100)))).toBe('INVALID_INPUT');
    expect(await failure(sell(m, { method: 'OFFLINE_UPI', amountMinor: PRICE + DEPOSIT }))).toBe('INVALID_INPUT');
    expect(await failure(sell(m, { method: 'OFFLINE_CARD', amountMinor: PRICE + DEPOSIT, reference: 'abc' }))).toBe('INVALID_INPUT');
    expect(await failure(sell(m, { method: 'CHEQUE', amountMinor: PRICE + DEPOSIT }))).toBe('INVALID_INPUT');
    expect(await written()).toEqual(none);

    // Someone who may sell plans but not take payments: the paid sale is refused before anything else is said.
    const seller = await createUser('seller@stories.test');
    const { roleId } = await call<{ roleId: string }>(roles.save, sa, { orgId: org, name: 'Plan Seller', permissions: ['members.view', 'subscriptions.manage'] });
    await call(staff.setRoles, sa, { orgId: org, email: seller.email, roles: [], customRoles: [roleId], branchIds: [central] });
    expect(await failure(sell(m, cash(PRICE + DEPOSIT), seller))).toBe('FORBIDDEN');
    expect(await failure(sell(m, cash(1), seller))).toBe('FORBIDDEN'); // not told the amount due either
    await path(`members/${m}`).update({ status: 'SUSPENDED' });
    expect(await failure(sell(m, cash(PRICE + DEPOSIT), seller))).toBe('FORBIDDEN');
    expect(await failure(sell(m, cash(PRICE + DEPOSIT)))).toBe('MEMBER_INACTIVE');
    await path(`members/${m}`).update({ status: 'ACTIVE' });
    expect(await written()).toEqual(none);
    expect((await path(`depositAccounts/${m}`).get()).exists).toBe(false);
    expect((await get(`members/${m}`)).activeSubscriptionId).toBeNull();

    // They keep the two steps: the unpaid subscription is theirs to create, the payment is not theirs to take.
    const unpaid = await call<{ subscriptionId: string; amountDue: { totalMinor: number }; paymentId?: string }>(subs.create, seller, { orgId: org, memberId: m, planId });
    expect(unpaid.paymentId).toBeUndefined();
    expect((await get(`subscriptions/${unpaid.subscriptionId}`)).status).toBe('PENDING_PAYMENT');
    expect(await failure(call(subs.recordOfflinePayment, seller, { orgId: org, subscriptionId: unpaid.subscriptionId, ...cash(PRICE + DEPOSIT) }))).toBe('FORBIDDEN');
    // While one waits for payment, a paid sale is refused as well.
    expect(await failure(sell(m, cash(PRICE + DEPOSIT)))).toBe('PENDING_EXISTS');
    expect(await written()).toEqual({ subscriptions: 1, payments: 0, audit: 1 });
  });

  it('a retry with the same request id sells and charges once', async () => {
    const m = await register('Asha');
    const requestId = randomUUID();
    const a = await sell(m, cash(PRICE + DEPOSIT), lib, requestId);
    const b = await sell(m, cash(PRICE + DEPOSIT), lib, requestId);
    expect(b).toEqual(a);
    expect(b.paymentId).toBeTruthy();
    expect(await written()).toEqual({ subscriptions: 1, payments: 1, audit: 2 });
    expect(await ledgerOf(m)).toHaveLength(1);
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(DEPOSIT);
  });

  it('a retry with the same request id is the first sale again, whatever method or reference it now carries', async () => {
    // The console sends one request id for as long as the sale dialog is open (the answer to the first try may be lost).
    const m = await register('Asha');
    const first = await sell(m, cash(PRICE + DEPOSIT));
    await path(`subscriptions/${first.subscriptionId}`).update({ endAt: Timestamp.fromMillis(Date.now() + 29 * DAY) });
    const requestId = randomUUID();
    const a = await sell(m, { method: 'OFFLINE_UPI', amountMinor: PRICE, reference: 'UPI1234' }, lib, requestId);
    const counts = await written();
    expect(await sell(m, { method: 'OFFLINE_UPI', amountMinor: PRICE, reference: 'UPI12345' }, lib, requestId)).toEqual(a);
    expect(await sell(m, cash(PRICE), lib, requestId)).toEqual(a);
    expect(await written()).toEqual(counts);
    expect((await all('payments')).map((p) => p.get('reference')).sort()).toEqual(['UPI1234', null].sort());
  });

  it('two sales to a new member at the same moment sell one plan and take the deposit once', async () => {
    const m = await register('Asha');
    const results = await Promise.allSettled([sell(m, cash(PRICE + DEPOSIT)), sell(m, cash(PRICE + DEPOSIT))]);
    // The slower one runs again after the first commits: the member has the plan and the deposit is held, so it is
    // too early (a month of more than 30 days) or the amount no longer matches.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(['TOO_EARLY', 'INVALID_INPUT']).toContain(await failure(Promise.reject(refused.reason)));
    expect(await written()).toEqual({ subscriptions: 1, payments: 1, audit: 2 });
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(DEPOSIT);
    expect(await ledgerOf(m)).toHaveLength(1);
  });

  it('a second sale under a new request id is refused only while more than the renewal window is left', async () => {
    const m = await register('Asha');
    const first = await sell(m, cash(PRICE + DEPOSIT));
    const sub = path(`subscriptions/${first.subscriptionId}`);
    // Sold in a month of 31 days: more than the 30 days of the window are left, so it is too early.
    await sub.update({ endAt: Timestamp.fromMillis(Date.now() + 31 * DAY) });
    const counts = await written();
    expect(await failure(sell(m, cash(PRICE)))).toBe('TOO_EARLY');
    expect(await failure(sell(m, cash(PRICE + DEPOSIT)))).toBe('TOO_EARLY');
    expect(await written()).toEqual(counts);

    // Sold in a month of 30 days (or February): just under 30 days are left, which is inside the window. The server
    // cannot tell a repeat of the sale from the member renewing early, and takes the payment for the next term.
    // Only the request id stops a repeat from the same dialog (see the retry tests above).
    const endsAt = Timestamp.fromMillis(Date.now() + 30 * DAY - 60_000);
    await sub.update({ endAt: endsAt });
    const second = await sell(m, cash(PRICE));
    expect(second.startAt).toBe(endsAt.toDate().toISOString());
    expect(await get(`subscriptions/${second.subscriptionId}`)).toMatchObject({ status: 'ACTIVE', kind: 'RENEWAL', previousSubscriptionId: first.subscriptionId });
    expect(await get(`members/${m}`)).toMatchObject({ activeSubscriptionId: first.subscriptionId, nextSubscriptionId: second.subscriptionId });
    expect(await written()).toEqual({ subscriptions: 2, payments: 2, audit: 4 });
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(DEPOSIT);
    // One term ahead is the most that can be sold.
    expect(await failure(sell(m, cash(PRICE)))).toBe('RENEWAL_EXISTS');
    expect(await written()).toEqual({ subscriptions: 2, payments: 2, audit: 4 });
  });

  it('members cannot record a payment when they buy their own plan', async () => {
    const m = await register('Meera Rao');
    const meera = await createUser('meera@stories.test');
    await path(`members/${m}`).update({ accountHolderUid: meera.uid });
    expect(await failure(call(me.subscribe, meera, { orgId: org, memberId: m, planId, payment: cash(PRICE + DEPOSIT) }))).toBe('INVALID_INPUT');
    expect(await written()).toEqual({ subscriptions: 0, payments: 0, audit: 0 });
    // Their own purchase still waits for payment.
    const { subscriptionId } = await call<{ subscriptionId: string }>(me.subscribe, meera, { orgId: org, memberId: m, planId });
    expect(await get(`subscriptions/${subscriptionId}`)).toMatchObject({ status: 'PENDING_PAYMENT', paymentId: null });
    expect(await all('payments')).toHaveLength(0);
  });
});
