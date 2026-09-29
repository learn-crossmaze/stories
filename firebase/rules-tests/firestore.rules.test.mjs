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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
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
    await put('config/numbering', { book: 'B{YY}-{SEQ:5}' });
    await put(`orgs/${CORP}/branches/cen/private/razorpay`, { keySecret: 's', webhookSecret: 'w' });
    await put(`orgs/${CORP}/paymentRequests/plink_1`, { branchId: 'cen', status: 'OPEN' });
    await put(`orgs/${CORP}/paymentRequests/plink_2`, { branchId: 'nth', status: 'OPEN' });
    await put(`orgs/${CORP}/employeeIds/EMP-0001`, { uid: 'alice' });
    await put(`orgs/${CORP}/counters/members`, { next: 2 });
    // HRMS
    await put(`orgs/${CORP}/employees/e-cen`, { code: 'EMP-0001', uid: 'alice', fullName: 'Alice', branchId: 'cen', status: 'ACTIVE' });
    await put(`orgs/${CORP}/employees/e-nth`, { code: 'EMP-0002', uid: 'bob', fullName: 'Bob', branchId: 'nth', status: 'ACTIVE' });
    await put(`orgs/${CORP}/employees/e-ho`, { code: 'EMP-0003', uid: null, fullName: 'Hari', branchId: null, status: 'ACTIVE' });
    await put(`orgs/${CORP}/employees/e-cen/history/h1`, { type: 'CREATED' });
    await put(`orgs/${CORP}/employees/e-cen/private/profile`, { pan: 'ABCDE1234F', bank: { last4: '7890' } });
    await put(`orgs/${CORP}/employees/e-cen/private/bank`, { accountNumber: '001234567890' });
    await put(`orgs/${CORP}/employees/e-nth/private/profile`, { pan: 'ZZZZZ9999Z' });
    await put(`orgs/${CORP}/designations/d1`, { name: 'Librarian', status: 'ACTIVE' });
    await put(`orgs/${CORP}/employees/e-cen/documents/doc1`, { orgId: CORP, branchId: 'cen', employeeUid: 'alice', status: 'VERIFIED', typeName: 'PAN card' });
    await put(`orgs/${CORP}/employees/e-nth/documents/doc2`, { orgId: CORP, branchId: 'nth', employeeUid: 'bob', status: 'PENDING', typeName: 'Aadhaar card' });
    await put(`orgs/${CORP}/documentTypes/medical`, { name: 'Medical certificate', status: 'ACTIVE' });
    await put(`orgs/${CORP}/attendance/e-cen_2026-09-01`, { branchId: 'cen', employeeUid: 'alice', date: '2026-09-01', month: '2026-09', status: 'PRESENT' });
    await put(`orgs/${CORP}/attendance/e-nth_2026-09-01`, { branchId: 'nth', employeeUid: 'bob', date: '2026-09-01', month: '2026-09', status: 'ABSENT' });
    await put(`orgs/${CORP}/attendanceCorrections/e-nth_2026-09-01`, { branchId: 'nth', employeeUid: 'bob', status: 'PENDING' });
    await put(`orgs/${CORP}/attendanceSummaries/e-cen_2026-09`, { branchId: 'cen', employeeUid: 'alice', month: '2026-09', payableDays: 30 });
    await put(`orgs/${CORP}/shifts/morning`, { name: 'Morning', status: 'ACTIVE' });
    await put(`orgs/${CORP}/holidays/2026-10-02`, { name: 'Gandhi Jayanti', branchIds: [] });
    await put(`orgs/${CORP}/leaveRequests/lv1`, { branchId: 'cen', employeeUid: 'alice', status: 'PENDING', year: '2026', dates: ['2026-10-05'] });
    await put(`orgs/${CORP}/leaveRequests/lv2`, { branchId: 'nth', employeeUid: 'bob', status: 'APPROVED', year: '2026', dates: ['2026-10-06'] });
    await put(`orgs/${CORP}/leaveBalances/e-cen_2026`, { branchId: 'cen', employeeUid: 'alice', year: '2026', types: { casual: { credited: 9 } } });
    await put(`orgs/${CORP}/leaveLedger/l1`, { branchId: 'nth', employeeUid: 'bob', year: '2026', typeId: 'casual', days: 1 });
    await put(`orgs/${CORP}/leaveTypes/casual`, { name: 'Casual leave', status: 'ACTIVE' });
    await put(`orgs/${CORP}/payrollSettings/2026-04`, { effectiveFrom: '2026-04' });
    await put('users/alice/notifications/n1', { orgId: CORP, kind: 'leave.approved', title: 'Casual leave approved', read: false });
    await put(`orgs/${CORP}/salaries/e-cen_2026-04`, { branchId: 'cen', employeeUid: 'alice', effectiveFrom: '2026-04', monthlyGross: 30000 });
    await put(`orgs/${CORP}/salaries/e-nth_2026-04`, { branchId: 'nth', employeeUid: 'bob', effectiveFrom: '2026-04', monthlyGross: 40000 });
    await put(`orgs/${CORP}/payrollInputs/e-cen_2026-09`, { branchId: 'cen', employeeUid: 'alice', month: '2026-09', tds: 100 });
    await put(`orgs/${CORP}/payrollRuns/2026-09_cen`, { branchId: 'cen', month: '2026-09', status: 'DRAFT' });
    await put(`orgs/${CORP}/payslips/e-cen_2026-09`, { branchId: 'cen', employeeUid: 'alice', month: '2026-09', published: true, net: 28000 });
    await put(`orgs/${CORP}/payslips/e-cen_2026-10`, { branchId: 'cen', employeeUid: 'alice', month: '2026-10', published: false, net: 28000 });
    await put(`orgs/${CORP}/letterTemplates/t1`, { kind: 'OFFER', branchId: null, status: 'PUBLISHED', name: 'Offer', subject: 's', body: 'b' });
    await put(`orgs/${CORP}/offerLetters/o-cen`, { branchId: 'cen', employeeId: 'e-cen', employeeUid: 'alice', status: 'RELEASED', annualCtc: 264000 });
    await put(`orgs/${CORP}/offerLetters/o-nth`, { branchId: 'nth', employeeId: 'e-nth', employeeUid: 'bob', status: 'RELEASED', annualCtc: 264000 });
    await put(`orgs/${CORP}/offerLetters/o-ho`, { branchId: null, employeeId: 'e-ho', employeeUid: 'hana', status: 'RELEASED', annualCtc: 900000 });
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

  it('numbering: anyone signed in reads the book pattern; nobody reads counters or the employee ID index', async () => {
    await assertSucceeds(getDoc(doc(lib(), 'config/numbering')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'config/numbering')));
    await assertFails(setDoc(doc(as('root', claims({}, true)), 'config/numbering'), { book: 'X-{SEQ}' }));
    await assertFails(getDoc(doc(lib(), `orgs/${CORP}/employeeIds/EMP-0001`)));
    await assertFails(getDoc(doc(lib(), `orgs/${CORP}/counters/members`)));
  });

  it('payment gateway secrets are unreadable; payment requests follow branch scope', async () => {
    await assertFails(getDoc(doc(as('root', claims({}, true)), `orgs/${CORP}/branches/cen/private/razorpay`)));
    await assertFails(getDoc(doc(lib(), `orgs/${CORP}/branches/cen/private/razorpay`)));
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/paymentRequests/plink_1`)));
    await assertFails(getDoc(doc(lib(), `orgs/${CORP}/paymentRequests/plink_2`)));
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

  it("a member's audit trail and payments load for branch staff with the branch filter", async () => {
    const bm = as('bea', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
    const trail = (field) => query(collection(bm, `orgs/${CORP}/auditLogs`), where(field, '==', 'm-cen'), where('branchId', 'in', ['cen']));
    await assertSucceeds(getDocs(trail('memberId')));
    await assertSucceeds(getDocs(trail('entityId')));
    await assertFails(getDocs(query(collection(bm, `orgs/${CORP}/auditLogs`), where('memberId', '==', 'm-cen'))));
    const lib = as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));
    await assertSucceeds(getDocs(query(collection(lib, `orgs/${CORP}/payments`), where('memberId', '==', 'm-cen'), where('branchId', 'in', ['cen']))));
    await assertFails(getDocs(query(collection(lib, `orgs/${CORP}/auditLogs`), where('memberId', '==', 'm-cen'), where('branchId', 'in', ['cen']))));
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

  it('looking up a document that does not exist is allowed (page shows "not found")', async () => {
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/depositAccounts/nobody`)));
    await assertSucceeds(getDoc(doc(lib(), `orgs/${CORP}/members/nobody`)));
    await assertFails(getDoc(doc(emp(), `orgs/${CORP}/members/nobody`)));
    await assertFails(getDoc(doc(as('x', claims({ [FRAN]: { r: ['FO'], b: ['*'] } })), `orgs/${CORP}/members/nobody`)));
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

