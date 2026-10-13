import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import * as catalog from '../../src/catalogue/books.js';
import * as res from '../../src/circulation/reservations.js';
import * as circ from '../../src/circulation/circulation.js';
import { db } from '../../src/core/firebase.js';
import { setCourierTransport, type HttpReply } from '../../src/delivery/couriers.js';
import * as dmember from '../../src/delivery/member.js';
import { istDate } from '../../src/delivery/model.js';
import * as orders from '../../src/delivery/orders.js';
import * as dsettings from '../../src/delivery/settings.js';
import { handleDeliveryWebhook } from '../../src/delivery/webhook.js';
import * as copies from '../../src/inventory/copies.js';
import * as me from '../../src/members/me.js';
import * as members from '../../src/members/members.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { clearSwitchboardCache } from '../../src/messaging/whatsapp.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, bm: TestUser, lib: TestUser, rider: TestUser, rider2: TestUser;
let org: string, central: string, deliveryPlan: string, counterPlan: string, authorId: string;

const get = async (p: string) => (await db.doc(`orgs/${org}/${p}`).get()).data()!;
const home = { ...address, landmark: 'Opposite the park', geo: { lat: 12.9716, lng: 77.5946 } };
const BRANCH_AT = { lat: 12.975, lng: 77.6 };

async function grant(u: TestUser, roles: string[], branchIds: string[]) {
  await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds });
}
async function newBook(title: string) {
  return (await call<{ bookId: string }>(catalog.create, sa, {
    title, isbn: '', authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
  })).bookId;
}
async function stock(title: string, n = 1) {
  const bookId = await newBook(title);
  const { codes } = await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: central, bookId, quantity: n, acquisitionCostMinor: 30000 });
  return { bookId, codes };
}
const acquire = async (title: string, n = 1) => (await stock(title, n)).codes;
async function register(fullName: string, extra: Record<string, unknown> = {}) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  return (await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName, dob: '1990-05-01', phone, address, ...extra })).memberId;
}
async function subscribe(memberId: string, planId = deliveryPlan) {
  const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
  await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
}
const settings = (extra: Record<string, unknown> = {}, by = bm) =>
  call(dsettings.saveSettings, by, {
    orgId: org, branchId: central, enabled: true, feeMinor: 5000, pincodes: ['560001'], slots: ['10:00–13:00', '15:00–19:00'],
    location: BRANCH_AT, methods: { OWN: true, MANUAL: true }, couriers: {}, ...extra,
  });
const request = (memberId: string, extra: Record<string, unknown> = {}, by = lib) =>
  call<{ deliveryId: string }>(orders.create, by, { orgId: org, branchId: central, memberId, kind: 'DELIVER', date: istDate(1), slot: '10:00–13:00', address: home, note: 'Any two adventure books', ...extra });
const delivery = (id: string) => get(`deliveries/${id}`);

/** Fake courier API: records calls; `routes` answers by "METHOD path". */
function fakeCourier(routes: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }>) {
  const calls: { method: string; path: string; body: Record<string, unknown>; key: string | undefined }[] = [];
  setCourierTransport(async (method, url, headers, body): Promise<HttpReply> => {
    const path = new URL(url).pathname;
    const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    calls.push({ method, path, body: parsed, key: headers['x-api-key'] });
    const route = routes[`${method} ${path}`];
    if (!route) return { status: 404, body: JSON.stringify({ message: 'not found' }) };
    const r = route(parsed);
    return { status: r.status ?? 200, body: JSON.stringify(r.json) };
  });
  return calls;
}

