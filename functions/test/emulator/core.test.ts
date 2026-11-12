import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { command, query } from '../../src/core/callable.js';
import { syncStaleClaims } from '../../src/core/claims.js';
import { auth, db } from '../../src/core/firebase.js';
import { id } from '../../src/core/schemas.js';
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

// The pipeline reads the caller's membership of `input.orgId` in the transaction's first read (with the
// idempotency record) and hands it to the handler's permission check.
describe('command pipeline: the caller and their membership', () => {
  const ORG = 'orgPipeline';
  let lib: TestUser;
  const membership = () => db.doc(`users/${lib.uid}/memberships/${ORG}`);

  beforeEach(async () => {
    lib = await createUser('lib@stories.test');
    await membership().set({ orgId: ORG, orgName: 'Pipeline Org', orgType: 'CORPORATE', uid: lib.uid, email: lib.email, displayName: 'lib', roles: ['LIBRARIAN'], branchIds: ['b1'], status: 'ACTIVE' });
  });

  it('checks permission from that read, with no read of its own, and refuses a revoked or missing membership', async () => {
    let checkReads = -1;
    const guarded = command('test-guarded', z.strictObject({ orgId: id, branchId: id }), async ({ actor, input }, tx) => {
      const reads = vi.spyOn(tx, 'get');
      try {
        await actor.require('loans.issue', input.orgId, input.branchId, tx);
      } finally {
        checkReads = reads.mock.calls.length;
        reads.mockRestore();
      }
      tx.set(db.doc('tests/guarded'), { by: actor.uid });
      return { ok: true };
    });
    expect(await call(guarded, lib, { orgId: ORG, branchId: 'b1' })).toEqual({ ok: true });
    expect(checkReads).toBe(0);
    expect(await failure(call(guarded, lib, { orgId: ORG, branchId: 'b2' }))).toBe('FORBIDDEN'); // outside their branches
    expect(await failure(call(guarded, lib, { orgId: 'otherOrg', branchId: 'b1' }))).toBe('FORBIDDEN'); // no membership there
    expect(await call(guarded, sa, { orgId: ORG, branchId: 'b1' })).toEqual({ ok: true }); // a Super Admin needs none

    await membership().update({ status: 'REVOKED', roles: [] });
    expect(await failure(call(guarded, lib, { orgId: ORG, branchId: 'b1' }))).toBe('FORBIDDEN');
  });

  it('reads the membership again when the transaction is retried', async () => {
    let attempts = 0;
    let revoke: Promise<unknown> | undefined;
    const contended = command('test-contended', z.strictObject({ orgId: id }), async ({ actor, input }, tx) => {
      attempts += 1;
      await actor.require('loans.issue', input.orgId, undefined, tx);
      // Still allowed in this attempt. The first one revokes the membership (not awaited: the write may have to wait
      // for this transaction to end) and fails the way Firestore reports contention, so the transaction runs again.
      revoke ??= membership().update({ status: 'REVOKED', roles: [] });
      if (attempts < 4) throw Object.assign(new Error('10 ABORTED: too much contention'), { code: 10 });
      return { ok: true };
    });
    expect(await failure(call(contended, lib, { orgId: ORG }))).toBe('FORBIDDEN');
    await revoke;
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThan(4);
  });

  it('returns a replay without running again, and still refuses a disabled user, also on a replay', async () => {
    let runs = 0;
    const once = command('test-once', z.strictObject({ orgId: id }), async ({ actor, input }, tx) => {
      await actor.require('loans.issue', input.orgId, undefined, tx);
      runs += 1;
      tx.set(db.doc('tests/once'), { runs });
      return { runs };
    });
    const requestId = randomUUID();
    expect(await call(once, lib, { orgId: ORG }, requestId)).toEqual({ runs: 1 });
    expect(await call(once, lib, { orgId: ORG }, requestId)).toEqual({ runs: 1 });
    // The answer was stored for this request: a replay returns it even after the membership has gone.
    await membership().update({ status: 'REVOKED', roles: [] });
    expect(await call(once, lib, { orgId: ORG }, requestId)).toEqual({ runs: 1 });
    expect(runs).toBe(1);

    await db.doc(`users/${lib.uid}`).update({ status: 'DISABLED' });
    expect(await failure(call(once, lib, { orgId: ORG }, requestId))).toBe('USER_INACTIVE');
    expect(await failure(call(once, lib, { orgId: ORG }))).toBe('USER_INACTIVE');
    expect(runs).toBe(1);
  });

  it('runs the prepare step once: not on a replay, and not for a disabled user', async () => {
    let prepares = 0;
    let discards = 0;
    const staged = command('test-staged', z.strictObject({ orgId: id }), async ({ actor, input, prepared }, tx) => {
      await actor.require('loans.issue', input.orgId, undefined, tx);
      tx.set(db.doc('tests/staged'), { prepared });
      return { prepared };
    }, null, {
      prepare: async ({ actor, input }) => {
        await actor.require('loans.issue', input.orgId);
        prepares += 1;
        return `staged-${prepares}`;
      },
      discard: async () => {
        discards += 1;
      },
    });
    const requestId = randomUUID();
    expect(await call(staged, lib, { orgId: ORG }, requestId)).toEqual({ prepared: 'staged-1' });
    expect(await call(staged, lib, { orgId: ORG }, requestId)).toEqual({ prepared: 'staged-1' });
    expect({ prepares, discards }).toEqual({ prepares: 1, discards: 0 });

    await db.doc(`users/${lib.uid}`).update({ status: 'DISABLED' });
    expect(await failure(call(staged, lib, { orgId: ORG }))).toBe('USER_INACTIVE');
    expect(await failure(call(staged, lib, { orgId: ORG }, requestId))).toBe('USER_INACTIVE');
    expect(prepares).toBe(1);
  });

  it('asks who is calling first, then checks the input, then the account', async () => {
    const plain = command('test-plain', z.strictObject({ n: z.number() }), async ({ input }, tx) => {
      tx.set(db.doc('tests/plain'), { n: input.n });
      return { n: input.n };
    });
    expect(await call(plain, lib, { n: 1 })).toEqual({ n: 1 }); // no organization in the input: nothing more is read
    expect(await failure(call(plain, null, { n: 'x' }))).toBe('UNAUTHENTICATED');
    await db.doc(`users/${lib.uid}`).update({ status: 'DISABLED' });
    expect(await failure(call(plain, lib, { n: 'x' }))).toBe('INVALID_INPUT');
    expect(await failure(call(plain, lib, { n: 1 }))).toBe('USER_INACTIVE');
  });

  it('never builds a document path from an organization id that is not shaped like an id', async () => {
    const loose = command('test-loose', z.strictObject({ orgId: z.string() }), async ({ input }, tx) => {
      tx.set(db.doc('tests/loose'), { orgId: input.orgId });
      return { ok: true };
    });
    expect(await call(loose, lib, { orgId: 'a/b' })).toEqual({ ok: true });
    expect(await call(loose, lib, { orgId: '../../users' })).toEqual({ ok: true });
  });

  it('gives a query the same: signed in, valid input, active account, and the membership for its permission check', async () => {
    const may = query('test-may', z.strictObject({ orgId: id }), async ({ actor, input }) => ({ may: await actor.can('loans.issue', input.orgId) }));
    const loose = query('test-looseQuery', z.strictObject({ orgId: z.string() }), async () => ({ ok: true }));
    expect(await call(may, lib, { orgId: ORG }, null)).toEqual({ may: true });
    expect(await call(may, lib, { orgId: 'otherOrg' }, null)).toEqual({ may: false });
    expect(await call(may, sa, { orgId: ORG }, null)).toEqual({ may: true });
    expect(await call(loose, lib, { orgId: 'a/b' }, null)).toEqual({ ok: true });
    await membership().update({ status: 'REVOKED', roles: [] });
    expect(await call(may, lib, { orgId: ORG }, null)).toEqual({ may: false });

    expect(await failure(call(may, null, { orgId: 7 }, null))).toBe('UNAUTHENTICATED');
    await db.doc(`users/${lib.uid}`).update({ status: 'DISABLED' });
    expect(await failure(call(may, lib, { orgId: 7 }, null))).toBe('INVALID_INPUT');
    expect(await failure(call(may, lib, { orgId: ORG }, null))).toBe('USER_INACTIVE');
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
