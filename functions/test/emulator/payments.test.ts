import { createHmac, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as branches from '../../src/organization/branches.js';
import { db } from '../../src/core/firebase.js';
import * as members from '../../src/members/members.js';
import * as orgs from '../../src/organization/orgs.js';
import * as online from '../../src/billing/online.js';
import * as staff from '../../src/organization/staff.js';
import * as plans from '../../src/billing/plans.js';
import * as refunds from '../../src/billing/refunds.js';
import * as subs from '../../src/billing/subscriptions.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, lib: TestUser;
let org: string, central: string, memberId: string, subscriptionId: string, due: number;
const KEY = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'sekret-123', webhookSecret: 'whsec-456' };

/** Fake Razorpay: records calls; `routes` answers by "METHOD path". Everything else (emulators) is real. */
function fakeRazorpay(routes: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }>) {
  const calls: { method: string; path: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.razorpay.com/v1')) return real(input, init);
    const method = init?.method ?? 'GET';
    const path = url.slice('https://api.razorpay.com/v1'.length).split('?')[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, path, body, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    const route = routes[`${method} ${path}`];
    if (!route) return Response.json({ error: { code: 'BAD_REQUEST_ERROR', description: 'The requested URL was not found on the server.' } }, { status: 400 });
    const r = route(body);
    return Response.json(r.json, { status: r.status ?? 200 });
  });
  return calls;
}

const link = { 'POST /payment_links': () => ({ json: { id: 'plink_1', short_url: 'https://rzp.io/i/abc', status: 'created' } }) };
const gateway = (extra: Record<string, unknown> = {}, by = sa) =>
  call(online.setGateway, by, { orgId: org, branchId: central, enabled: true, ...KEY, notifySms: true, notifyEmail: true, ...extra });
const createReq = (channel: 'LINK' | 'QR', requestId: string = randomUUID(), by = lib) =>
  call<{ requestId: string; channel: string; url: string | null; qrImageUrl: string | null; sentTo: { sms: string | null; email: string | null } }>(
    online.createRequest, by, { orgId: org, subscriptionId, channel, requestId }, null,
  );

function webhook(body: unknown, secret = KEY.webhookSecret) {
  const raw = Buffer.from(JSON.stringify(body));
  const out = { status: 0, body: '' };
  const res = { status: (n: number) => ({ send: (b: string) => void Object.assign(out, { status: n, body: b }) }) };
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return online
    .handleWebhook({ method: 'POST', query: { o: org, b: central }, headers: { 'x-razorpay-signature': signature }, rawBody: raw } as never, res)
    .then(() => out);
}
const paidLink = (amount: number, id = 'plink_1') => ({
  event: 'payment_link.paid',
  payload: { payment_link: { entity: { id, status: 'paid' } }, payment: { entity: { id: 'pay_9', amount, status: 'captured', method: 'upi' } } },
});

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  lib = await createUser('lib@stories.test');
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
  const planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Monthly Two', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 100000, maxSimultaneousBooks: 2, audiences: ['ADULTS'],
  })).planId;
  memberId = (await call<{ memberId: string }>(members.register, lib, {
    orgId: org, homeBranchId: central, fullName: 'Asha Rao', dob: '1990-05-01', phone: '9876500001', email: 'asha@example.com',
  })).memberId;
  const s = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
  subscriptionId = s.subscriptionId;
  due = s.amountDue.totalMinor;
});
afterEach(() => vi.restoreAllMocks());

describe('Razorpay settings per branch', () => {
  it('keeps secrets out of readable documents and write-only', async () => {
    expect(await failure(gateway({}, lib))).toBe('FORBIDDEN');
    await gateway();
    const branch = (await db.doc(`orgs/${org}/branches/${central}`).get()).get('payments.razorpay');
    expect(branch).toMatchObject({ enabled: true, keyId: KEY.keyId, mode: 'test', hasWebhookSecret: true });
    expect(JSON.stringify(branch)).not.toContain('sekret');
    // Blank secrets keep the saved ones.
    await gateway({ keySecret: '', webhookSecret: '', notifySms: false });
    const secret = (await db.doc(`orgs/${org}/branches/${central}/private/razorpay`).get()).data();
    expect(secret).toMatchObject({ keySecret: 'sekret-123', webhookSecret: 'whsec-456' });
    // A new key ID needs its own secret.
    expect(await failure(gateway({ keyId: 'rzp_live_ZZZZZZZZ1234', keySecret: '' }))).toBe('INVALID_INPUT');
    expect(await failure(gateway({ keyId: 'not-a-key' }))).toBe('INVALID_INPUT');
    const audit = await db.collection(`orgs/${org}/auditLogs`).where('action', '==', 'branch.paymentGateway').get();
    expect(JSON.stringify(audit.docs.map((d) => d.data()))).not.toMatch(/sekret|whsec/);
  });
});