describe('HRMS employee records', () => {
  const hrAdmin = () => as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
  const bmCen = () => as('bina', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
  const alice = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));

  it('HR sees every record, including head-office staff without a branch', async () => {
    await assertSucceeds(getDocs(collection(hrAdmin(), `orgs/${CORP}/employees`)));
    await assertSucceeds(getDoc(doc(hrAdmin(), `orgs/${CORP}/employees/e-ho`)));
    await assertSucceeds(getDoc(doc(hrAdmin(), `orgs/${CORP}/employees/e-nth/private/profile`)));
  });

  it('a branch manager sees their branch only, and no personal details', async () => {
    await assertSucceeds(getDocs(query(collection(bmCen(), `orgs/${CORP}/employees`), where('branchId', 'in', ['cen']))));
    await assertFails(getDocs(collection(bmCen(), `orgs/${CORP}/employees`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/employees/e-nth`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/employees/e-ho`)));
    await assertSucceeds(getDoc(doc(bmCen(), `orgs/${CORP}/employees/e-cen/history/h1`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/employees/e-cen/private/profile`)));
  });

  it('an employee reads their own record and personal details, nobody else\'s', async () => {
    await assertSucceeds(getDocs(query(collection(alice(), `orgs/${CORP}/employees`), where('uid', '==', 'alice'))));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/employees/e-cen/private/profile`)));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/employees/e-cen/history/h1`)));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/employees/e-nth`)));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/employees/e-nth/private/profile`)));
  });

  it('the full bank account number is unreadable from any client; nobody writes HR data', async () => {
    await assertFails(getDoc(doc(hrAdmin(), `orgs/${CORP}/employees/e-cen/private/bank`)));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/employees/e-cen/private/bank`)));
    await assertFails(getDoc(doc(as('root', claims({}, true)), `orgs/${CORP}/employees/e-cen/private/bank`)));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/employees/e-cen`), { status: 'OFFBOARDED' }));
    await assertFails(setDoc(doc(alice(), `orgs/${CORP}/employees/e-cen/private/profile`), { pan: 'X' }));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/designations/d2`), { name: 'X' }));
  });

  it('documents: HR sees the queue, employees their own, branch managers and finance none', async () => {
    await assertSucceeds(getDocs(query(collectionGroup(hrAdmin(), 'documents'), where('orgId', '==', CORP), where('status', '==', 'PENDING'))));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/employees/e-cen/documents/doc1`)));
    await assertSucceeds(getDocs(query(collection(alice(), `orgs/${CORP}/employees/e-cen/documents`), where('employeeUid', '==', 'alice'))));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/employees/e-nth/documents/doc2`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/employees/e-cen/documents/doc1`)));
    await assertFails(getDoc(doc(as('farah', claims({ [CORP]: { r: ['FIN'], b: ['*'] } })), `orgs/${CORP}/employees/e-cen/documents/doc1`)));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/employees/e-cen/documents/doc1`), { status: 'VERIFIED' }));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/documentTypes/medical`)));
    // The profile's Documents tab lists one employee's documents without filters.
    await assertSucceeds(getDocs(collection(hrAdmin(), `orgs/${CORP}/employees/e-nth/documents`)));
    await assertSucceeds(getDocs(collection(alice(), `orgs/${CORP}/employees/e-cen/documents`)));
    await assertFails(getDocs(collection(alice(), `orgs/${CORP}/employees/e-nth/documents`)));
    await assertFails(getDocs(collection(bmCen(), `orgs/${CORP}/employees/e-cen/documents`)));
  });

  it('designations are readable in the org only', async () => {
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/designations/d1`)));
    await assertFails(getDoc(doc(as('fred', claims({ [FRAN]: { r: ['FO'], b: ['*'] } })), `orgs/${CORP}/designations/d1`)));
  });
});

