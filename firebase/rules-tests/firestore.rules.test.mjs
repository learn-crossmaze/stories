import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-stories',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), { displayName: 'Alice' });
    await setDoc(doc(db, 'users/alice/memberships/org-corp'), { roles: ['LIB'] });
    await setDoc(doc(db, 'orgs/org-corp'), { name: 'Stories Corporate' });
  });
});

describe('users', () => {
  it('owner can read own profile and memberships', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'users/alice')));
    await assertSucceeds(getDoc(doc(db, 'users/alice/memberships/org-corp')));
  });

  it("another user cannot read someone else's profile", async () => {
    const db = env.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(db, 'users/alice')));
    await assertFails(getDoc(doc(db, 'users/alice/memberships/org-corp')));
  });

  it('signed-out clients cannot read profiles', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users/alice')));
  });

  it('clients cannot write profiles or grant themselves roles', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice'), { displayName: 'X' }));
    await assertFails(
      setDoc(doc(db, 'users/alice/memberships/org-corp'), { roles: ['SA'] }),
    );
  });
});

describe('default deny', () => {
  it('unlisted collections are closed even to signed-in users', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'orgs/org-corp')));
    await assertFails(setDoc(doc(db, 'orgs/org-evil'), { name: 'x' }));
  });
});
