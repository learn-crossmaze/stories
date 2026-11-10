import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';

import * as plans from '../../src/billing/plans.js';
import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import { handleSitePublic, publicSnapshot } from '../../src/site/public.js';
import { readShowcase, refreshShowcaseIfStale } from '../../src/site/showcase.js';
import { address, call, contact, createUser, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser;
let org: string, central: string;

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories for All', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, {
    orgId: org, code: 'CEN', name: 'Central', address, contact: { ...contact, email: 'central@storiesforall.in' },
    operatingHours: [{ day: 'MON', open: '10:00', close: '19:00' }], weeklyOffs: ['SUN'],
  })).branchId;
  const north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await call(branches.archive, sa, { orgId: org, branchId: north, reason: 'Moved to Central' });
});

describe('public website data', () => {
  it('lists active branches and plans with today’s prices, and nothing private', async () => {
    await db.doc(`orgs/${org}/branches/${central}`).update({ delivery: { enabled: true, feeMinor: 5000, pincodes: ['999111'], location: { lat: 12.9, lng: 77.6 } } });
    await call(plans.create, sa, {
      orgId: org, name: 'Reader', description: 'For busy readers', options: [{ duration: 'MONTHLY', priceMinor: 40000 }, { duration: 'ANNUAL', priceMinor: 400000 }],
      depositMinor: 100000, maxSimultaneousBooks: 3, audiences: ['ADULTS'], deliveryEligible: true,
    });
    const { planId: old } = await call<{ planId: string }>(plans.create, sa, { orgId: org, name: 'Old plan', options: [{ duration: 'MONTHLY', priceMinor: 10000 }], depositMinor: 0, maxSimultaneousBooks: 1, audiences: ['ADULTS'] });
    await call(plans.archive, sa, { orgId: org, planId: old, reason: 'No longer sold' });
    await db.collection('books').add({ title: 'Gitanjali', status: 'ACTIVE' });
    await db.collection('books').add({ title: 'Withdrawn', status: 'ARCHIVED' });

    const s = await publicSnapshot();
    expect(s.titles).toBe(1);
    expect(s.orgs).toEqual([{ id: org, name: 'Stories for All', type: 'CORPORATE' }]);
    expect(s.branches).toEqual([{
      id: central, orgId: org, name: 'Central',
      address: { ...address, line2: '' }, phone: contact.phone, email: 'central@storiesforall.in',
      hours: [{ day: 'MON', open: '10:00', close: '19:00' }], weeklyOffs: ['SUN'],
      delivery: { offered: true, feeMinor: 5000 },
    }]);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({
      name: 'Reader', description: 'For busy readers', booksAtATime: 3, depositMinor: 100000, audiences: ['ADULTS'], homeDelivery: true,
      prices: [
        { duration: 'MONTHLY', months: 1, listPriceMinor: 40000, priceMinor: 40000, discountLabel: null },
        { duration: 'ANNUAL', months: 12, listPriceMinor: 400000, priceMinor: 400000, discountLabel: null },
      ],
    });
    // Only the fields above: no PIN codes, map location, renewal settings or internal ids beyond the plan/branch/org.
    expect(JSON.stringify(s)).not.toMatch(/pincodes|999111|"lat"|renewalWindowDays|"version"/);
  });

  it('answers GET with a cacheable JSON body and refuses other methods', async () => {
    const reply = () => {
      const r = { code: 0, headers: {} as Record<string, string>, body: undefined as unknown };
      const res = { status: (n: number) => ((r.code = n), res), set: (k: string, v: string) => ((r.headers[k] = v), res), json: (b: unknown) => void (r.body = b), send: (b?: unknown) => void (r.body = b) };
      return { r, res };
    };
    const get = reply();
    await handleSitePublic({ method: 'GET' } as never, get.res);
    expect(get.r.code).toBe(200);
    expect(get.r.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=300');
    expect((get.r.body as { branches: unknown[] }).branches).toHaveLength(1);
    const post = reply();
    await handleSitePublic({ method: 'POST' } as never, post.res);
    expect(post.r.code).toBe(405);
  });
});

describe('book shelves (showcase)', () => {
  const DAY = 86_400_000;
  const book = (id: string, over: Record<string, unknown> = {}) =>
    db.doc(`books/${id}`).set({ title: `Title ${id}`, authorNames: ['Ruskin Bond'], coverUrl: null, ageGroup: 'CHILDREN', genres: ['FICTION'], status: 'ACTIVE', createdAt: Timestamp.fromMillis(Date.now() - 100 * DAY), ...over });
  const loan = (bookId: string, daysAgo: number) =>
    db.collection(`orgs/${org}/loans`).add({ bookId, memberId: 'm-secret', memberName: 'Asha Rao', issuedAt: Timestamp.fromMillis(Date.now() - daysAgo * DAY), status: 'RETURNED' });

  it('ranks trending, all-time, new and wanted titles from counts only', async () => {
    await Promise.all([
      book('gruffalo'), book('matilda', { ageGroup: 'TEENS', genres: ['FICTION', 'ADVENTURE'] }), book('sapiens', { ageGroup: 'ADULTS', genres: ['SCIENCE'] }),
      book('fresh', { createdAt: Timestamp.fromMillis(Date.now() - DAY), genres: ['MYSTERY'] }),
      book('gone', { status: 'ARCHIVED' }),
    ]);
    // This month: matilda 3, gruffalo 1; earlier: sapiens 5 (60 days ago), gone 9.
    await Promise.all([loan('matilda', 2), loan('matilda', 5), loan('matilda', 20), loan('gruffalo', 3), ...Array.from({ length: 5 }, () => loan('sapiens', 60)), ...Array.from({ length: 9 }, () => loan('gone', 4))]);
    await db.collection(`orgs/${org}/copies`).add({ bookId: 'gruffalo', lifetimeLoans: 40 });
    await db.collection(`orgs/${org}/copies`).add({ bookId: 'sapiens', lifetimeLoans: 25 });
    await db.collection(`orgs/${org}/copies`).add({ bookId: 'gruffalo', lifetimeLoans: 2 });
    await db.collection(`orgs/${org}/reservations`).add({ bookId: 'sapiens', status: 'WAITING', memberId: 'm-secret' });
    await db.collection(`orgs/${org}/reservations`).add({ bookId: 'sapiens', status: 'WAITING', memberId: 'm-other' });
    await db.collection(`orgs/${org}/reservations`).add({ bookId: 'matilda', status: 'FULFILLED', memberId: 'm-secret' });

    expect(await refreshShowcaseIfStale()).toBe(true);
    expect(await refreshShowcaseIfStale()).toBe(false); // fresh for 6 hours
    const s = await readShowcase();
    const ids = (list: { id: string }[]) => list.map((b) => b.id);
    expect(ids(s.trending)).toEqual(['matilda', 'gruffalo']); // archived 'gone' never shows
    expect(s.trending[0]).toMatchObject({ title: 'Title matilda', authors: ['Ruskin Bond'], ageGroup: 'TEENS', count: 3 });
    expect(ids(s.popular)).toEqual(['gruffalo', 'sapiens']);
    expect(s.popular[0].count).toBe(42);
    expect(ids(s.mostWanted)).toEqual(['sapiens']);
    expect(s.mostWanted[0].count).toBe(2);
    expect(ids(s.newArrivals)[0]).toBe('fresh');
    expect(s.newArrivals).not.toContainEqual(expect.objectContaining({ id: 'gone' }));
    expect(ids(s.byAge.TEENS)).toEqual(['matilda']);
    expect(ids(s.byAge.ADULTS)).toEqual(['sapiens']);
    expect(s.genres[0]).toEqual({ key: 'FICTION', count: 2 }); // gruffalo, matilda (archived 'gone' not counted)
    expect(s.genres).toContainEqual({ key: 'MYSTERY', count: 1 });
    expect(JSON.stringify(s)).not.toMatch(/m-secret|m-other|Asha/);

    // The website's snapshot carries it.
    expect((await publicSnapshot()).showcase.trending[0].id).toBe('matilda');
  });

  it('is empty, not broken, for a brand-new library', async () => {
    const s = await readShowcase();
    expect(s).toMatchObject({ trending: [], popular: [], mostWanted: [], newArrivals: [], genres: [] });
  });
});
