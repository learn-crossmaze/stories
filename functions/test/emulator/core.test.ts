import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { command } from '../../src/core/callable.js';
import { syncStaleClaims } from '../../src/core/claims.js';
import { auth, db } from '../../src/core/firebase.js';
import { sweep } from '../../src/core/sweep.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser;

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
});

describe('command pipeline', () => {
  it('re-runs a failed step after the commit when the same request is retried, then never again', async () => {
    let afterRuns = 0;
    let failNext = true;
    const touch = command('test-touch', z.strictObject({ n: z.number() }), async ({ input }, tx) => {
      tx.set(db.doc('tests/touch'), { n: input.n });
      return { n: input.n };
    }, async () => {
      afterRuns += 1;
      if (failNext) {
        failNext = false;
        throw new Error('token service unavailable');
      }
    });
    const requestId = randomUUID();
    expect(await failure(call(touch, sa, { n: 1 }, requestId))).toBe('AFTER_PENDING');
    expect((await db.doc('tests/touch').get()).get('n')).toBe(1); // the change itself committed
    const idem = db.doc(`idempotency/test-touch:${sa.uid}:${requestId}`);
    expect((await idem.get()).get('afterPending')).toBe(true);

    expect(await call(touch, sa, { n: 1 }, requestId)).toEqual({ n: 1 });
    expect(afterRuns).toBe(2);
    expect((await idem.get()).get('afterPending')).toBe(false);
    await call(touch, sa, { n: 1 }, requestId);
    expect(afterRuns).toBe(2);
  });

  it('reports Firestore contention as a retryable BUSY error', async () => {
    const busy = command('test-busy', z.strictObject({}), async () => {
      throw Object.assign(new Error('10 ABORTED: too much contention'), { code: 10 });
    });
    expect(await failure(call(busy, sa, {}))).toBe('BUSY');
  });
});

describe('claims', () => {
  it('marks role changes stale until the token is updated, and the maintenance job finishes interrupted ones', async () => {
    const org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
    const central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
    const lib = await createUser('lib@stories.test');
    await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
    expect((await db.doc(`users/${lib.uid}`).get()).get('claimsStale')).toBe(false);
    expect((await auth.getUser(lib.uid)).customClaims?.o?.[org]).toMatchObject({ r: ['LIB'], b: [central], p: expect.stringMatching(/^([0-9a-zA-Z]{2})+$/) });

    // A revoke whose token update never happened (e.g. the function was cut off after the commit).
    await db.doc(`users/${lib.uid}/memberships/${org}`).update({ status: 'REVOKED', roles: [] });
    await db.doc(`users/${lib.uid}`).update({ claimsStale: true });
    const run = await syncStaleClaims();
    expect(run).toMatchObject({ changed: 1, failed: 0 });
    expect((await auth.getUser(lib.uid)).customClaims?.o).toEqual({});
    expect((await db.doc(`users/${lib.uid}`).get()).get('claimsStale')).toBe(false);
  });
});

describe('sweep', () => {
  it('pages through everything and never lets one bad document stop the rest', async () => {
    await Promise.all(Array.from({ length: 7 }, (_, i) => db.doc(`sweepItems/i${i}`).set({ due: true, n: i })));
    const seen: number[] = [];
    const run = await sweep('test', db.collection('sweepItems').where('due', '==', true), async (doc) => {
      if (doc.get('n') === 2) throw new Error('bad record');
      seen.push(doc.get('n'));
      return doc.get('n') % 2 === 0;
    }, { pageSize: 3, concurrency: 2 });
    expect(seen.sort()).toEqual([0, 1, 3, 4, 5, 6]);
    expect(run).toEqual({ processed: 7, changed: 3, failed: 1, complete: true });
  });
});
