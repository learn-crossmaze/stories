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
    // Phase 1 library data
    await put('books/b1', { title: 'Treasure Island', status: 'ACTIVE' });
    await put('isbnIndex/9780306406157', { bookId: 'b1' });
    await put(`orgs/${CORP}/copies/c-cen`, { code: 'COPY-1', currentBranchId: 'cen', owningBranchId: 'cen', status: 'AVAILABLE' });
    await put(`orgs/${CORP}/copies/c-nth`, { code: 'COPY-2', currentBranchId: 'nth', owningBranchId: 'nth', status: 'AVAILABLE' });
    await put(`orgs/${CORP}/copies/c-moved`, { code: 'COPY-3', currentBranchId: 'nth', owningBranchId: 'cen', status: 'AVAILABLE' });
    await put(`orgs/${CORP}/copies/c-cen/events/e1`, { type: 'ACQUIRED' });
    await put(`orgs/${CORP}/members/m-cen`, { fullName: 'Asha', homeBranchId: 'cen' });
    await put(`orgs/${CORP}/members/m-nth`, { fullName: 'Ravi', homeBranchId: 'nth' });
    await put(`orgs/${FRAN}/members/m-fr`, { fullName: 'Fatima', homeBranchId: 'fr1' });
    await put(`orgs/${CORP}/loans/l-cen`, { memberId: 'm-cen', branchId: 'cen', status: 'ACTIVE' });
    await put(`orgs/${CORP}/depositAccounts/m-cen`, { branchId: 'cen', balanceMinor: 100000 });
    await put(`orgs/${CORP}/depositAccounts/m-cen/transactions/t1`, { branchId: 'cen', deltaMinor: 100000 });
    await put(`orgs/${CORP}/payments/p1`, { branchId: 'cen', amountMinor: 130000 });
    await put(`orgs/${CORP}/transfers/t1`, { fromBranchId: 'cen', toBranchId: 'nth', status: 'IN_TRANSIT' });
    await put(`orgs/${CORP}/plans/plan1`, { name: 'Monthly', status: 'ACTIVE' });
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

describe('library (Phase 1)', () => {
  const lib = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));
  const del = () => as('dev', claims({ [CORP]: { r: ['DEL'], b: ['cen'] } }));
  const emp = () => as('esha', claims({ [CORP]: { r: ['EMP'], b: ['cen'] } }));

  it('catalogue is readable by any signed-in user and never writable from clients', async () => {
    await assertSucceeds(getDoc(doc(as('member', claims()), 'books/b1')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'books/b1')));
    await assertFails(setDoc(doc(as('root', claims({}, true)), 'books/b2'), { title: 'x' }));
    await assertFails(getDoc(doc(lib(), 'isbnIndex/9780306406157')));
  });

  it('copies are visible only at the holding or owning branch (branch isolation)', async () => {
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/copies/c-cen`)));
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/copies/c-moved`))); // owned by cen, now at nth
    await assertFails(getDoc(doc(lib(), `orgs/${CORP}/copies/c-nth`)));
    await assertSucceeds(getDocs(query(collection(lib(), `orgs/${CORP}/copies`), where('currentBranchId', '==', 'cen'))));
    await assertFails(getDocs(collection(lib(), `orgs/${CORP}/copies`)));
    await assertSucceeds(getDocs(collection(lib(), `orgs/${CORP}/copies/c-cen/events`)));
    await assertFails(getDoc(doc(emp(), `orgs/${CORP}/copies/c-cen`)));
  });

  it('members, loans and money are scoped to the branch and to roles that need them', async () => {
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/members/m-cen`)));
    await assertFails(getDoc(doc(lib(), `orgs/${CORP}/members/m-nth`)));
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/loans/l-cen`)));
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/depositAccounts/m-cen`)));
    await assertSucceeds(getDocs(collection(lib(), `orgs/${CORP}/depositAccounts/m-cen/transactions`)));
    await assertFails(getDoc(doc(del(), `orgs/${CORP}/members/m-cen`)));
    await assertFails(getDoc(doc(del(), `orgs/${CORP}/depositAccounts/m-cen`)));
    await assertFails(getDoc(doc(emp(), `orgs/${CORP}/payments/p1`)));
    const fin = as('fina', claims({ [CORP]: { r: ['FIN'], b: ['*'] } }));
    await assertSucceeds(getDocs(collection(fin, `orgs/${CORP}/payments`)));
  });

  it('Franchise A cannot read Franchise B members; corporate staff cannot read franchise members', async () => {
    const fo2 = as('fred2', claims({ [FRAN2]: { r: ['FO'], b: ['*'] } }));
    await assertFails(getDoc(doc(fo2, `orgs/${FRAN}/members/m-fr`)));
    const ho = as('hana', claims({ [CORP]: { r: ['HO'], b: ['*'] } }));
    await assertFails(getDoc(doc(ho, `orgs/${FRAN}/members/m-fr`)));
  });

  it('transfers are visible to both the sending and the receiving branch', async () => {
    const nthLib = as('nora', claims({ [CORP]: { r: ['LIB'], b: ['nth'] } }));
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/transfers/t1`)));
    await assertSucceeds(getDocs(query(collection(nthLib, `orgs/${CORP}/transfers`), where('toBranchId', '==', 'nth'))));
  });

  it('clients can never write library data, whatever their role', async () => {
    const ho = as('hana', claims({ [CORP]: { r: ['HO'], b: ['*'] } }));
    await assertFails(setDoc(doc(ho, `orgs/${CORP}/copies/c-cen`), { status: 'RETIRED' }));
    await assertFails(setDoc(doc(ho, `orgs/${CORP}/depositAccounts/m-cen`), { balanceMinor: 0 }));
    await assertFails(setDoc(doc(lib(), `orgs/${CORP}/loans/l-new`), { status: 'ACTIVE' }));
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
