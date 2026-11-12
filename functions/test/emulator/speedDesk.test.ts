import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import * as catalog from '../../src/catalogue/books.js';
import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import * as circ from '../../src/circulation/circulation.js';
import * as res from '../../src/circulation/reservations.js';
import { db } from '../../src/core/firebase.js';
import * as copies from '../../src/inventory/copies.js';
import * as locations from '../../src/inventory/locations.js';
import * as members from '../../src/members/members.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// The desk's bigger steps: a pile of returns in one call, many inspections passed at once,
// and the shelf a copy is issued from remembered for putting it back.

let sa: TestUser, lib: TestUser, lib2: TestUser;
let org: string, central: string, north: string, authorId: string, bookId: string, planId: string;

const get = async (p: string) => (await db.doc(`orgs/${org}/${p}`).get()).data()!;
const idOf = async (code: string) => (await db.doc(`orgs/${org}/barcodes/${code}`).get()).get('copyId') as string;

async function newBook(title: string) {
  return (await call<{ bookId: string }>(catalog.create, sa, {
    title, isbn: '', authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
  })).bookId;
}
async function acquire(book: string, quantity: number, extra: Record<string, unknown> = {}) {
  return (await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: central, bookId: book, quantity, acquisitionCostMinor: 39900, ...extra })).codes;
}
/** A member with a paid plan that allows 12 books at a time. */
async function borrower(fullName: string) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const { memberId } = await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName, dob: '1990-05-01', phone });
  const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
  await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
  return memberId;
}
const issue = (memberId: string, barcodes: string[]) => call(circ.issue, lib, { orgId: org, branchId: central, memberId, barcodes });
const giveBack = (barcodes: string[]) => call<{ loanIds: string[] }>(circ.returnCopies, lib, { orgId: org, branchId: central, barcodes });
const passMany = (copyIds: string[], by = lib, branchId = central) =>
  call<{ passed: string[]; skipped: string[] }>(copies.inspectMany, by, { orgId: org, branchId, copyIds });
