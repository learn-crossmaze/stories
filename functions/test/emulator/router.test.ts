import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as fns from '../../src/index.js';
import { call, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser;

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
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