describe('HRMS attendance', () => {
  const hrAdmin = () => as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
  const bmCen = () => as('bina', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
  const alice = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));

  it('viewers see their branches; employees see only their own days', async () => {
    await assertSucceeds(getDocs(query(collection(hrAdmin(), `orgs/${CORP}/attendance`), where('date', '==', '2026-09-01'))));
    await assertSucceeds(getDocs(query(collection(bmCen(), `orgs/${CORP}/attendance`), where('date', '==', '2026-09-01'), where('branchId', 'in', ['cen']))));
    await assertFails(getDocs(query(collection(bmCen(), `orgs/${CORP}/attendance`), where('date', '==', '2026-09-01'))));
    await assertSucceeds(getDocs(query(collection(alice(), `orgs/${CORP}/attendance`), where('employeeUid', '==', 'alice'), where('month', '==', '2026-09'))));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/attendance/e-nth_2026-09-01`)));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/attendanceSummaries/e-cen_2026-09`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/attendanceCorrections/e-nth_2026-09-01`)));
    await assertSucceeds(getDoc(doc(hrAdmin(), `orgs/${CORP}/attendanceCorrections/e-nth_2026-09-01`)));
  });

  it('shifts and holidays are readable in the org; nobody writes attendance from a client', async () => {
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/shifts/morning`)));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/holidays/2026-10-02`)));
    await assertFails(setDoc(doc(alice(), `orgs/${CORP}/attendance/e-cen_2026-09-02`), { employeeUid: 'alice', status: 'PRESENT', branchId: 'cen' }));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/attendanceSummaries/e-cen_2026-09`), { payableDays: 31 }));
  });
});

