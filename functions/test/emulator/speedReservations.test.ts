import { createHmac, randomUUID } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as online from '../../src/billing/online.js';
import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import * as catalog from '../../src/catalogue/books.js';
import * as res from '../../src/circulation/reservations.js';
import { db } from '../../src/core/firebase.js';
import * as copies from '../../src/inventory/copies.js';
import * as me from '../../src/members/me.js';
import * as members from '../../src/members/members.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// Reservations read what they need in two waves instead of one read after another. These tests pin what must
// not move with that: who is refused, for which reason, in which order, and what a cancelled hold passes on.
// Also here: the one-time member list fill, and a counter payment checked while its webhook arrives.

let sa: TestUser, lib: TestUser, lib2: TestUser, fin: TestUser;
let org: string, central: string, authorId: string, bookId: string, planId: string;

type Placed = { reservationId: string; status: string; copyCode: string | null };

const path = (p: string) => db.doc(`orgs/${org}/${p}`);
const get = async (p: string) => (await path(p).get()).data()!;
const count = async (collection: string) => (await db.collection(`orgs/${org}/${collection}`).get()).size;
const audit = async (action: string) => (await db.collection(`orgs/${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());

/** The refusal's reason and its words: two "not found" refusals differ only in what was not found. */
async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { details?: { reason?: string }; code?: string; message?: string };
    return { reason: err.details?.reason ?? err.code ?? String(e), message: err.message ?? '' };
  }
  throw new Error('expected the call to fail');
}

async function newBook(title: string) {
  return (await call<{ bookId: string }>(catalog.create, sa, {
    title, isbn: '', authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
  })).bookId;
}
async function acquire(book: string, quantity: number) {
  return (await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: central, bookId: book, quantity, acquisitionCostMinor: 39900 })).codes;
}
async function register(fullName: string, extra: Record<string, unknown> = {}) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  return (await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName, dob: '1990-05-01', phone, ...extra })).memberId;
}
async function subscribe(memberId: string) {
  const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
  await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
  return subscriptionId;
}
/** Signs a person in as the account holder of a member record. */
async function holderOf(memberId: string, email: string) {
  const user = await createUser(email);
  await path(`members/${memberId}`).update({ accountHolderUid: user.uid });
  return user;
}
const place = (memberId: string, book = bookId, by = lib, branchId = central, requestId: string = randomUUID()) =>
  call<Placed>(res.place, by, { orgId: org, memberId, bookId: book, branchId }, requestId);
const cancel = (reservationId: string, by = lib) => call(res.cancel, by, { orgId: org, reservationId, reason: 'No longer wanted' });

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [lib, lib2, fin] = await Promise.all(['lib', 'lib2', 'fin'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: lib2.email, roles: ['LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: fin.email, roles: ['FINANCE_ADMIN'], branchIds: ['*'] });
  authorId = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Robert Louis Stevenson' })).id;
  bookId = await newBook('Treasure Island');
  planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Monthly Two', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 100000, maxSimultaneousBooks: 2, audiences: ['CHILDREN', 'TEENS', 'ADULTS'],
  })).planId;
});
afterEach(() => vi.restoreAllMocks());

describe('placing a reservation: who is refused, and for what', () => {
  it('refuses a caller with no right to the member before anything about the member, the branch or the title', async () => {
    const asha = await register('Asha Rao');
    await subscribe(asha);
    await place(asha);
    const before = await count('reservations');

    // A signed-in stranger naming someone else's member: never "already reserved" (which carries the member's name).
    const stranger = await createUser('stranger@stories.test');
    const mine = (over: Record<string, unknown> = {}) => refusal(call(me.reserve, stranger, { orgId: org, memberId: asha, bookId, branchId: central, ...over }));
    const already = await mine();
    expect(already.reason).toBe('FORBIDDEN');
    expect(already.message).not.toContain('Asha');
    expect((await mine({ branchId: 'no-such-branch' })).reason).toBe('FORBIDDEN');
    expect((await mine({ bookId: 'no-such-book' })).reason).toBe('FORBIDDEN');
    // A ward's record is as closed to them as the guardian's own, also when the ward has no plan.
    const kid = await register('Kiran Rao', { dob: '2016-01-01', phone: '', guardianMemberId: asha, guardianRelationship: 'Mother' });
    expect(await failure(call(me.reserve, stranger, { orgId: org, memberId: kid, bookId, branchId: central }))).toBe('FORBIDDEN');

    // Staff without reservations.manage at the branch (finance), whatever else is wrong with the request.
    expect(await failure(place(asha, bookId, fin))).toBe('FORBIDDEN');
    expect(await failure(place(asha, 'no-such-book', fin))).toBe('FORBIDDEN');
    // A member nobody has is "not found" for everyone, as before.
    expect(await refusal(place('no-such-member'))).toMatchObject({ reason: 'NOT_FOUND', message: expect.stringContaining('Member') });
    expect(await failure(call(me.reserve, stranger, { orgId: org, memberId: 'no-such-member', bookId, branchId: central }))).toBe('NOT_FOUND');
    expect(await count('reservations')).toBe(before);
  });

  it('keeps the order of the other refusals: branch, membership, subscription, title, already reserved, limit', async () => {
    const asha = await register('Asha Rao');
    // No plan yet, and more than one thing wrong: the earlier reason is the one given.
    expect(await refusal(place(asha, 'no-such-book', sa, 'no-such-branch'))).toMatchObject({ reason: 'NOT_FOUND', message: expect.stringContaining('Branch') });
    expect(await failure(place(asha, 'no-such-book'))).toBe('NO_ACTIVE_SUBSCRIPTION');
    await call(members.setStatus, lib, { orgId: org, memberId: asha, status: 'SUSPENDED', reason: 'Card reported lost' });
    expect(await failure(place(asha))).toBe('MEMBER_INACTIVE');
    await call(members.setStatus, lib, { orgId: org, memberId: asha, status: 'ACTIVE', reason: 'Card found again' });

    await subscribe(asha);
    expect(await refusal(place(asha, 'no-such-book'))).toMatchObject({ reason: 'NOT_FOUND', message: expect.stringContaining('title') });
    const archived = await newBook('Kidnapped');
    await call(catalog.archive, sa, { bookId: archived, reason: 'Duplicate entry' });
    expect(await failure(place(asha, archived))).toBe('NOT_FOUND');

    // The plan allows two at a time: with two placed, the same title again is "already reserved", another title is the limit.
    const [second, third] = [await newBook('The Black Arrow'), await newBook('Catriona')];
    await place(asha);
    await place(asha, second);
    expect(await refusal(place(asha))).toMatchObject({ reason: 'ALREADY_RESERVED', message: expect.stringContaining('Asha Rao') });
    expect(await failure(place(asha, third))).toBe('RESERVATION_LIMIT');
    expect(await count('reservations')).toBe(2);
    expect(await get(`members/${asha}`)).toMatchObject({ waitingCount: 2, allocatedCount: 0 });
  });

  it('a guardian reserves for a ward, and the copy on the shelf is held', async () => {
    const parent = await register('Meera Rao');
    const kid = await register('Kiran Rao', { dob: '2016-01-01', phone: '', guardianMemberId: parent, guardianRelationship: 'Mother' });
    await subscribe(kid);
    const meera = await holderOf(parent, 'meera@stories.test');
    const [code] = await acquire(bookId, 1);

    const r = await call<Placed>(me.reserve, meera, { orgId: org, memberId: kid, bookId, branchId: central });
    expect(r).toMatchObject({ status: 'ALLOCATED', copyCode: code });
    expect(await get(`reservations/${r.reservationId}`)).toMatchObject({ memberId: kid, memberName: 'Kiran Rao', status: 'ALLOCATED', allocatedCopyCode: code, placedBy: meera.uid, branchId: central });
    expect(await get(`members/${kid}`)).toMatchObject({ allocatedCount: 1, waitingCount: 0 });
    expect(await get(`members/${parent}`)).toMatchObject({ allocatedCount: 0, waitingCount: 0 });
  });

  it('a repeated request gives the first answer: one reservation, one audit entry', async () => {
    const asha = await register('Asha Rao');
    await subscribe(asha);
    const requestId = randomUUID();
    const first = await place(asha, bookId, lib, central, requestId);
    expect(first.status).toBe('WAITING');
    expect(await place(asha, bookId, lib, central, requestId)).toEqual(first);
    expect(await count('reservations')).toBe(1);
    expect(await get(`members/${asha}`)).toMatchObject({ waitingCount: 1 });
    const entries = await audit('reservation.place');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: first.reservationId, memberId: asha, branchId: central, actorUid: lib.uid, after: { status: 'WAITING', bookId } });
  });
});

describe('cancelling a held reservation', () => {
  it('passes the copy to the next member waiting, cancelled by staff or by the member', async () => {
    const [a, b, c] = [await register('Ava Rao'), await register('Ben Das'), await register('Chitra Nair')];
    for (const m of [a, b, c]) await subscribe(m);
    const [code] = await acquire(bookId, 1);
    const copyId = (await path(`barcodes/${code}`).get()).get('copyId') as string;
    const ra = await place(a);
    const rb = await place(b);
    expect([ra.status, rb.status]).toEqual(['ALLOCATED', 'WAITING']);

    // Staff cancel Ava's hold: Ben, next in line, gets the copy.
    await cancel(ra.reservationId);
    expect(await get(`reservations/${ra.reservationId}`)).toMatchObject({ status: 'CANCELLED', cancelReason: 'No longer wanted' });
    expect(await get(`reservations/${rb.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: copyId, allocatedCopyCode: code });
    expect(await get(`copies/${copyId}`)).toMatchObject({ status: 'RESERVED', activeReservationId: rb.reservationId });
    expect(await get(`members/${a}`)).toMatchObject({ allocatedCount: 0, waitingCount: 0 });
    expect(await get(`members/${b}`)).toMatchObject({ allocatedCount: 1, waitingCount: 0 });

    // Ben cancels his own from the app: Chitra, who joined the queue meanwhile, gets it.
    const rc = await place(c);
    expect(rc.status).toBe('WAITING');
    const ben = await holderOf(b, 'ben@stories.test');
    await call(me.cancelReservationByMember, ben, { orgId: org, reservationId: rb.reservationId });
    expect(await get(`reservations/${rc.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: copyId });
    expect(await get(`copies/${copyId}`)).toMatchObject({ status: 'RESERVED', activeReservationId: rc.reservationId });
    expect(await get(`members/${b}`)).toMatchObject({ allocatedCount: 0, waitingCount: 0 });
    expect(await get(`members/${c}`)).toMatchObject({ allocatedCount: 1, waitingCount: 0 });

    // Nobody waiting: the copy goes back on the shelf.
    await cancel(rc.reservationId, lib2);
    expect(await get(`copies/${copyId}`)).toMatchObject({ status: 'AVAILABLE', activeReservationId: null });
    expect(await get(`members/${c}`)).toMatchObject({ allocatedCount: 0, waitingCount: 0 });
    expect(await audit('reservation.cancel')).toHaveLength(3);
  });

  it('refuses a closed reservation only after the permission check; a waiting one just leaves the queue', async () => {
    const [a, b] = [await register('Ava Rao'), await register('Ben Das')];
    await subscribe(a);
    await subscribe(b);
    const [code] = await acquire(bookId, 1);
    const held = await place(a);
    const queued = await place(b);
    const stranger = await createUser('stranger@stories.test');
    const byStranger = (reservationId: string) => failure(call(me.cancelReservationByMember, stranger, { orgId: org, reservationId }));

    // Held or waiting, someone else's reservation is refused and nothing moves.
    expect(await byStranger(held.reservationId)).toBe('FORBIDDEN');
    expect(await byStranger(queued.reservationId)).toBe('FORBIDDEN');
    expect(await failure(cancel(held.reservationId, fin))).toBe('FORBIDDEN');
    expect(await get(`reservations/${held.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyCode: code });

    await cancel(queued.reservationId);
    expect(await get(`members/${b}`)).toMatchObject({ waitingCount: 0, allocatedCount: 0 });
    expect(await get(`reservations/${held.reservationId}`)).toMatchObject({ status: 'ALLOCATED' });

    // Closed: staff are told so; a stranger still only learns they may not touch it.
    expect(await failure(cancel(queued.reservationId))).toBe('NOT_OPEN');
    expect(await byStranger(queued.reservationId)).toBe('FORBIDDEN');
    expect(await failure(cancel('no-such-reservation'))).toBe('NOT_FOUND');
  });
});