describe('collecting a subscription payment online', () => {
  it('refuses when the branch has no gateway', async () => {
    fakeRazorpay(link);
    expect(await failure(createReq('LINK'))).toBe('GATEWAY_NOT_CONFIGURED');
  });

  it('sends a payment link by SMS and email, once per request, and reuses an open link', async () => {
    await gateway();
    const calls = fakeRazorpay(link);
    const rid = randomUUID();
    const first = await createReq('LINK', rid);
    expect(first).toMatchObject({ channel: 'LINK', url: 'https://rzp.io/i/abc', sentTo: { sms: '+919876500001', email: 'asha@example.com' } });
    expect(calls[0].body).toMatchObject({ amount: due, currency: 'INR', notify: { sms: true, email: true }, customer: { contact: '+919876500001', email: 'asha@example.com' } });
    expect(calls[0].auth).toBe(`Basic ${Buffer.from(`${KEY.keyId}:${KEY.keySecret}`).toString('base64')}`);
    expect((await createReq('LINK', rid)).requestId).toBe('plink_1'); // retried call
    expect((await createReq('LINK')).requestId).toBe('plink_1'); // still open: reused
    expect(calls).toHaveLength(1);
  });

  it('shows a UPI QR code, falling back to a link QR when the account has no QR codes', async () => {
    await gateway();
    let calls = fakeRazorpay({ 'POST /payments/qr_codes': () => ({ json: { id: 'qr_1', image_url: 'https://rzp.io/qr/1.png', status: 'active' } }) });
    expect(await createReq('QR')).toMatchObject({ channel: 'QR', qrImageUrl: 'https://rzp.io/qr/1.png' });
    expect(calls[0].body).toMatchObject({ type: 'upi_qr', usage: 'single_use', fixed_amount: true, payment_amount: due });
    await call(online.cancelRequest, lib, { orgId: org, paymentRequestId: 'qr_1' }).catch(() => undefined);
    vi.restoreAllMocks();

    await db.doc(`orgs/${org}/paymentRequests/qr_1`).update({ status: 'CANCELLED' });
    calls = fakeRazorpay(link);
    const fallback = await createReq('QR');
    expect(fallback).toMatchObject({ channel: 'QR_LINK', url: 'https://rzp.io/i/abc', sentTo: { sms: null, email: null } });
    expect(calls.find((c) => c.path === '/payment_links')?.body).toMatchObject({ notify: { sms: false, email: false } });
  });

  it('activates the subscription when the webhook reports the payment, exactly once', async () => {
    await gateway();
    fakeRazorpay(link);
    await createReq('LINK');
    expect((await webhook(paidLink(due), 'wrong-secret')).status).toBe(401);
    expect((await webhook(paidLink(due))).status).toBe(200);
    expect((await webhook(paidLink(due))).body).toBe('ALREADY_PAID');

    const sub = (await db.doc(`orgs/${org}/subscriptions/${subscriptionId}`).get()).data()!;
    expect(sub.status).toBe('ACTIVE');
    expect((await db.doc(`orgs/${org}/members/${memberId}`).get()).get('activeSubscriptionId')).toBe(subscriptionId);
    const payments = await db.collection(`orgs/${org}/payments`).where('memberId', '==', memberId).get();
    expect(payments.docs.map((d) => [d.get('method'), d.get('reference'), d.get('amountMinor')])).toEqual([['ONLINE_LINK', 'pay_9', due]]);
    expect((await db.doc(`orgs/${org}/depositAccounts/${memberId}`).get()).get('balanceMinor')).toBe(100000);
    expect((await db.doc(`orgs/${org}/paymentRequests/plink_1`).get()).get('status')).toBe('PAID');
  });

  it('flags a payment it cannot apply instead of activating', async () => {
    await gateway();
    fakeRazorpay(link);
    await createReq('LINK');
    const r = await webhook(paidLink(due - 100));
    expect(r.body).toBe('NEEDS_ATTENTION');
    expect((await db.doc(`orgs/${org}/subscriptions/${subscriptionId}`).get()).get('status')).toBe('PENDING_PAYMENT');
    const pay = await db.collection(`orgs/${org}/payments`).where('memberId', '==', memberId).get();
    expect(pay.docs[0].get('status')).toBe('NEEDS_ATTENTION');
  });

  it('checks the status with Razorpay when the webhook is not set up', async () => {
    await gateway({ webhookSecret: '' });
    fakeRazorpay({
      ...link,
      'GET /payment_links/plink_1': () => ({ json: { id: 'plink_1', status: 'paid', payments: [{ payment_id: 'pay_7', amount: due, status: 'captured', method: 'upi' }] } }),
    });
    await createReq('LINK');
    const r = await call<{ status: string; applied: boolean }>(online.checkRequest, lib, { orgId: org, paymentRequestId: 'plink_1' }, null);
    expect(r).toMatchObject({ status: 'PAID', applied: true });
    expect((await db.doc(`orgs/${org}/subscriptions/${subscriptionId}`).get()).get('status')).toBe('ACTIVE');
  });

  it('cancels an open link', async () => {
    await gateway();
    const calls = fakeRazorpay({ ...link, 'POST /payment_links/plink_1/cancel': () => ({ json: { id: 'plink_1', status: 'cancelled' } }) });
    await createReq('LINK');
    await call(online.cancelRequest, lib, { orgId: org, paymentRequestId: 'plink_1' });
    expect(calls.some((c) => c.path === '/payment_links/plink_1/cancel')).toBe(true);
    expect((await db.doc(`orgs/${org}/paymentRequests/plink_1`).get()).get('status')).toBe('CANCELLED');
  });
});

