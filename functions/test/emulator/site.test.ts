import { beforeEach, describe, expect, it } from 'vitest';

import * as plans from '../../src/billing/plans.js';
import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import { handleSitePublic, publicSnapshot } from '../../src/site/public.js';
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
    expect(get.r.headers['Cache-Control']).toBe('public, max-age=300, s-maxage=900');
    expect((get.r.body as { branches: unknown[] }).branches).toHaveLength(1);
    const post = reply();
    await handleSitePublic({ method: 'POST' } as never, post.res);
    expect(post.r.code).toBe(405);
  });
});