describe('member list: the one-time fill for older members', () => {
  it('fills plan and renewal date once per branch for members from before the list had them', async () => {
    const paid = await register('Paid');
    const never = await register('Never');
    await subscribe(paid);
    const sub = (await db.collection(`orgs/${org}/subscriptions`).where('memberId', '==', paid).get()).docs[0];

    // Members from before the list existed have neither field; the one-time fill computes them.
    await path(`members/${paid}`).update({ planName: FieldValue.delete(), renewalDueAt: FieldValue.delete() });
    await path(`members/${never}`).update({ planName: FieldValue.delete(), renewalDueAt: FieldValue.delete() });
    expect(await failure(call(members.indexList, fin, { orgId: org, branchId: 'no-such-branch' }, null))).toBe('NOT_FOUND');
    expect((await call<{ updated: number }>(members.indexList, lib2, { orgId: org, branchId: central }, null)).updated).toBe(2);
    expect((await get(`members/${paid}`)).planName).toBe('Monthly Two');
    expect((await get(`members/${paid}`)).renewalDueAt.toMillis()).toBe(sub.get('endAt').toMillis());
    // Written as null, not left out: the "never subscribed" list asks for renewalDueAt == null.
    expect(await get(`members/${never}`)).toMatchObject({ planName: null, renewalDueAt: null });
    expect((await get(`branches/${central}`)).memberListIndexedAt).toBeTruthy();
    expect((await call<{ updated: number }>(members.indexList, lib2, { orgId: org, branchId: central }, null)).updated).toBe(0);
    const outsider = await createUser('outsider@stories.test');
    expect(await failure(call(members.indexList, outsider, { orgId: org, branchId: central }, null))).toBe('FORBIDDEN');
  });
});

