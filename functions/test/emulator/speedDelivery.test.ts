import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import * as catalog from '../../src/catalogue/books.js';
import { db } from '../../src/core/firebase.js';
import * as courier from '../../src/delivery/courierBooking.js';
import { setCourierTransport, type HttpReply } from '../../src/delivery/couriers.js';
import * as dmember from '../../src/delivery/member.js';
import { istDate } from '../../src/delivery/model.js';
import * as lists from '../../src/delivery/orderQueries.js';
import * as orders from '../../src/delivery/orders.js';
import * as dsettings from '../../src/delivery/settings.js';
import * as copies from '../../src/inventory/copies.js';
import * as me from '../../src/members/me.js';
import * as members from '../../src/members/members.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { clearSwitchboardCache } from '../../src/messaging/whatsapp.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// Home delivery, the faster paths: the waiting counts, the board without its closed list, the address remembered
// for the next booking, a morning run dispatched (and bags received) side by side, and courier orders refreshed together.

let sa: TestUser, lib: TestUser, libNorth: TestUser, rider: TestUser;
let org: string, central: string, north: string, planId: string, authorId: string;

const get = async (p: string) => (await db.doc(`orgs/${org}/${p}`).get()).data()!;
const home = { ...address, landmark: 'Opposite the park', geo: { lat: 12.9716, lng: 77.5946 } };
/** The address as it is stored: the schema fills the empty second line. */
const stored = (a: Record<string, unknown>) => ({ line2: '', ...a });
const delivery = (id: string) => get(`deliveries/${id}`);
const audits = async (action: string) => (await db.collection(`orgs/${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());

async function acquire(title: string) {
  const { bookId } = await call<{ bookId: string }>(catalog.create, sa, {
    title, isbn: '', authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
  });
  return (await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: central, bookId, quantity: 1, acquisitionCostMinor: 30000 })).codes[0];
}
async function register(fullName: string, extra: Record<string, unknown> = {}) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const { memberId } = await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName, dob: '1990-05-01', phone, address, ...extra });
  return { memberId, phone };
}
/** A member with a paid plan that includes home delivery. */
async function subscriber(fullName: string, extra: Record<string, unknown> = {}) {
  const { memberId } = await register(fullName, extra);
  const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
  await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
  return memberId;
}
const settings = (branchId = central, extra: Record<string, unknown> = {}) =>
  call(dsettings.saveSettings, sa, {
    orgId: org, branchId, enabled: true, feeMinor: 0, pincodes: ['560001'], slots: [], location: { lat: 12.975, lng: 77.6 },
    methods: { OWN: true, MANUAL: true }, couriers: {}, ...extra,
  });
const request = async (memberId: string, extra: Record<string, unknown> = {}, by = lib) =>
  (await call<{ deliveryId: string }>(orders.create, by, { orgId: org, branchId: central, memberId, kind: 'DELIVER', date: istDate(1), slot: null, address: home, note: 'Any two adventure books', ...extra })).deliveryId;
const send = (deliveryId: string, barcodes: string[], extra: Record<string, unknown> = {}) =>
  call(orders.dispatch, lib, { orgId: org, deliveryId, method: 'OWN', riderUid: rider.uid, barcodes, ...extra });

beforeEach(async () => {
  await resetEmulators();
  clearSwitchboardCache();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [lib, libNorth, rider] = await Promise.all(['lib', 'libnorth', 'rider'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: libNorth.email, roles: ['LIBRARIAN'], branchIds: [north] });
  await call(staff.setRoles, sa, { orgId: org, email: rider.email, roles: ['DELIVERY_PERSON'], branchIds: [central] });
  authorId = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Ruskin Bond' })).id;
  planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Home Two', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 0, maxSimultaneousBooks: 2,
    audiences: ['CHILDREN', 'TEENS', 'ADULTS'], deliveryEligible: true,
  })).planId;
});
afterEach(() => setCourierTransport(null));

describe('the board and its counts', () => {
  it('counts what waits at the branch, lists the closed visits only when asked, and takes a run side by side', async () => {
    await Promise.all([settings(), settings(north)]);
    const people: string[] = [];
    for (const name of ['Asha Rao', 'Ravi Kumar', 'Nita Shah', 'Maya Iyer', 'Dev Menon', 'Tara Bose']) people.push(await subscriber(name));
    const [waiting, out, done, backA, backB, dropped] = people;
    const [bOut, bDone, bBackA, bBackB] = [await acquire('Angry River'), await acquire('The Night Train'), await acquire('Cherry Tree'), await acquire('Rusty Runs Away')];
    const [dWaiting, dOut, dDone, dBackA, dBackB, dDropped] = [await request(waiting), await request(out), await request(done), await request(backA), await request(backB), await request(dropped)];
    const dNorth = await request((await register('Kiran Das')).memberId, { branchId: north }, sa);

    // The morning run: several visits dispatched at the same moment, each its own command.
    await Promise.all([send(dOut, [bOut]), send(dDone, [bDone]), send(dBackA, [bBackA]), send(dBackB, [bBackB])]);
    expect((await audits('delivery.dispatch')).map((a) => a.entityId).sort()).toEqual([dOut, dDone, dBackA, dBackB].sort());
    for (const m of [out, done, backA, backB]) expect(await get(`members/${m}`)).toMatchObject({ activeLoanCount: 1 });
    await call(orders.report, rider, { orgId: org, deliveryId: dDone, outcome: 'DELIVERED' });
    await Promise.all([dBackA, dBackB].map((deliveryId) => call(orders.report, rider, { orgId: org, deliveryId, outcome: 'FAILED', failReason: 'Nobody at home' })));
    await call(orders.cancel, lib, { orgId: org, deliveryId: dDropped, reason: 'Member called to postpone' });

    const at = { orgId: org, branchId: central };
    expect(await call(lists.counts, lib, at, null)).toEqual({ requested: 1, returning: 2 });
    expect(await call(lists.counts, libNorth, { orgId: org, branchId: north }, null)).toEqual({ requested: 1, returning: 0 });
    // Only people who manage deliveries at that branch are told anything.
    expect(await failure(call(lists.counts, libNorth, at, null))).toBe('FORBIDDEN');
    expect(await failure(call(lists.counts, rider, at, null))).toBe('FORBIDDEN');
    expect(await failure(call(lists.counts, null, at, null))).toBe('UNAUTHENTICATED');

    type Board = { open: { id: string; status: string }[]; closed: { id: string; status: string }[] };
    const plain = await call<Board>(lists.list, lib, at, null);
    expect(plain.open.map((d) => d.id).sort()).toEqual([dWaiting, dOut, dBackA, dBackB].sort());
    expect(plain.closed).toEqual([]);
    const full = await call<Board>(lists.list, lib, { ...at, closed: true }, null);
    expect(full.open.map((d) => d.id).sort()).toEqual(plain.open.map((d) => d.id).sort());
    expect(full.closed.map((d) => [d.id, d.status]).sort()).toEqual([[dDone, 'COMPLETED'], [dDropped, 'CANCELLED']].sort());
    expect(full.closed.map((d) => d.id)).not.toContain(dNorth);
    expect(await failure(call(lists.list, libNorth, { ...at, closed: true }, null))).toBe('FORBIDDEN');

    // The rider's bags come back together: each is received by its own command, with its own audit entry.
    const received = await Promise.all([dBackA, dBackB].map((deliveryId) => call<{ status: string; returned: number }>(orders.receive, lib, { orgId: org, deliveryId })));
    expect(received).toEqual([{ status: 'FAILED', returned: 1 }, { status: 'FAILED', returned: 1 }]);
    expect((await audits('delivery.receive')).map((a) => a.entityId).sort()).toEqual([dBackA, dBackB].sort());
    for (const m of [backA, backB]) expect(await get(`members/${m}`)).toMatchObject({ activeLoanCount: 0 });
    // A bag someone else has just received is refused, not returned twice.
    expect(await failure(call(orders.receive, lib, { orgId: org, deliveryId: dBackA }))).toBe('NOT_RETURNING');
    expect(await call(lists.counts, lib, at, null)).toEqual({ requested: 1, returning: 0 });
  });
});

describe('the address of the last visit', () => {
  it('is kept on the member for the next booking, shown to the member, and dropped when the profile address changes', async () => {
    await settings();
    const { memberId, phone } = await register('Asha Rao', { email: 'asha@stories.test' });
    expect((await get(`members/${memberId}`)).deliveryAddress).toBeUndefined();

    // A refused booking remembers nothing.
    expect(await failure(request(memberId, { address: { ...home, postalCode: '560099' } }))).toBe('NOT_SERVICEABLE');
    expect((await get(`members/${memberId}`)).deliveryAddress).toBeUndefined();

    const first = await request(memberId);
    const before = await get(`members/${memberId}`);
    expect(before.deliveryAddress).toEqual(stored(home));
    expect((await audits('delivery.request'))[0].after).toMatchObject({ addressSaved: true });

    // The member sees it in the app, and a booking of their own replaces it.
    const asha = await createUser('asha@stories.test');
    type Overview = { memberships: { memberId: string; member: { address: unknown; deliveryAddress: unknown } }[] };
    const mine = async () => (await call<Overview>(me.overview, asha, {}, null)).memberships.find((m) => m.memberId === memberId)!.member;
    expect(await mine()).toMatchObject({ address: stored(address), deliveryAddress: stored(home) });
    await call(orders.cancel, lib, { orgId: org, deliveryId: first, reason: 'Booked again by the member' });
    const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
    await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
    const moved = { ...home, landmark: 'Blue gate', geo: null };
    await call(dmember.requestDelivery, asha, { orgId: org, branchId: central, memberId, kind: 'DELIVER', date: istDate(1), slot: null, address: moved, note: 'Two mystery books please' });
    expect((await mine()).deliveryAddress).toEqual(stored(moved));

    // Editing the profile without touching the address keeps it; a new profile address (the member moved) drops it.
    const profile = { orgId: org, memberId, fullName: 'Asha Rao', dob: '1990-05-01', phone, email: 'asha@stories.test' };
    await call(members.update, lib, { ...profile, fullName: 'Asha R. Rao', address });
    expect((await get(`members/${memberId}`)).deliveryAddress).toEqual(stored(moved));
    await call(members.update, lib, { ...profile, address: { ...address, line1: '4 Church Street' } });
    const after = await get(`members/${memberId}`);
    expect(after.address).toMatchObject({ line1: '4 Church Street' });
    expect('deliveryAddress' in after).toBe(false);
    expect((await mine()).deliveryAddress).toBeNull();
  });
});

describe('courier orders refreshed together', () => {
  it('asks the courier about each order once, keeps going when one fails, and stays inside the branch', async () => {
    await settings(central, { couriers: { PORTER: { enabled: true, environment: 'TEST', apiKey: 'porter-key-123' } } });
    const tracked: string[] = [];
    let made = 0;
    setCourierTransport(async (method, url): Promise<HttpReply> => {
      const path = new URL(url).pathname;
      if (method === 'POST' && path === '/v1/orders/create') return { status: 200, body: JSON.stringify({ order_id: `CRN${++made}` }) };
      const orderId = path.split('/').pop()!;
      tracked.push(orderId);
      // The second order's status cannot be read.
      if (orderId === 'CRN2') return { status: 500, body: JSON.stringify({ message: 'Try later' }) };
      return { status: 200, body: JSON.stringify({ order_id: orderId, status: 'accepted' }) };
    });
    const ids: string[] = [];
    for (const [name, title] of [['Asha Rao', 'Angry River'], ['Ravi Kumar', 'The Night Train'], ['Nita Shah', 'Cherry Tree']]) {
      const deliveryId = await request(await subscriber(name));
      await call(orders.dispatch, lib, { orgId: org, deliveryId, method: 'PORTER', barcodes: [await acquire(title)] });
      ids.push(deliveryId);
    }
    // Booked one after another: CRN1, CRN2 (the one that fails) and CRN3.
    const [fresh, failing, stale] = ids;
    expect(await Promise.all(ids.map(async (i) => (await delivery(i)).provider.orderId))).toEqual(['CRN1', 'CRN2', 'CRN3']);
    // Booking stamps the time of the last check: only orders not checked in the last minute are asked about.
    const backdate = (id: string) => db.doc(`orgs/${org}/deliveries/${id}`).update({ 'provider.syncedAt': Timestamp.fromMillis(Date.now() - 5 * 60_000) });
    await Promise.all([backdate(stale), backdate(failing)]);

    const at = { orgId: org, branchId: central };
    type Synced = { updated: Record<string, string>; failed: number };
    expect(await failure(call(courier.sync, rider, at, null))).toBe('FORBIDDEN');
    expect(tracked).toEqual([]);
    expect(await call<Synced>(courier.sync, lib, at, null)).toEqual({ updated: { [stale]: 'ASSIGNED' }, failed: 1 });
    expect(tracked.slice().sort()).toEqual(['CRN2', 'CRN3']);
    expect((await delivery(stale)).provider).toMatchObject({ status: 'ASSIGNED' });
    expect((await delivery(fresh)).provider).toMatchObject({ status: 'BOOKED' });
    // Checked a moment ago: a second refresh leaves that order alone and only retries the one that failed.
    tracked.length = 0;
    expect(await call<Synced>(courier.sync, lib, at, null)).toEqual({ updated: {}, failed: 1 });
    expect(tracked).toEqual(['CRN2']);

    // One delivery: a courier failure is said out loud, and another branch's delivery reads as not there.
    expect(await failure(call(courier.sync, lib, { ...at, deliveryId: failing }, null))).toBe('COURIER_ERROR');
    tracked.length = 0;
    await backdate(stale);
    expect(await failure(call(courier.sync, libNorth, { orgId: org, branchId: north, deliveryId: stale }, null))).toBe('NOT_FOUND');
    expect(await failure(call(courier.sync, libNorth, { ...at, deliveryId: stale }, null))).toBe('FORBIDDEN');
    expect(await failure(call(courier.sync, lib, { ...at, deliveryId: 'nodelivery00' }, null))).toBe('NOT_FOUND');
    expect(tracked).toEqual([]);
    expect(await call<Synced>(courier.sync, lib, { ...at, deliveryId: stale }, null)).toEqual({ updated: { [stale]: 'ASSIGNED' }, failed: 0 });
  });
});
