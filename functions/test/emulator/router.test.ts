import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as fns from '../../src/index.js';
import { call, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser;

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
});

/** Every document under a collection name, anywhere in the database. */
const count = async (collection: string) => (await db.collectionGroup(collection).get()).size;

describe('api, the one function for every action', () => {
  it('runs actions of every domain through the full pipeline (auth, validation, audit)', async () => {
    const { orgId } = await call<{ orgId: string }>(fns.api, sa, { action: 'orgs-create', name: 'One Door Org', type: 'CORPORATE' });
    expect((await db.doc(`orgs/${orgId}`).get()).get('name')).toBe('One Door Org');
    const { designationId } = await call<{ designationId: string }>(fns.api, sa, { action: 'designations-create', orgId, name: 'Librarian' });
    expect((await db.doc(`orgs/${orgId}/designations/${designationId}`).get()).get('name')).toBe('Librarian');
    const author = await call<{ id: string }>(fns.api, sa, { action: 'authors-create', name: 'Ruskin Bond' });
    expect((await db.doc(`authors/${author.id}`).get()).get('name')).toBe('Ruskin Bond');

    expect(await failure(call(fns.api, null, { action: 'orgs-create', name: 'X Org', type: 'CORPORATE' }))).toBe('UNAUTHENTICATED');
    expect(await failure(call(fns.api, sa, { action: 'orgs-create', name: 'X', type: 'CORPORATE' }))).toBe('INVALID_INPUT');
  });

  it('rejects unknown actions', async () => {
    expect(await failure(call(fns.api, sa, { action: 'nope' }))).toBe('not-found');
    expect(await failure(call(fns.api, sa, { action: 'toString' }))).toBe('not-found');
    expect(await failure(call(fns.api, sa, {}))).toBe('not-found');
  });

  it('a request repeated on an older router returns the first result instead of running again', async () => {
    const requestId = randomUUID();
    const first = await call<{ orgId: string }>(fns.api, sa, { action: 'orgs-create', name: 'Once Org', type: 'CORPORATE' }, requestId);
    const again = await call<{ orgId: string }>(fns.admin, sa, { action: 'orgs-create', name: 'Once Org', type: 'CORPORATE' }, requestId);
    expect(again).toEqual(first);
    expect((await db.collection('orgs').get()).size).toBe(1);
  });
});

describe('ping', () => {
  it('answers a signed-in caller on api and on an older router, and writes nothing', async () => {
    const before = { audit: (await count('auditLogs')) + (await count('platformAuditLogs')), idempotency: await count('idempotency') };
    for (const fn of [fns.api, fns.members]) {
      expect(await call(fn, sa, { action: 'ping' }, null)).toEqual({ ok: true });
      expect(await call(fn, sa, { action: 'ping' })).toEqual({ ok: true }); // a requestId changes nothing
    }
    expect({ audit: (await count('auditLogs')) + (await count('platformAuditLogs')), idempotency: await count('idempotency') }).toEqual(before);
  });

  it('refuses a caller who is not signed in', async () => {
    for (const fn of [fns.api, fns.members]) expect(await failure(call(fn, null, { action: 'ping' }, null))).toBe('UNAUTHENTICATED');
  });
});

describe('routers', () => {
  it('route an action through the full pipeline (auth, validation, audit)', async () => {
    const { orgId } = await call<{ orgId: string }>(fns.admin, sa, { action: 'orgs-create', name: 'Routed Org', type: 'CORPORATE' });
    expect((await db.doc(`orgs/${orgId}`).get()).get('name')).toBe('Routed Org');
    expect(await failure(call(fns.admin, null, { action: 'orgs-create', name: 'X Org', type: 'CORPORATE' }))).toBe('UNAUTHENTICATED');
  });

  it('reject unknown actions and actions that belong to another router', async () => {
    expect(await failure(call(fns.admin, sa, { action: 'nope' }))).toBe('not-found');
    expect(await failure(call(fns.admin, sa, { action: 'books-create' }))).toBe('not-found');
    expect(await failure(call(fns.admin, sa, { action: 'toString' }))).toBe('not-found');
    expect(await failure(call(fns.hr, sa, { action: 'books-create' }))).toBe('not-found');
  });

  it('route HR actions through the hr router', async () => {
    const { orgId } = await call<{ orgId: string }>(fns.admin, sa, { action: 'orgs-create', name: 'HR Org', type: 'CORPORATE' });
    const { designationId } = await call<{ designationId: string }>(fns.hr, sa, { action: 'designations-create', orgId, name: 'Librarian' });
    expect((await db.doc(`orgs/${orgId}/designations/${designationId}`).get()).get('name')).toBe('Librarian');
  });
});
