import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

// Claims shape: { v, sa, o: { orgId: { r: [roleCodes], b: [branchIds] | ['*'] } } } — docs/RBAC.md §4.
const CORP = 'org-corp';
const FRAN = 'org-fran';
const FRAN2 = 'org-fran2';
const claims = (o = {}, sa = false) => ({ v: 1, sa, o });

let env;
const as = (uid, token) => env.authenticatedContext(uid, token).firestore();

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
    const put = (path, data) => setDoc(doc(db, path), data);
    await put('users/alice', { displayName: 'Alice' });
    await put(`users/alice/memberships/${CORP}`, { orgId: CORP, roles: ['LIBRARIAN'], branchIds: ['cen'], status: 'ACTIVE' });
    await put(`users/bob/memberships/${CORP}`, { orgId: CORP, roles: ['EMPLOYEE'], branchIds: ['nth'], status: 'ACTIVE' });
    await put(`users/fred/memberships/${FRAN}`, { orgId: FRAN, roles: ['FRANCHISE_OWNER'], branchIds: ['*'], status: 'ACTIVE' });
    for (const o of [CORP, FRAN, FRAN2]) await put(`orgs/${o}`, { name: o });
    await put(`orgs/${CORP}/branches/cen`, { name: 'Central', status: 'ACTIVE' });
    await put(`orgs/${CORP}/branches/nth`, { name: 'North', status: 'ACTIVE' });
    await put(`orgs/${FRAN}/branches/fr1`, { name: 'Franchise 1', status: 'ACTIVE' });
    await put(`orgs/${FRAN2}/branches/fr2`, { name: 'Franchise 2', status: 'ACTIVE' });
    await put(`orgs/${FRAN2}/departments/d1`, { name: 'Ops' });
    await put(`orgs/${CORP}/auditLogs/a-cen`, { action: 'x', branchId: 'cen' });
    await put(`orgs/${CORP}/auditLogs/a-nth`, { action: 'x', branchId: 'nth' });
    await put(`orgs/${CORP}/auditLogs/a-org`, { action: 'x', branchId: null });
    await put(`orgs/${FRAN}/auditLogs/f1`, { action: 'x', branchId: 'fr1' });
  });
});

describe('users', () => {
  it('owner can read own profile and memberships', async () => {
    const db = as('alice', claims());
    await assertSucceeds(getDoc(doc(db, 'users/alice')));
    await assertSucceeds(getDoc(doc(db, `users/alice/memberships/${CORP}`)));
  });

  it("another user cannot read someone else's profile", async () => {
    const db = as('bob', claims());
    await assertFails(getDoc(doc(db, 'users/alice')));
    await assertFails(getDoc(doc(db, `users/alice/memberships/${CORP}`)));
  });

  it('signed-out clients cannot read profiles', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice')));
  });

  it('clients cannot write profiles or grant themselves roles', async () => {
    const db = as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));
    await assertFails(setDoc(doc(db, 'users/alice'), { displayName: 'X', platformRoles: ['SUPER_ADMIN'] }));
    await assertFails(setDoc(doc(db, `users/alice/memberships/${CORP}`), { roles: ['HEAD_OFFICE_ADMIN'] }));
  });
});

describe('organization isolation', () => {
  const lib = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));

  it('members of an org can read the org, its branches and departments', async () => {
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}`)));
    await assertSucceeds(getDocs(collection(lib(), `orgs/${CORP}/branches`)));
  });

  it('users without a role in an org see nothing of it', async () => {
    await assertFails(getDoc(doc(lib(), `orgs/${FRAN}`)));
    await assertFails(getDocs(collection(lib(), `orgs/${FRAN}/branches`)));
    await assertFails(getDoc(doc(as('nobody', claims()), `orgs/${CORP}`)));
  });

  it('Franchise A cannot read Franchise B', async () => {
    const fo = as('fred', claims({ [FRAN]: { r: ['FO'], b: ['*'] } }));
    await assertSucceeds(getDocs(collection(fo, `orgs/${FRAN}/branches`)));
    await assertFails(getDoc(doc(fo, `orgs/${FRAN2}`)));
    await assertFails(getDoc(doc(fo, `orgs/${FRAN2}/branches/fr2`)));
    await assertFails(getDoc(doc(fo, `orgs/${FRAN2}/departments/d1`)));
  });

  it('only super admins can list all organizations', async () => {
    await assertSucceeds(getDocs(collection(as('root', claims({}, true)), 'orgs')));
    await assertFails(getDocs(collection(lib(), 'orgs')));
  });

  it('clients cannot write org data even with roles', async () => {
    const ho = as('hana', claims({ [CORP]: { r: ['HO'], b: ['*'] } }));
    await assertFails(setDoc(doc(ho, `orgs/${CORP}/branches/new`), { name: 'x' }));
    await assertFails(setDoc(doc(ho, `orgs/${CORP}`), { name: 'x' }));
  });
});

describe('audit log', () => {
  it('org-wide auditors read every entry of their org only', async () => {
    const fin = as('fina', claims({ [CORP]: { r: ['FIN'], b: ['*'] } }));
    await assertSucceeds(getDocs(collection(fin, `orgs/${CORP}/auditLogs`)));
    await assertFails(getDocs(collection(fin, `orgs/${FRAN}/auditLogs`)));
  });

  it('branch managers read only their branch entries (branch isolation)', async () => {
    const bm = as('bea', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
    await assertSucceeds(getDocs(query(collection(bm, `orgs/${CORP}/auditLogs`), where('branchId', 'in', ['cen']))));
    await assertSucceeds(getDoc(doc(bm, `orgs/${CORP}/auditLogs/a-cen`)));
    await assertFails(getDoc(doc(bm, `orgs/${CORP}/auditLogs/a-nth`)));
    await assertFails(getDoc(doc(bm, `orgs/${CORP}/auditLogs/a-org`)));
    await assertFails(getDocs(collection(bm, `orgs/${CORP}/auditLogs`)));
  });

  it('roles without audit.view are denied', async () => {
    const lib = as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));
    await assertFails(getDoc(doc(lib, `orgs/${CORP}/auditLogs/a-cen`)));
  });
});

describe('staff directory (memberships collection group)', () => {
  it('org-wide staff viewers list all memberships of their org', async () => {
    const hr = as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
    const snap = await assertSucceeds(getDocs(query(collectionGroup(hr, 'memberships'), where('orgId', '==', CORP))));
    if (snap.size !== 2) throw new Error(`expected 2 memberships, got ${snap.size}`);
    await assertFails(getDocs(query(collectionGroup(hr, 'memberships'), where('orgId', '==', FRAN))));
  });

  it('branch managers list only staff overlapping their branches', async () => {
    const bm = as('bea', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
    await assertSucceeds(
      getDocs(query(collectionGroup(bm, 'memberships'), where('orgId', '==', CORP), where('branchIds', 'array-contains-any', ['cen']))),
    );
    await assertFails(getDocs(query(collectionGroup(bm, 'memberships'), where('orgId', '==', CORP))));
  });

  it('staff without staff.view cannot list colleagues', async () => {
    const lib = as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));
    await assertFails(getDocs(query(collectionGroup(lib, 'memberships'), where('orgId', '==', CORP))));
  });
});

describe('default deny', () => {
  it('unlisted collections are closed, even to super admins from the client', async () => {
    const root = as('root', claims({}, true));
    await assertFails(getDocs(collection(root, 'idempotency')));
    await assertFails(getDoc(doc(root, 'platform/state')));
    await assertFails(getDocs(collection(root, `orgs/${CORP}/branchCodes`)));
  });
});