const audits = async (action: string) =>
  (await db.collection(`orgs/${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [lib, lib2] = await Promise.all(['lib', 'lib2'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central, north] });
  await call(staff.setRoles, sa, { orgId: org, email: lib2.email, roles: ['LIBRARIAN'], branchIds: [central] });
  authorId = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Robert Louis Stevenson' })).id;
  bookId = await newBook('Treasure Island');
  planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Monthly Twelve', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 100000, maxSimultaneousBooks: 12, audiences: ['CHILDREN', 'TEENS', 'ADULTS'],
  })).planId;
});

describe('quick return of a pile', () => {
  it('takes more than 10 books in one return (up to 30); issue and exchange keep 10', async () => {
    const m = await borrower('Asha');
    const codes = await acquire(bookId, 12);
    await issue(m, codes.slice(0, 10));
    await issue(m, codes.slice(10));
    const eleven = Array.from({ length: 11 }, (_, i) => `COPY-999999-${String(i + 1).padStart(2, '0')}`);

    // 11 to issue, or 11 on either side of an exchange, are refused before anything is read.
    expect(await failure(issue(m, eleven))).toBe('INVALID_INPUT');
    const swap = (returnBarcodes: string[], issueBarcodes: string[]) => call(circ.exchange, lib, { orgId: org, branchId: central, memberId: m, returnBarcodes, issueBarcodes });
    expect(await failure(swap(codes.slice(0, 11), [eleven[0]]))).toBe('INVALID_INPUT');
    expect(await failure(swap([codes[0]], eleven))).toBe('INVALID_INPUT');
    // 31 in a return are refused; 30 are read (and here the first is not a copy).
    const many = Array.from({ length: 31 }, (_, i) => `COPY-999998-${String(i + 1).padStart(2, '0')}`);
    expect(await failure(giveBack(many))).toBe('INVALID_INPUT');
    expect(await failure(giveBack(many.slice(0, 30)))).toBe('UNKNOWN_BARCODE');
    expect((await get(`members/${m}`)).activeLoanCount).toBe(12);

    // All 12 come back in one call: one audit entry for the member, every copy to inspection.
    const back = await giveBack(codes);
    expect(back.loanIds).toHaveLength(12);
    expect((await get(`members/${m}`)).activeLoanCount).toBe(0);
    const waiting = await db.collection(`orgs/${org}/copies`).where('status', '==', 'UNDER_INSPECTION').get();
    expect(waiting.size).toBe(12);
    const [entry] = await audits('circulation.return');
    expect(entry.after.copies).toEqual(codes);
    expect(await audits('circulation.return')).toHaveLength(1);
  });
});

describe('passing many inspections at once', () => {
  /** Copies of a title that came back from a loan and wait for inspection. */
  async function returned(book: string, quantity: number, memberId: string) {
    const codes = await acquire(book, quantity);
    await issue(memberId, codes);
    await giveBack(codes);
    return Promise.all(codes.map(idOf));
  }

  it('puts every copy back on the shelf in the condition on record, with one audit entry per copy', async () => {
    const m = await borrower('Asha');
    const ids = await returned(bookId, 3, m);
    await db.doc(`orgs/${org}/copies/${ids[1]}`).update({ condition: 'FAIR' });

    expect(await passMany(ids)).toEqual({ passed: ids, skipped: [] });
    expect(await get(`copies/${ids[0]}`)).toMatchObject({ status: 'AVAILABLE', condition: 'NEW', activeLoanId: null });
    expect(await get(`copies/${ids[1]}`)).toMatchObject({ status: 'AVAILABLE', condition: 'FAIR' });
    const entries = await audits('copy.inspected');
    expect(entries.map((e) => e.entityId).sort()).toEqual([...ids].sort());
    expect(entries.find((e) => e.entityId === ids[1])).toMatchObject({
      entityType: 'copy', branchId: central, before: { status: 'UNDER_INSPECTION', condition: 'FAIR' }, after: { status: 'AVAILABLE', condition: 'FAIR', reservationId: null },
    });
    const events = await db.collection(`orgs/${org}/copies/${ids[0]}/events`).where('type', '==', 'INSPECTED').get();
    expect(events.docs.map((d) => d.get('toStatus'))).toEqual(['AVAILABLE']);

    // The same request again changes nothing (the stored answer is returned).
    const requestId = randomUUID();
    const more = await returned(bookId, 1, m);
    const first = await call(copies.inspectMany, lib, { orgId: org, branchId: central, copyIds: more }, requestId);
    expect(await call(copies.inspectMany, lib, { orgId: org, branchId: central, copyIds: more }, requestId)).toEqual(first);
    expect(await audits('copy.inspected')).toHaveLength(4);
  });

  it('gives copies of one title to different waiting members, oldest first; the rest go on the shelf', async () => {
    const [holder, ava, ben] = [await borrower('Asha'), await borrower('Ava Rao'), await borrower('Ben Das')];
    const other = await newBook('Kidnapped');
    const codes = await acquire(bookId, 3);
    const [otherCode] = await acquire(other, 1);
    await issue(holder, [...codes, otherCode]);
    const place = (memberId: string, book = bookId) => call<{ reservationId: string; status: string }>(res.place, lib, { orgId: org, memberId, bookId: book, branchId: central });
    const first = await place(ava);
    const second = await place(ben);
    // Ava also waits for the other title: two holds for one member in the same call.
    const third = await place(ava, other);
    expect([first.status, second.status, third.status]).toEqual(['WAITING', 'WAITING', 'WAITING']);
    await giveBack([...codes, otherCode]);
    const ids = await Promise.all([...codes, otherCode].map(idOf));

    expect((await passMany(ids)).passed).toEqual(ids);
    expect(await get(`reservations/${first.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: ids[0] });
    expect(await get(`reservations/${second.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: ids[1] });
    expect(await get(`reservations/${third.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: ids[3] });
    expect(await get(`copies/${ids[0]}`)).toMatchObject({ status: 'RESERVED', activeReservationId: first.reservationId });
    expect(await get(`copies/${ids[1]}`)).toMatchObject({ status: 'RESERVED', activeReservationId: second.reservationId });
    expect(await get(`copies/${ids[2]}`)).toMatchObject({ status: 'AVAILABLE', activeReservationId: null });
    expect(await get(`members/${ava}`)).toMatchObject({ allocatedCount: 2, waitingCount: 0 });
    expect(await get(`members/${ben}`)).toMatchObject({ allocatedCount: 1, waitingCount: 0 });
    const entries = await audits('copy.inspected');
    expect(entries.find((e) => e.entityId === ids[0])!.after).toMatchObject({ status: 'RESERVED', reservationId: first.reservationId });
    expect(entries.find((e) => e.entityId === ids[2])!.after).toMatchObject({ status: 'AVAILABLE', reservationId: null });
  });

  it('skips a copy someone else already decided, and passes the others', async () => {
    const m = await borrower('Asha');
    const ids = await returned(bookId, 3, m);
    await call(copies.inspect, lib2, { orgId: org, copyId: ids[0], outcome: 'PASS', condition: 'GOOD', note: '' });
    await call(copies.inspect, lib2, { orgId: org, copyId: ids[1], outcome: 'DAMAGED', condition: 'POOR', note: 'Torn' });

    const result = await passMany(ids);
    expect(result.passed).toEqual([ids[2]]);
    expect(result.skipped).toEqual([(await get(`copies/${ids[0]}`)).code, (await get(`copies/${ids[1]}`)).code]);
    expect(await get(`copies/${ids[0]}`)).toMatchObject({ status: 'AVAILABLE', condition: 'GOOD' });
    expect(await get(`copies/${ids[1]}`)).toMatchObject({ status: 'DAMAGED' });
    expect(await get(`copies/${ids[2]}`)).toMatchObject({ status: 'AVAILABLE' });
    // Nothing left to pass is not an error.
    expect(await passMany(ids)).toMatchObject({ passed: [] });
  });

  it('refuses a copy at another branch, staff of other branches, a copy listed twice and more than 50 (nothing changes)', async () => {
    const m = await borrower('Asha');
    const ids = await returned(bookId, 2, m);
    const [there] = await Promise.all((await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: north, bookId, quantity: 1, acquisitionCostMinor: 0 })).codes.map(idOf));

    expect(await failure(passMany([ids[0], there]))).toBe('OTHER_BRANCH');
    expect(await failure(passMany([ids[0], 'nocopy000000']))).toBe('NOT_FOUND');
    expect(await failure(passMany([there], lib2, north))).toBe('FORBIDDEN');
    expect(await failure(passMany(['nocopy000000'], lib2, north))).toBe('FORBIDDEN');
    expect(await failure(passMany([ids[0], ids[0]]))).toBe('INVALID_INPUT');
    expect(await failure(passMany(Array.from({ length: 51 }, (_, i) => `copy${String(i).padStart(8, '0')}`)))).toBe('INVALID_INPUT');
    for (const c of ids) expect((await get(`copies/${c}`)).status).toBe('UNDER_INSPECTION');
    expect(await audits('copy.inspected')).toHaveLength(0);
  });
});

describe('the shelf a copy is issued from', () => {
  it('is remembered on the copy, and kept when the copy goes out again before it is shelved', async () => {
    const { locationId: shelf } = await call<{ locationId: string }>(locations.create, lib, { orgId: org, branchId: central, code: 'FIC-1', label: 'Fiction, bay 1', kind: 'SHELF' });
    const m = await borrower('Asha');
    const [shelved] = await acquire(bookId, 1, { locationId: shelf });
    const [loose] = await acquire(bookId, 1);
    const [a, b] = await Promise.all([shelved, loose].map(idOf));

    await issue(m, [shelved, loose]);
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'ISSUED', locationId: null, lastLocationId: shelf });
    // A copy that was on no shelf gets no usual shelf.
    expect(await get(`copies/${b}`)).not.toHaveProperty('lastLocationId');

    await giveBack([shelved]);
    await passMany([a]);
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'AVAILABLE', locationId: null, lastLocationId: shelf });
    // Issued again straight off the trolley: the usual shelf stays.
    await issue(m, [shelved]);
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'ISSUED', locationId: null, lastLocationId: shelf });
  });
});
