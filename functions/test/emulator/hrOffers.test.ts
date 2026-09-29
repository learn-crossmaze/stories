import { beforeEach, describe, expect, it } from 'vitest';

import { bucket } from '../../src/catalogue/covers.js';
import { db } from '../../src/core/firebase.js';
import * as docs from '../../src/hr/documents.js';
import * as emp from '../../src/hr/employees.js';
import * as templates from '../../src/hr/letterTemplates.js';
import * as offers from '../../src/hr/offers.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, hr: TestUser, bm: TestUser, bm2: TestUser, northBm: TestUser, lib: TestUser, worker: TestUser;
let org: string, central: string, north: string;

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
const recordOf = async (u: TestUser) => (await db.collection(`orgs/${org}/employees`).where('uid', '==', u.uid).get()).docs[0].id;
const terms = (employeeId: string, extra: Record<string, unknown> = {}) => ({
  orgId: org,
  employeeId,
  designation: 'Library Assistant',
  department: 'Operations',
  employmentType: 'FULL_TIME',
  joiningDate: inDays(20),
  annualCtc: 264000,
  acceptBy: inDays(7),
  reportingTo: 'Priya Shah',
  ...extra,
});
const release = (by: TestUser, employeeId: string, extra: Record<string, unknown> = {}) =>
  call<{ offerId: string; documentId: string; number: string }>(offers.release, by, terms(employeeId, extra));

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, bm, bm2, northBm, lib, worker] = await Promise.all(['hr', 'bm', 'bm2', 'nbm', 'lib', 'worker'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  for (const [u, roles, b] of [
    [hr, ['HR_ADMIN'], ['*']],
    [bm, ['BRANCH_MANAGER'], [central]],
    [bm2, ['BRANCH_MANAGER'], [central]],
    [northBm, ['BRANCH_MANAGER'], [north]],
    [lib, ['LIBRARIAN'], [central]],
    [worker, ['EMPLOYEE'], [central]],
  ] as const) {
    await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds: b });
  }
});