describe('HRMS leave', () => {
  const hrAdmin = () => as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
  const bmCen = () => as('bina', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
  const alice = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));

  it('approvers see their branches; employees see their own requests and balances', async () => {
    await assertSucceeds(getDocs(query(collection(hrAdmin(), `orgs/${CORP}/leaveRequests`), where('status', '==', 'PENDING'))));
    await assertSucceeds(getDocs(query(collection(bmCen(), `orgs/${CORP}/leaveRequests`), where('status', '==', 'PENDING'), where('branchId', 'in', ['cen']))));
    await assertFails(getDocs(query(collection(bmCen(), `orgs/${CORP}/leaveRequests`), where('status', '==', 'PENDING'))));
    await assertSucceeds(getDocs(query(collection(alice(), `orgs/${CORP}/leaveRequests`), where('employeeUid', '==', 'alice'))));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/leaveRequests/lv2`)));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/leaveBalances/e-cen_2026`)));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/leaveLedger/l1`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/leaveLedger/l1`)));
    await assertSucceeds(getDoc(doc(hrAdmin(), `orgs/${CORP}/leaveLedger/l1`)));
  });

  it('leave types are readable in the org; nobody writes leave from a client', async () => {
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/leaveTypes/casual`)));
    await assertFails(getDoc(doc(as('zed', claims({})), `orgs/${CORP}/leaveTypes/casual`)));
    await assertFails(setDoc(doc(alice(), `orgs/${CORP}/leaveBalances/e-cen_2026`), { employeeUid: 'alice', branchId: 'cen', types: { casual: { credited: 99 } } }));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/leaveRequests/lv3`), { employeeUid: 'hira', status: 'APPROVED' }));
  });
});