describe('a counter payment checked while the webhook arrives', () => {
  const KEY = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'sekret-123', webhookSecret: 'whsec-456' };
  let memberId: string, subscriptionId: string, due: number;

  /** Fake Razorpay: one payment link, paid or not. Everything else (emulators) is real. */
  function fakeRazorpay(paid: boolean) {
    const asked: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://api.razorpay.com/v1')) return real(input, init);
      const route = `${init?.method ?? 'GET'} ${url.slice('https://api.razorpay.com/v1'.length).split('?')[0]}`;
      asked.push(route);
      if (route === 'POST /payment_links') return Response.json({ id: 'plink_1', short_url: 'https://rzp.io/i/abc', status: 'created' });
      if (route === 'GET /payment_links/plink_1') {
        return Response.json(paid ? { id: 'plink_1', status: 'paid', payments: [{ payment_id: 'pay_9', amount: due, status: 'captured', method: 'upi' }] } : { id: 'plink_1', status: 'created', payments: [] });
      }
      return Response.json({ error: { code: 'BAD_REQUEST_ERROR', description: 'The requested URL was not found on the server.' } }, { status: 400 });
    });
    return asked;
  }
  function webhook(body: unknown) {
    const raw = Buffer.from(JSON.stringify(body));
    const out = { status: 0, body: '' };
    const reply = { status: (n: number) => ({ send: (b: string) => void Object.assign(out, { status: n, body: b }) }) };
    const signature = createHmac('sha256', KEY.webhookSecret).update(raw).digest('hex');
    return online
      .handleWebhook({ method: 'POST', query: { o: org, b: central }, headers: { 'x-razorpay-signature': signature }, rawBody: raw } as never, reply)
      .then(() => out);
  }
  const check = () => call<{ status: string; applied?: boolean; reason?: string }>(online.checkRequest, lib, { orgId: org, paymentRequestId: 'plink_1' }, null);

  beforeEach(async () => {
    memberId = await register('Asha Rao', { email: 'asha@example.com' });
    const s = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
    subscriptionId = s.subscriptionId;
    due = s.amountDue.totalMinor;
    await call(online.setGateway, sa, { orgId: org, branchId: central, enabled: true, ...KEY, notifySms: true, notifyEmail: true });
  });

  it('records the money once when both land together', async () => {
    fakeRazorpay(true);
    await call(online.createRequest, lib, { orgId: org, subscriptionId, channel: 'LINK', requestId: randomUUID() }, null);
    const paidLink = {
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: 'plink_1', status: 'paid' } }, payment: { entity: { id: 'pay_9', amount: due, status: 'captured', method: 'upi' } } },
    };
    const [hook, checked] = await Promise.all([webhook(paidLink), check()]);

    expect(hook.status).toBe(200);
    expect(checked.status).toBe('PAID');
    // Exactly one of the two applied it; the other found it paid.
    expect([hook.body !== 'ALREADY_PAID', checked.applied === true].filter(Boolean)).toHaveLength(1);
    const payments = await db.collection(`orgs/${org}/payments`).where('memberId', '==', memberId).get();
    expect(payments.docs.map((d) => [d.get('status'), d.get('reference'), d.get('amountMinor')])).toEqual([['SUCCESS', 'pay_9', due]]);
    expect(await get(`subscriptions/${subscriptionId}`)).toMatchObject({ status: 'ACTIVE', paymentId: payments.docs[0].id });
    expect(await get(`members/${memberId}`)).toMatchObject({ activeSubscriptionId: subscriptionId });
    expect(await get('paymentRequests/plink_1')).toMatchObject({ status: 'PAID', paymentId: payments.docs[0].id });
    expect((await get(`depositAccounts/${memberId}`)).balanceMinor).toBe(100000);
    // Asked again afterwards (the dialog's next automatic check): nothing more is written, and Razorpay is not asked.
    const asked = fakeRazorpay(true);
    expect(await check()).toEqual({ status: 'PAID' });
    expect(asked).toEqual([]);
    expect((await db.collection(`orgs/${org}/payments`).get()).size).toBe(1);
  });

  it('an unpaid request stays open however often it is checked, and nothing is written', async () => {
    const asked = fakeRazorpay(false);
    await call(online.createRequest, lib, { orgId: org, subscriptionId, channel: 'LINK', requestId: randomUUID() }, null);
    const auditBefore = await count('auditLogs');
    for (let n = 0; n < 3; n++) expect(await check()).toEqual({ status: 'OPEN' });
    expect(asked.filter((route) => route === 'GET /payment_links/plink_1')).toHaveLength(3);
    expect(await count('payments')).toBe(0);
    expect(await count('auditLogs')).toBe(auditBefore);
    expect(await get(`subscriptions/${subscriptionId}`)).toMatchObject({ status: 'PENDING_PAYMENT' });
    expect(await get('paymentRequests/plink_1')).toMatchObject({ status: 'OPEN' });
    // Someone who may not see payments at the branch learns nothing from it.
    const outsider = await createUser('outsider@stories.test');
    expect(await failure(call(online.checkRequest, outsider, { orgId: org, paymentRequestId: 'plink_1' }, null))).toBe('FORBIDDEN');
  });
});