describe('offer letters', () => {
  it('a branch manager releases one; it is filed in the employee documents, opened by the employee, and the employee is told', async () => {
    const workerId = await recordOf(worker);
    const preview = await call<{ content: string }>(offers.preview, bm, terms(workerId), null);
    expect(Buffer.from(preview.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(await db.collection(`orgs/${org}/offerLetters`).count().get().then((c) => c.data().count)).toBe(0);

    const { offerId, documentId, number } = await release(bm, workerId);
    expect(number).toMatch(/^OL\/.+\/\d{4}\/1$/);
    const offer = (await db.doc(`orgs/${org}/offerLetters/${offerId}`).get()).data()!;
    expect(offer).toMatchObject({ status: 'RELEASED', employeeUid: worker.uid, branchId: central, annualCtc: 264000, designation: 'Library Assistant', documentId, releasedBy: bm.uid });
    expect(offer.workLocation).toBe('Central, Bengaluru');
    const doc = (await db.doc(`orgs/${org}/employees/${workerId}/documents/${documentId}`).get()).data()!;
    expect(doc).toMatchObject({ typeId: 'offer-letter-issued', typeName: 'Offer letter', status: 'VERIFIED', employeeUid: worker.uid, contentType: 'application/pdf', number });
    expect((await bucket().file(doc.storagePath).exists())[0]).toBe(true);

    // The employee opens it from their documents, like any other document.
    const mine = await call<{ content: string }>(docs.open, worker, { orgId: org, employeeId: workerId, documentId }, null);
    expect(Buffer.from(mine.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    await call(offers.open, worker, { orgId: org, offerId }, null);
    await call(offers.open, hr, { orgId: org, offerId }, null);
    expect(await failure(call(offers.open, lib, { orgId: org, offerId }, null))).toBe('NOT_FOUND');
    const note = await db.collection(`users/${worker.uid}/notifications`).where('kind', '==', 'offer.released').get();
    expect(note.size).toBe(1);
    const audit = await db.collection(`orgs/${org}/auditLogs`).where('action', '==', 'employee.offer.release').get();
    expect(audit.size).toBe(1);
  });

  it('nobody releases their own offer letter; a branch manager only at their branch; librarians never', async () => {
    const bmId = await recordOf(bm);
    const workerId = await recordOf(worker);
    expect(await failure(release(bm, bmId))).toBe('FORBIDDEN');
    expect(await failure(call(offers.preview, bm, terms(bmId), null))).toBe('FORBIDDEN');
    // Another manager at the branch, or HR, may.
    await release(bm2, bmId);
    await release(hr, bmId);
    expect(await failure(release(northBm, workerId))).toBe('FORBIDDEN');
    expect(await failure(release(lib, workerId))).toBe('FORBIDDEN');
    // HR can't release their own either (the record is theirs by account).
    expect(await failure(release(hr, await recordOf(hr)))).toBe('FORBIDDEN');
    // Head-office staff (no branch) need all branches: HR yes, a branch manager no.
    const hrId = await recordOf(hr);
    await db.doc(`orgs/${org}/employees/${hrId}`).update({ branchId: null });
    expect(await failure(release(bm, hrId))).toBe('FORBIDDEN');
  });

  it('a new offer replaces the earlier one; withdrawing removes the letter from the documents', async () => {
    const workerId = await recordOf(worker);
    const first = await release(hr, workerId);
    const second = await release(bm, workerId, { annualCtc: 300000 });
    expect(second.number).toMatch(/\/2$/);
    const status = async (id: string) => (await db.doc(`orgs/${org}/offerLetters/${id}`).get()).get('status');
    const docStatus = async (id: string) => (await db.doc(`orgs/${org}/employees/${workerId}/documents/${id}`).get()).get('status');
    expect(await status(first.offerId)).toBe('SUPERSEDED');
    expect(await docStatus(first.documentId)).toBe('SUPERSEDED');

    expect(await failure(call(offers.withdraw, bm, { orgId: org, offerId: first.offerId, reason: 'Wrong one' }))).toBe('NOT_RELEASED');
    // The employee can't withdraw an offer made to them (it is theirs).
    expect(await failure(call(offers.withdraw, worker, { orgId: org, offerId: second.offerId, reason: 'No thanks' }))).toBe('FORBIDDEN');
    await call(offers.withdraw, bm, { orgId: org, offerId: second.offerId, reason: 'Position filled' });
    expect(await status(second.offerId)).toBe('WITHDRAWN');
    expect(await docStatus(second.documentId)).toBe('REMOVED');
  });

  it('refuses bad terms and people who have left', async () => {
    const workerId = await recordOf(worker);
    expect(await failure(release(hr, workerId, { acceptBy: inDays(-1) }))).toBe('INVALID_INPUT');
    expect(await failure(release(hr, workerId, { acceptBy: inDays(30) }))).toBe('INVALID_INPUT'); // after joining
    expect(await failure(release(hr, workerId, { annualCtc: 0 }))).toBe('INVALID_INPUT');
    await db.doc(`orgs/${org}/employees/${workerId}`).update({ status: 'OFFBOARDED' });
    expect(await failure(release(hr, workerId))).toBe('NOT_OFFERABLE');
  });
});

describe('letter templates', () => {
  const save = (by: TestUser, fields: Record<string, unknown>) =>
    call<{ templateId: string }>(templates.save, by, { orgId: org, kind: 'OFFER', branchId: null, name: 'Offer letter', subject: 'Offer of employment', body: 'Dear {{firstName}}, welcome to {{org}} as {{designation}}.', acceptance: true, ...fields });
  const publish = (templateId: string) => call(templates.publish, hr, { orgId: org, templateId });
  const offerSubject = async (offerId: string) => (await db.doc(`orgs/${org}/offerLetters/${offerId}`).get()).get('subject');

  it('drafts do nothing until published; a branch template beats the organization one, which beats the built-in', async () => {
    const workerId = await recordOf(worker);
    const northie = (await call<{ employeeId: string }>(emp.create, hr, { orgId: org, fullName: 'Nita North', branchId: north })).employeeId;
    expect(await failure(save(bm, {}))).toBe('FORBIDDEN');
    expect(await failure(save(hr, { body: 'Dear {{nme}}, welcome to the team today.' }))).toBe('INVALID_INPUT');

    const branchDraft = await save(hr, { branchId: central, name: 'Central offer', subject: 'Welcome to Central, {{firstName}}' });
    expect(await offerSubject((await release(hr, workerId)).offerId)).toBe('Offer of employment'); // still built-in
    await publish(branchDraft.templateId);
    expect(await offerSubject((await release(hr, workerId)).offerId)).toMatch(/^Welcome to Central, /);
    expect(await offerSubject((await release(hr, northie)).offerId)).toBe('Offer of employment');
    const orgWide = await save(hr, { subject: 'Joining {{org}}' });
    await publish(orgWide.templateId);
    expect(await offerSubject((await release(hr, northie)).offerId)).toBe('Joining Stories Corporate');
    expect(await offerSubject((await release(hr, workerId)).offerId)).toMatch(/^Welcome to Central, /);

    // A newer branch template replaces the old one.
    const newer = await save(hr, { branchId: central, subject: 'Central, take two' });
    await publish(newer.templateId);
    expect((await db.doc(`orgs/${org}/letterTemplates/${branchDraft.templateId}`).get()).get('status')).toBe('ARCHIVED');
    expect(await offerSubject((await release(hr, workerId)).offerId)).toBe('Central, take two');
  });

  it('issues appointment and custom letters into the employee documents', async () => {
    const workerId = await recordOf(worker);
    await db.doc(`orgs/${org}/employees/${workerId}`).update({ joiningDate: inDays(-30), designationName: 'Library Assistant' });
    // Built-in appointment letter; salary is optional there.
    const appt = await call<{ offerId: string; documentId: string; number: string }>(offers.issueLetter, bm, { orgId: org, employeeId: workerId, kind: 'APPOINTMENT' });
    expect(appt.number).toMatch(/^AL\//);
    const apptDoc = (await db.doc(`orgs/${org}/employees/${workerId}/documents/${appt.documentId}`).get()).data()!;
    expect(apptDoc).toMatchObject({ typeId: 'appointment-letter', typeName: 'Appointment letter', status: 'VERIFIED' });

    // A custom experience letter needs the last working day.
    const exp = await save(hr, { kind: 'CUSTOM', name: 'Experience letter', subject: 'Experience certificate', body: 'This is to certify that {{name}} worked with us as {{designation}} from {{joiningDate}} to {{exitDate}}.', acceptance: false });
    expect(await failure(call(offers.issueLetter, hr, { orgId: org, employeeId: workerId, kind: 'CUSTOM', templateId: exp.templateId }))).toBe('NOT_FOUND'); // still a draft
    await publish(exp.templateId);
    expect(await failure(call(offers.issueLetter, hr, { orgId: org, employeeId: workerId, kind: 'CUSTOM', templateId: exp.templateId }))).toBe('INVALID_INPUT');
    await db.doc(`orgs/${org}/employees/${workerId}`).update({ exitDate: inDays(10) });
    const letter = await call<{ offerId: string; documentId: string }>(offers.issueLetter, hr, { orgId: org, employeeId: workerId, kind: 'CUSTOM', templateId: exp.templateId });
    const doc = (await db.doc(`orgs/${org}/employees/${workerId}/documents/${letter.documentId}`).get()).data()!;
    expect(doc).toMatchObject({ typeId: `letter-${exp.templateId}`, typeName: 'Experience letter', status: 'VERIFIED', employeeUid: worker.uid });
    expect((await db.doc(`orgs/${org}/offerLetters/${letter.offerId}`).get()).data()).toMatchObject({ kind: 'CUSTOM', templateName: 'Experience letter', status: 'RELEASED' });
    await call(offers.open, worker, { orgId: org, offerId: letter.offerId }, null);
    await call(offers.withdraw, hr, { orgId: org, offerId: letter.offerId, reason: 'Issued too early' });

    // Branch-only custom templates stay at their branch; nobody issues letters to themselves.
    const northOnly = await save(hr, { kind: 'CUSTOM', branchId: north, name: 'North notice', subject: 'Notice', body: 'Dear {{firstName}}, a note from the North branch.' });
    await publish(northOnly.templateId);
    expect(await failure(call(offers.issueLetter, hr, { orgId: org, employeeId: workerId, kind: 'CUSTOM', templateId: northOnly.templateId }))).toBe('INVALID_INPUT');
    expect(await failure(call(offers.issueLetter, bm, { orgId: org, employeeId: await recordOf(bm), kind: 'APPOINTMENT' }))).toBe('FORBIDDEN');
    expect(await failure(call(offers.issueLetter, lib, { orgId: org, employeeId: workerId, kind: 'APPOINTMENT' }))).toBe('FORBIDDEN');
  });

  it('previews a template being edited with sample values', async () => {
    const res = await call<{ content: string }>(templates.preview, hr, { orgId: org, branchId: central, name: 'Draft', subject: 'Hello {{firstName}}', body: 'Dear {{name}}, you join on {{joiningDate}}.\n* Salary: {{ctc}}', acceptance: true }, null);
    expect(Buffer.from(res.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(await failure(call(templates.preview, bm, { orgId: org, name: 'Draft', subject: 'Hello', body: 'Dear {{name}}, hello there.' }, null))).toBe('FORBIDDEN');
  });
});