describe('HRMS payroll', () => {
  const hrAdmin = () => as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
  const finance = () => as('fina', claims({ [CORP]: { r: ['FIN'], b: ['*'] } }));
  const bmCen = () => as('bina', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
  const alice = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));

  it('salary viewers see salaries, inputs and runs; branch managers do not', async () => {
    await assertSucceeds(getDocs(query(collection(hrAdmin(), `orgs/${CORP}/salaries`), where('effectiveFrom', '==', '2026-04'))));
    await assertSucceeds(getDoc(doc(finance(), `orgs/${CORP}/payrollRuns/2026-09_cen`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/salaries/e-cen_2026-04`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/payrollRuns/2026-09_cen`)));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/payrollInputs/e-cen_2026-09`)));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/salaries/e-cen_2026-04`)));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/salaries/e-nth_2026-04`)));
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/payrollSettings/2026-04`)));
  });

  it('employees see their own payslips once published', async () => {
    await assertSucceeds(getDocs(query(collection(alice(), `orgs/${CORP}/payslips`), where('employeeUid', '==', 'alice'), where('published', '==', true))));
    await assertFails(getDocs(query(collection(alice(), `orgs/${CORP}/payslips`), where('employeeUid', '==', 'alice'))));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/payslips/e-cen_2026-10`)));
    await assertSucceeds(getDoc(doc(finance(), `orgs/${CORP}/payslips/e-cen_2026-10`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/payslips/e-cen_2026-09`)));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/payslips/e-cen_2026-09`), { branchId: 'cen', published: true, net: 99 }));
  });
});

describe('HRMS offer letters', () => {
  const hrAdmin = () => as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
  const finance = () => as('fina', claims({ [CORP]: { r: ['FIN'], b: ['*'] } }));
  const bmCen = () => as('bina', claims({ [CORP]: { r: ['BM'], b: ['cen'] } }));
  const alice = () => as('alice', claims({ [CORP]: { r: ['LIB'], b: ['cen'] } }));

  it('those who release offers at the branch and the employee read them; nobody writes', async () => {
    await assertSucceeds(getDocs(collection(hrAdmin(), `orgs/${CORP}/offerLetters`)));
    await assertSucceeds(getDocs(query(collection(bmCen(), `orgs/${CORP}/offerLetters`), where('branchId', 'in', ['cen']))));
    await assertSucceeds(getDoc(doc(bmCen(), `orgs/${CORP}/offerLetters/o-cen`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/offerLetters/o-nth`)));
    await assertFails(getDoc(doc(bmCen(), `orgs/${CORP}/offerLetters/o-ho`)));
    await assertFails(getDocs(collection(bmCen(), `orgs/${CORP}/offerLetters`)));
    await assertFails(getDoc(doc(finance(), `orgs/${CORP}/offerLetters/o-cen`)));
    await assertSucceeds(getDocs(query(collection(alice(), `orgs/${CORP}/offerLetters`), where('employeeUid', '==', 'alice'))));
    await assertFails(getDoc(doc(alice(), `orgs/${CORP}/offerLetters/o-nth`)));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/offerLetters/o-cen`), { branchId: 'cen', status: 'WITHDRAWN' }));
  });

  it('anyone in the organization reads letter templates; nobody writes them', async () => {
    await assertSucceeds(getDoc(doc(alice(), `orgs/${CORP}/letterTemplates/t1`)));
    await assertSucceeds(getDocs(collection(bmCen(), `orgs/${CORP}/letterTemplates`)));
    await assertFails(getDoc(doc(as('zed', claims({ [FRAN]: { r: ['HR'], b: ['*'] } })), `orgs/${CORP}/letterTemplates/t1`)));
    await assertFails(setDoc(doc(hrAdmin(), `orgs/${CORP}/letterTemplates/t2`), { kind: 'CUSTOM', status: 'DRAFT' }));
  });
});

describe('notifications', () => {
  it('the owner reads and marks read; nothing else', async () => {
    const alice = as('alice', claims());
    const bob = as('bob', claims());
    await assertSucceeds(getDocs(collection(alice, 'users/alice/notifications')));
    await assertFails(getDocs(collection(bob, 'users/alice/notifications')));
    await assertSucceeds(updateDoc(doc(alice, 'users/alice/notifications/n1'), { read: true }));
    await assertFails(updateDoc(doc(alice, 'users/alice/notifications/n1'), { title: 'Something else' }));
    await assertFails(updateDoc(doc(bob, 'users/alice/notifications/n1'), { read: true }));
    await assertFails(setDoc(doc(alice, 'users/alice/notifications/n2'), { orgId: CORP, kind: 'x', title: 'Fake', read: false }));
    await assertFails(deleteDoc(doc(alice, 'users/alice/notifications/n1')));
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