describe('refunds', () => {
  const refundOf = (paymentId: string, extra: Record<string, unknown>, by = lib, requestId: string = randomUUID()) =>
    call<{ refundId: string; status: string; gatewayRefundId: string | null }>(
      refunds.refundPayment, by, { orgId: org, paymentId, reason: 'Member moved away', requestId, ...extra }, null,
    );
  const onlinePayment = async (routes: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }> = {}) => {
    await gateway();
    const calls = fakeRazorpay({ ...link, ...routes });
    await createReq('LINK');
    await webhook(paidLink(due));
    const pay = await db.collection(`orgs/${org}/payments`).where('memberId', '==', memberId).get();
    return { calls, paymentId: pay.docs[0].id };
  };
  const deposit = async () => (await db.doc(`orgs/${org}/depositAccounts/${memberId}`).get()).get('balanceMinor') as number;
  const processed = (body: Record<string, unknown>) => ({ json: { id: 'rfnd_1', amount: body.amount, status: 'processed' } });

  it('a librarian refunds part of an online payment through Razorpay, with part of the deposit', async () => {
    const { calls, paymentId } = await onlinePayment({ 'POST /payments/pay_9/refund': processed });
    const r = await refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 50000, depositMinor: 40000 });
    expect(r).toMatchObject({ status: 'SUCCESS', gatewayRefundId: 'rfnd_1' });
    const call0 = calls.find((c) => c.path === '/payments/pay_9/refund')!;
    expect(call0.body).toMatchObject({ amount: 50000, speed: 'normal', receipt: r.refundId });
    const original = await db.doc(`orgs/${org}/payments/${paymentId}`).get();
    expect(original.get('refundedMinor')).toBe(50000);
    const out = await db.doc(`orgs/${org}/payments/${r.refundId}`).get();
    expect(out.data()).toMatchObject({ direction: 'OUT', purpose: 'REFUND', refundOf: paymentId, amountMinor: 50000, memberId });
    expect(await deposit()).toBe(100000 - 40000);
    // No more than what is left; a counter method can't refund an online payment.
    expect(await failure(refundOf(paymentId, { method: 'RAZORPAY', amountMinor: due - 50000 + 100 }))).toBe('INVALID_INPUT');
    expect(await failure(refundOf(paymentId, { method: 'OFFLINE_CASH', amountMinor: 1000 }))).toBe('INVALID_INPUT');
  });

  it('gives the amount back when Razorpay refuses (e.g. low balance), and never refunds twice', async () => {
    const { calls, paymentId } = await onlinePayment({
      'POST /payments/pay_9/refund': () => ({ status: 400, json: { error: { code: 'BAD_REQUEST_ERROR', description: 'Your account does not have enough balance to carry out the refund operation.' } } }),
    });
    expect(await failure(refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 30000 }))).toBe('GATEWAY_ERROR');
    const original = await db.doc(`orgs/${org}/payments/${paymentId}`).get();
    expect(original.get('refundedMinor')).toBe(0);
    const failed = await db.collection(`orgs/${org}/payments`).where('purpose', '==', 'REFUND').get();
    expect(failed.docs.map((d) => d.get('status'))).toEqual(['FAILED']);
    expect(await deposit()).toBe(100000);

    // Retrying the same request answers with the same refund, without asking Razorpay again.
    vi.restoreAllMocks();
    const calls2 = fakeRazorpay({ 'POST /payments/pay_9/refund': processed });
    const requestId = randomUUID();
    const a = await refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 30000 }, lib, requestId);
    const b = await refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 30000 }, lib, requestId);
    expect(b.refundId).toBe(a.refundId);
    expect(calls2.filter((c) => c.path === '/payments/pay_9/refund')).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('marks a pending refund refunded when Razorpay reports it, or restores it when it fails', async () => {
    let n = 0;
    const { paymentId } = await onlinePayment({
      'POST /payments/pay_9/refund': (body) => ({ json: { id: `rfnd_${++n}`, amount: body.amount, status: 'pending' } }),
      'GET /refunds/rfnd_2': () => ({ json: { id: 'rfnd_2', amount: 20000, status: 'failed' } }),
    });
    const first = await refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 10000, depositMinor: 10000 });
    expect(first.status).toBe('PENDING');
    expect(await deposit()).toBe(90000);
    const r = await webhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', amount: 10000, status: 'processed', notes: { refundId: first.refundId } } } } });
    expect(r.status).toBe(200);
    expect((await db.doc(`orgs/${org}/payments/${first.refundId}`).get()).get('status')).toBe('SUCCESS');

    const second = await refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 20000, depositMinor: 20000 });
    expect(await deposit()).toBe(70000);
    const checked = await call<{ status: string }>(refunds.checkRefund, lib, { orgId: org, refundId: second.refundId }, null);
    expect(checked.status).toBe('FAILED');
    expect(await deposit()).toBe(90000);
    expect((await db.doc(`orgs/${org}/payments/${paymentId}`).get()).get('refundedMinor')).toBe(10000);
  });

  it('records a counter refund for a counter payment, only for staff who may refund', async () => {
    await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: due });
    const paymentId = (await db.collection(`orgs/${org}/payments`).where('memberId', '==', memberId).get()).docs[0].id;
    expect(await failure(refundOf(paymentId, { method: 'RAZORPAY', amountMinor: 1000 }))).toBe('INVALID_INPUT');
    expect(await failure(refundOf(paymentId, { method: 'OFFLINE_UPI', amountMinor: 1000 }))).toBe('INVALID_INPUT'); // needs a reference
    const stranger = await createUser('someone@stories.test');
    expect(await failure(refundOf(paymentId, { method: 'OFFLINE_CASH', amountMinor: 1000 }, stranger))).toBe('FORBIDDEN');
    const r = await refundOf(paymentId, { method: 'OFFLINE_UPI', reference: 'UPI12345', amountMinor: due, depositMinor: 100000 });
    expect(r.status).toBe('SUCCESS');
    expect(await deposit()).toBe(0);
    expect(await failure(refundOf(paymentId, { method: 'OFFLINE_CASH', amountMinor: 1000 }))).toBe('FULLY_REFUNDED');
  });
});