beforeEach(async () => {
  await resetEmulators();
  clearSwitchboardCache();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [bm, lib, rider, rider2] = await Promise.all(['bm', 'lib', 'rider', 'rider2'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await grant(bm, ['BRANCH_MANAGER'], [central]);
  await grant(lib, ['LIBRARIAN'], [central]);
  await grant(rider, ['DELIVERY_PERSON'], [central]);
  await grant(rider2, ['DELIVERY_PERSON'], [central]);
  authorId = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Ruskin Bond' })).id;
  const plan = (name: string, deliveryEligible: boolean) =>
    call<{ planId: string }>(plans.create, sa, {
      orgId: org, name, options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 0, maxSimultaneousBooks: 2,
      audiences: ['CHILDREN', 'TEENS', 'ADULTS'], deliveryEligible,
    });
  deliveryPlan = (await plan('Home Two', true)).planId;
  counterPlan = (await plan('Counter Two', false)).planId;
});
afterEach(() => setCourierTransport(null));

describe('delivery settings', () => {
  it('branch managers set fee, PIN codes, slots and ways to deliver; courier keys stay private', async () => {
    expect(await failure(settings({}, lib))).toBe('FORBIDDEN');
    expect(await failure(settings({ couriers: { PORTER: { enabled: true, environment: 'TEST', apiKey: '' } } }))).toBe('INVALID_INPUT');
    expect(await failure(settings({ location: null, couriers: { PORTER: { enabled: true, environment: 'TEST', apiKey: 'porter-key-123' } } }))).toBe('INVALID_INPUT');
    await settings({ couriers: { PORTER: { enabled: true, environment: 'TEST', apiKey: 'porter-key-123' } } });
    const branch = (await db.doc(`orgs/${org}/branches/${central}`).get()).data()!;
    expect(branch.delivery).toMatchObject({ enabled: true, feeMinor: 5000, pincodes: ['560001'], couriers: { PORTER: { enabled: true, environment: 'TEST', hasKey: true } } });
    expect(JSON.stringify(branch)).not.toContain('porter-key-123');
    // Saving again with the key left blank keeps it.
    await settings({ couriers: { PORTER: { enabled: true, environment: 'TEST', apiKey: '' } } });
    expect((await db.doc(`orgs/${org}/branches/${central}/private/delivery`).get()).get('couriers.PORTER.apiKey')).toBe('porter-key-123');

    const view = await call<{ riders: { name: string; delivery: boolean }[]; webhook: string | null; canConfigure: boolean }>(dsettings.settings, bm, { orgId: org, branchId: central }, null);
    expect(view.riders.filter((r) => r.delivery)).toHaveLength(2);
    expect(view.webhook).toMatch(/^deliveryWebhook\?o=.+&b=.+&t=[0-9a-f]{36}$/);
    const libView = await call<{ webhook: string | null; canConfigure: boolean }>(dsettings.settings, lib, { orgId: org, branchId: central }, null);
    expect(libView).toMatchObject({ webhook: null, canConfigure: false });
  });
});

describe('requests', () => {
  it('members book from the app when their plan includes delivery; one open delivery at a time', async () => {
    await settings();
    const memberId = await register('Asha Rao', { email: 'asha@stories.test' });
    const asha = await createUser('asha@stories.test');
    await call(me.overview, asha, {}, null);
    const ask = (extra: Record<string, unknown> = {}) =>
      call<{ deliveryId: string }>(dmember.requestDelivery, asha, { orgId: org, branchId: central, memberId, kind: 'DELIVER', date: istDate(1), slot: '10:00–13:00', address: home, note: 'Two mystery books please', ...extra });

    expect(await failure(ask())).toBe('NO_ACTIVE_SUBSCRIPTION');
    await subscribe(memberId, counterPlan);
    expect(await failure(ask())).toBe('PLAN_NO_DELIVERY');

    const m2 = await register('Ravi Kumar', { email: 'ravi@stories.test' });
    const ravi = await createUser('ravi@stories.test');
    await call(me.overview, ravi, {}, null);
    await subscribe(m2);
    const askRavi = (extra: Record<string, unknown> = {}) =>
      call<{ deliveryId: string }>(dmember.requestDelivery, ravi, { orgId: org, branchId: central, memberId: m2, kind: 'DELIVER', date: istDate(1), slot: '10:00–13:00', address: home, note: 'Any thrillers', ...extra });
    expect(await failure(askRavi({ address: { ...home, postalCode: '560099' } }))).toBe('NOT_SERVICEABLE');
    expect(await failure(askRavi({ slot: '20:00–22:00' }))).toBe('INVALID_INPUT');
    expect(await failure(askRavi({ date: istDate(30) }))).toBe('INVALID_INPUT');
    expect(await failure(askRavi({ note: '' }))).toBe('INVALID_INPUT');
    expect(await failure(call(dmember.requestDelivery, asha, { orgId: org, branchId: central, memberId: m2, kind: 'DELIVER', date: istDate(1), slot: '10:00–13:00', address: home, note: 'x books' }))).toBe('FORBIDDEN');

    const { deliveryId } = await askRavi();
    expect(await delivery(deliveryId)).toMatchObject({ status: 'REQUESTED', requestedBy: 'MEMBER', fee: { amountMinor: 5000, status: 'DUE' }, memberName: 'Ravi Kumar' });
    expect(await failure(askRavi())).toBe('DELIVERY_OPEN');
    const view = await call<{ memberships: { memberId: string; branch: { delivery: { enabled: boolean; slots: string[] } }; deliveries: { id: string }[] }[] }>(me.overview, ravi, {}, null);
    expect(view.memberships[0].branch.delivery).toMatchObject({ enabled: true, slots: ['10:00–13:00', '15:00–19:00'] });
    expect(view.memberships[0].deliveries.map((d) => d.id)).toEqual([deliveryId]);

    // Members cancel until it is dispatched.
    await call(dmember.cancelByMember, ravi, { orgId: org, deliveryId });
    expect(await delivery(deliveryId)).toMatchObject({ status: 'CANCELLED' });
  });
});

describe('own rider', () => {
  it('dispatch issues the books (a ready hold is fulfilled); the rider delivers and collects the fee', async () => {
    await settings();
    const memberId = await register('Asha Rao');
    await subscribe(memberId);
    const { bookId, codes: [held] } = await stock('Rusty Runs Away');
    const reservationId = (await call<{ reservationId: string }>(res.place, lib, { orgId: org, branchId: central, memberId, bookId })).reservationId;
    const [extra] = await acquire('The Blue Umbrella');
    const { deliveryId } = await request(memberId, { holdIds: [reservationId] });

    const dispatch = (input: Record<string, unknown>, by = lib) => call(orders.dispatch, by, { orgId: org, deliveryId, ...input });
    expect(await failure(dispatch({ method: 'OWN', riderUid: rider.uid, barcodes: [] }))).toBe('INVALID_INPUT');
    expect(await failure(dispatch({ method: 'OWN', riderUid: sa.uid, barcodes: [held] }))).toBe('RIDER_NOT_AT_BRANCH');
    await dispatch({ method: 'OWN', riderUid: rider.uid, barcodes: [held, extra] });

    const d = await delivery(deliveryId);
    expect(d).toMatchObject({ status: 'OUT', method: 'OWN', rider: { uid: rider.uid }, fee: { status: 'DUE' } });
    expect(d.sent.map((s: { copyCode: string }) => s.copyCode).sort()).toEqual([held, extra].sort());
    const loan = await get(`loans/${d.sent[0].loanId}`);
    expect(loan).toMatchObject({ status: 'ACTIVE', channel: 'DELIVERY', deliveryId });
    expect(await get(`reservations/${reservationId}`)).toMatchObject({ status: 'FULFILLED' });
    expect(await get(`members/${memberId}`)).toMatchObject({ activeLoanCount: 2, allocatedCount: 0 });

    // Only the assigned rider (or a manager) reports; the fee is recorded as a payment.
    const report = (by: TestUser, extra2: Record<string, unknown> = {}) => call(orders.report, by, { orgId: org, deliveryId, outcome: 'DELIVERED', handedTo: 'Asha', ...extra2 });
    expect(await failure(report(rider2))).toBe('FORBIDDEN');
    expect(await failure(report(rider, { fee: { method: 'OFFLINE_UPI', reference: '' } }))).toBe('INVALID_INPUT');
    await report(rider, { fee: { method: 'OFFLINE_CASH' } });
    const done = await delivery(deliveryId);
    expect(done).toMatchObject({ status: 'COMPLETED', outcome: 'DELIVERED', fee: { status: 'PAID', method: 'OFFLINE_CASH' } });
    expect(await get(`payments/${done.fee.paymentId}`)).toMatchObject({ purpose: 'DELIVERY_FEE', amountMinor: 5000, direction: 'IN', deliveryId });
    const mine = await call<{ deliveries: unknown[] }>(orders.mine, rider, { orgId: org }, null);
    expect(mine.deliveries).toHaveLength(0);
  });

  it('an exchange may go out at the plan limit; collected books are returned when the bag is back', async () => {
    await settings({ feeMinor: 0 });
    const memberId = await register('Asha Rao');
    await subscribe(memberId);
    const [a, b, c] = await acquire('Angry River', 3);
    await call(circ.issue, lib, { orgId: org, branchId: central, memberId, barcodes: [a, b] });
    const loans = (await db.collection(`orgs/${org}/loans`).where('memberId', '==', memberId).get()).docs;
    const giveBack = loans.find((l) => l.get('copyCode') === a)!.id;
    const { deliveryId } = await request(memberId, { kind: 'EXCHANGE', collectLoanIds: [giveBack] });
    expect((await delivery(deliveryId)).fee).toEqual({ amountMinor: 0, status: 'FREE' });

    await call(orders.dispatch, lib, { orgId: org, deliveryId, method: 'OWN', riderUid: rider.uid, barcodes: [c] });
    const mine = await call<{ deliveries: { id: string; memberLoans: { loanId: string }[] }[] }>(orders.mine, rider, { orgId: org }, null);
    expect(mine.deliveries[0].memberLoans.map((l) => l.loanId).sort()).toEqual(loans.map((l) => l.id).sort());
    await call(orders.report, rider, { orgId: org, deliveryId, outcome: 'DELIVERED', collectedLoanIds: [giveBack] });
    expect(await delivery(deliveryId)).toMatchObject({ status: 'RETURNING', collected: [{ copyCode: a }] });

    expect(await failure(call(orders.receive, rider, { orgId: org, deliveryId }))).toBe('FORBIDDEN');
    await call(orders.receive, lib, { orgId: org, deliveryId });
    expect(await delivery(deliveryId)).toMatchObject({ status: 'COMPLETED' });
    expect(await get(`loans/${giveBack}`)).toMatchObject({ status: 'RETURNED' });
    const copy = (await db.collection(`orgs/${org}/copies`).where('code', '==', a).get()).docs[0].data();
    expect(copy.status).toBe('UNDER_INSPECTION');
    expect(await get(`members/${memberId}`)).toMatchObject({ activeLoanCount: 2, lifetimeExchanges: 1 });
  });

  it('a failed delivery brings the books back; they are returned when received', async () => {
    await settings();
    const memberId = await register('Asha Rao');
    await subscribe(memberId);
    const [a] = await acquire('Room on the Roof');
    const { deliveryId } = await request(memberId);
    await call(orders.dispatch, lib, { orgId: org, deliveryId, method: 'MANUAL', courier: { name: 'Local courier', reference: 'LC-1', trackingUrl: '' }, barcodes: [a] });
    expect(await delivery(deliveryId)).toMatchObject({ method: 'MANUAL', courier: { name: 'Local courier', reference: 'LC-1', trackingUrl: null } });
    expect(await failure(call(orders.report, lib, { orgId: org, deliveryId, outcome: 'FAILED' }))).toBe('INVALID_INPUT');
    await call(orders.report, lib, { orgId: org, deliveryId, outcome: 'FAILED', failReason: 'Nobody at home' });
    expect(await delivery(deliveryId)).toMatchObject({ status: 'RETURNING', outcome: 'FAILED', failReason: 'Nobody at home' });
    await call(orders.receive, lib, { orgId: org, deliveryId });
    const d = await delivery(deliveryId);
    expect(d).toMatchObject({ status: 'FAILED' });
    expect(await get(`loans/${d.sent[0].loanId}`)).toMatchObject({ status: 'RETURNED', returnReason: 'DELIVERY_FAILED' });
    expect(await get(`members/${memberId}`)).toMatchObject({ activeLoanCount: 0 });
    // The fee was never collected: it can be waived.
    await call(orders.recordFee, lib, { orgId: org, deliveryId, method: 'WAIVED' });
    expect((await delivery(deliveryId)).fee).toMatchObject({ status: 'FREE' });
  });
});

describe('courier apps (Porter)', () => {
  it('quotes, books with the API key and both map points, tracks to delivered, and takes webhooks', async () => {
    await settings({ couriers: { PORTER: { enabled: true, environment: 'TEST', apiKey: 'porter-key-123' } } });
    let status = 'open';
    const calls = fakeCourier({
      'GET /v1/get_quote': () => ({ json: { vehicles: [{ type: '2 Wheeler', fare: { currency: 'INR', minor_amount: 8556 }, eta: { value: 9, unit: 'min' } }] } }),
      'POST /v1/orders/create': (b) => ({ json: { request_id: b.request_id, order_id: 'CRN123', estimated_fare_details: { currency: 'INR', minor_amount: 8556 }, tracking_url: 'https://porter.in/track/CRN123' } }),
      'GET /v1/orders/CRN123': () => ({ json: { order_id: 'CRN123', status, partner_info: { name: 'Raju', mobile: { country_code: '+91', mobile_number: '9876500000' }, vehicle_number: 'KA01AB1234' }, fare_details: { actual_fare_details: status === 'ended' ? { minor_amount: 9000 } : null, estimated_fare_details: { minor_amount: 8556 } } } }),
    });
    const memberId = await register('Asha Rao');
    await subscribe(memberId);
    const [a] = await acquire('Cherry Tree');

    // Couriers need the member's map point; exchanges need two trips.
    const noPin = (await request(memberId, { address: { ...home, geo: null } })).deliveryId;
    expect(await failure(call(orders.dispatch, lib, { orgId: org, deliveryId: noPin, method: 'PORTER', barcodes: [a] }))).toBe('NO_MEMBER_LOCATION');
    await call(orders.cancel, lib, { orgId: org, deliveryId: noPin, reason: 'Wrong address' });

    const { deliveryId } = await request(memberId);
    const q = await call<{ fares: { vehicle: string; fareMinor: number; etaMinutes: number }[] }>(orders.quote, lib, { orgId: org, deliveryId, courier: 'PORTER' }, null);
    expect(q.fares).toEqual([{ vehicle: '2 Wheeler', fareMinor: 8556, etaMinutes: 9 }]);
    expect(calls[0]).toMatchObject({ method: 'GET', key: 'porter-key-123', body: { pickup_details: BRANCH_AT, drop_details: home.geo } });

    await call(orders.dispatch, lib, { orgId: org, deliveryId, method: 'PORTER', barcodes: [a] });
    const booked = calls.find((c) => c.path === '/v1/orders/create')!;
    expect(booked.body).toMatchObject({
      request_id: deliveryId,
      pickup_details: { address: { lat: BRANCH_AT.lat, lng: BRANCH_AT.lng, pincode: '560001', contact_details: { name: 'Stories Central' } } },
      drop_details: { address: { lat: home.geo.lat, lng: home.geo.lng, landmark: 'Opposite the park', contact_details: { name: 'Asha Rao' } } },
    });
    expect((await delivery(deliveryId)).provider).toMatchObject({ key: 'PORTER', orderId: 'CRN123', status: 'BOOKED', trackingUrl: 'https://porter.in/track/CRN123', fareMinor: 8556 });

    // Status: the webhook (with the branch's token) makes Stories ask Porter.
    const token = (await db.doc(`orgs/${org}/branches/${central}/private/delivery`).get()).get('webhookToken') as string;
    const hook = async (t: string, body: unknown) => {
      const out = { status: 0 };
      const res = { status: (n: number) => ({ send: () => void Object.assign(out, { status: n }) }) };
      await handleDeliveryWebhook({ method: 'POST', query: { o: org, b: central, t }, body, rawBody: Buffer.from(JSON.stringify(body)) } as never, res);
      return out.status;
    };
    expect(await hook('wrong', { order_id: 'CRN123' })).toBe(401);
    status = 'accepted';
    expect(await hook(token, { order_id: 'CRN123', event: 'order_accepted' })).toBe(200);
    expect((await delivery(deliveryId)).provider).toMatchObject({ status: 'ASSIGNED', partner: { name: 'Raju', phone: '+919876500000', vehicleNumber: 'KA01AB1234' } });
    status = 'ended';
    expect(await hook(token, { order_id: 'CRN123', event: 'order_end_job' })).toBe(200);
    expect(await delivery(deliveryId)).toMatchObject({ status: 'COMPLETED', outcome: 'DELIVERED', provider: { status: 'DELIVERED', fareMinor: 9000 } });
  });

  it('a failed booking is saved for staff to retry; cancelling cancels at the courier and brings the books back', async () => {
    await settings({ couriers: { PORTER: { enabled: true, environment: 'LIVE', apiKey: 'porter-key-123' } } });
    let fail = true;
    const calls = fakeCourier({
      'POST /v1/orders/create': () => (fail ? { status: 400, json: { message: 'Drop location is not serviceable' } } : { json: { order_id: 'CRN9' } }),
      'POST /v1/orders/CRN9/cancel': () => ({ json: { code: 200, message: 'order got cancelled successfully!!' } }),
    });
    const memberId = await register('Asha Rao');
    await subscribe(memberId);
    const [a] = await acquire('Flight of Pigeons');
    const { deliveryId } = await request(memberId);
    await call(orders.dispatch, lib, { orgId: org, deliveryId, method: 'PORTER', barcodes: [a] });
    expect((await delivery(deliveryId)).provider).toMatchObject({ status: 'BOOKING_FAILED', error: 'Porter: Drop location is not serviceable', orderId: null });

    fail = false;
    await call(orders.book, lib, { orgId: org, deliveryId }, null);
    expect(calls.filter((c) => c.path === '/v1/orders/create').map((c) => c.body.request_id)).toEqual([deliveryId, `${deliveryId}-2`]);
    expect((await delivery(deliveryId)).provider).toMatchObject({ status: 'BOOKED', orderId: 'CRN9' });
    expect(await failure(call(orders.book, lib, { orgId: org, deliveryId }, null))).toBe('ALREADY_BOOKED');

    await call(orders.cancel, lib, { orgId: org, deliveryId, reason: 'Member called to postpone' });
    expect(calls.some((c) => c.path === '/v1/orders/CRN9/cancel')).toBe(true);
    expect(await delivery(deliveryId)).toMatchObject({ status: 'RETURNING', outcome: 'FAILED', provider: { status: 'CANCELLED' } });
    await call(orders.receive, lib, { orgId: org, deliveryId });
    expect(await delivery(deliveryId)).toMatchObject({ status: 'FAILED' });
  });
});
