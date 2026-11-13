import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getCountFromServer, getDocs, limit, query, setDoc, where } from 'firebase/firestore';

// The reads behind the counts beside the Master control pages (apps/web/src/data/setupCounts.ts and listLeaveTypes),
// in exactly the shape the console sends them, for the people the menu asks them of. Claims as in
// firestore.rules.test.mjs (docs/RBAC.md §4).
const CORP = 'org-corp';
const FRAN = 'org-fran';
const RBAC = JSON.parse(readFileSync('firebase/rules-src/permissions.json', 'utf8'));
const CODES = JSON.parse(readFileSync('firebase/rules-src/permission-codes.json', 'utf8'));
const permsFor = ({ r = [], b = [], x = [] }) => {
  const held = Object.entries(RBAC.permissions).filter(([, roles]) => roles.some((c) => r.includes(c))).map(([p]) => p);
  return [...new Set([...held, ...x])].filter((p) => b.includes('*') || !RBAC.orgWide.list.includes(p)).map((p) => CODES[p]).sort().join('');
};
const claims = (o = {}, sa = false) => ({
  v: 1,
  sa,
  o: Object.fromEntries(Object.entries(o).map(([id, c]) => [id, { r: c.r ?? [], b: c.b ?? [], p: permsFor(c) }])),
});

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
    for (const o of [CORP, FRAN]) await put(`orgs/${o}`, { name: o });
    await put(`orgs/${CORP}/holidays/2026-10-02`, { name: 'Gandhi Jayanti', date: '2026-10-02', year: '2026', branchIds: [] });
    await put(`orgs/${CORP}/leaveTypes/casual`, { name: 'Casual leave', status: 'ARCHIVED' });
    await put(`orgs/${CORP}/letterTemplates/t1`, { kind: 'OFFER', branchId: null, status: 'PUBLISHED', name: 'Offer' });
    await put(`orgs/${CORP}/letterTemplates/t2`, { kind: 'CUSTOM', branchId: null, status: 'DRAFT', name: 'Warning' });
    await put(`orgs/${CORP}/payrollSettings/2026-04`, { effectiveFrom: '2026-04' });
    await put(`orgs/${CORP}/salaries/e-cen_2026-04`, { branchId: 'cen', employeeUid: 'alice', effectiveFrom: '2026-04', monthlyGross: 30000 });
    await put(`orgs/${CORP}/salaries/e-ho_2026-04`, { branchId: null, employeeUid: 'hana', effectiveFrom: '2026-04', monthlyGross: 90000 });
  });
});

describe('the reads behind the Master control counts', () => {
  // Who sees the menu items: HR Admin and the Branch Owner (hr.config, salary.edit); the queries themselves are
  // open to anyone in the organization, except salaries.
  const hrAdmin = () => as('hira', claims({ [CORP]: { r: ['HR'], b: ['*'] } }));
  const owner = () => as('omar', claims({ [CORP]: { r: ['OWN'], b: ['*'] } }));
  const bmCen = () => as('bina', claims({ [CORP]: { r: ['SLIB'], b: ['cen'] } }));
  const outsider = () => as('zed', claims({ [FRAN]: { r: ['HR'], b: ['*'] } }));
  // A role of one's own that edits salaries without seeing them all (at one branch, organization-wide permissions drop).
  const editorOnly = () => as('edna', claims({ [CORP]: { r: [], b: ['*'], x: ['salary.edit'] } }));

  const anyHoliday = (db, year) => getDocs(query(collection(db, `orgs/${CORP}/holidays`), where('year', '==', year), limit(1)));
  const draftLetters = (db) => getCountFromServer(query(collection(db, `orgs/${CORP}/letterTemplates`), where('status', '==', 'DRAFT')));
  const anyOf = (db, name) => getDocs(query(collection(db, `orgs/${CORP}/${name}`), limit(1)));

  it('Shifts & holidays: "is any holiday entered for this year?" is one row for anyone in the organization', async () => {
    for (const who of [hrAdmin, owner, bmCen]) {
      await assertSucceeds(anyHoliday(who(), '2026'));
      await assertSucceeds(anyHoliday(who(), '2027')); // A year with none answers "no", not "refused".
    }
    await assertFails(anyHoliday(outsider(), '2026'));
  });

  it('Leave types: the list is readable in the organization', async () => {
    await assertSucceeds(getDocs(collection(hrAdmin(), `orgs/${CORP}/leaveTypes`)));
    await assertSucceeds(getDocs(collection(owner(), `orgs/${CORP}/leaveTypes`)));
    await assertFails(getDocs(collection(outsider(), `orgs/${CORP}/leaveTypes`)));
  });

  it('Letter templates: the count of drafts is allowed in the organization', async () => {
    await assertSucceeds(draftLetters(hrAdmin()));
    await assertSucceeds(draftLetters(owner()));
    await assertFails(draftLetters(outsider()));
  });

  it('Payroll settings: "was anything saved?" is one row for anyone in the organization', async () => {
    await assertSucceeds(anyOf(hrAdmin(), 'payrollSettings'));
    await assertSucceeds(anyOf(owner(), 'payrollSettings'));
    await assertSucceeds(anyOf(editorOnly(), 'payrollSettings'));
    await assertFails(anyOf(outsider(), 'payrollSettings'));
  });

  it('Payroll settings: "does anyone have a salary?" only for those who see every salary', async () => {
    await assertSucceeds(anyOf(hrAdmin(), 'salaries'));
    await assertSucceeds(anyOf(owner(), 'salaries'));
    // Without salary.view for all branches the unfiltered read is refused, so the console shows no count.
    await assertFails(anyOf(editorOnly(), 'salaries'));
    await assertFails(anyOf(bmCen(), 'salaries'));
    await assertFails(anyOf(outsider(), 'salaries'));
  });
});
