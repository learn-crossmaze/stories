import { beforeEach, describe, expect, it } from 'vitest';

import { bucket } from '../../src/catalogue/covers.js';
import { db } from '../../src/core/firebase.js';
import * as docs from '../../src/hr/documents.js';
import * as emp from '../../src/hr/employees.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, hr: TestUser, hr2: TestUser, bm: TestUser, fin: TestUser, worker: TestUser;
let org: string, central: string, workerId: string;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

const upload = (by: TestUser, typeId: string, extra: Record<string, unknown> = {}) =>
  call<{ documentId: string; status: string }>(docs.upload, by, { orgId: org, employeeId: workerId, typeId, fileName: `${typeId}.pdf`, content: PDF, ...extra });
const docOf = async (documentId: string) => (await db.doc(`orgs/${org}/employees/${workerId}/documents/${documentId}`).get()).data()!;

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [hr, hr2, bm, fin, worker] = await Promise.all(['hr', 'hr2', 'bm', 'fin', 'worker'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  for (const [u, roles, b] of [
    [hr, ['HR_ADMIN'], ['*']],
    [hr2, ['HR_ADMIN'], ['*']],
    [bm, ['BRANCH_MANAGER'], [central]],
    [fin, ['FINANCE_ADMIN'], ['*']],
    [worker, ['EMPLOYEE'], [central]],
  ] as const) {
    await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds: b });
  }
  workerId = (await db.collection(`orgs/${org}/employees`).where('uid', '==', worker.uid).get()).docs[0].id;
});

describe('employee documents', () => {
  it('HR uploads are verified at once; the file is private and opening it is audited', async () => {
    const { documentId, status } = await upload(hr, 'pan-card', { number: 'ABCDE1234F' });
    expect(status).toBe('VERIFIED');
    const rec = await docOf(documentId);
    expect(rec).toMatchObject({ typeName: 'PAN card', status: 'VERIFIED', employeeUid: worker.uid, branchId: central, contentType: 'application/pdf', number: 'ABCDE1234F' });
    const [exists] = await bucket().file(rec.storagePath).exists();
    expect(exists).toBe(true);

    const opened = await call<{ content: string; contentType: string }>(docs.open, hr2, { orgId: org, employeeId: workerId, documentId }, null);
    expect(opened.contentType).toBe('application/pdf');
    expect(Buffer.from(opened.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    // The employee may open their own; a branch manager or finance may not.
    await call(docs.open, worker, { orgId: org, employeeId: workerId, documentId }, null);
    expect(await failure(call(docs.open, bm, { orgId: org, employeeId: workerId, documentId }, null))).toBe('FORBIDDEN');
    expect(await failure(call(docs.open, fin, { orgId: org, employeeId: workerId, documentId }, null))).toBe('FORBIDDEN');
    const log = await db.collection(`orgs/${org}/auditLogs`).where('action', '==', 'employee.document.open').get();
    expect(log.docs.map((d) => d.get('actorUid')).sort()).toEqual([hr2.uid, worker.uid].sort());
  });

  it('employees upload self-service types for HR to verify; the uploader cannot verify their own', async () => {
    const { documentId, status } = await upload(worker, 'aadhaar', { content: PNG, fileName: 'aadhaar.png' });
    expect(status).toBe('PENDING');
    expect(await failure(upload(worker, 'offer-letter'))).toBe('FORBIDDEN'); // not self-upload
    expect(await failure(upload(bm, 'aadhaar'))).toBe('FORBIDDEN');

    expect(await failure(call(docs.review, hr, { orgId: org, employeeId: workerId, documentId, decision: 'REJECT' }))).toBe('INVALID_INPUT');
    await call(docs.review, hr, { orgId: org, employeeId: workerId, documentId, decision: 'REJECT', reason: 'Photo is blurred' });
    expect(await docOf(documentId)).toMatchObject({ status: 'REJECTED', rejectReason: 'Photo is blurred' });
    expect(await failure(call(docs.review, hr, { orgId: org, employeeId: workerId, documentId, decision: 'VERIFY' }))).toBe('NOT_PENDING');

    const again = await upload(worker, 'aadhaar', { content: PNG, fileName: 'aadhaar-2.png' });
    await call(docs.review, hr, { orgId: org, employeeId: workerId, documentId: again.documentId, decision: 'VERIFY' });
    expect((await docOf(again.documentId)).status).toBe('VERIFIED');

    // An HR admin's own upload for themselves still needs a second person.
    const hrId = (await db.collection(`orgs/${org}/employees`).where('uid', '==', hr.uid).get()).docs[0].id;
    const own = await call<{ documentId: string; status: string }>(docs.upload, hr, { orgId: org, employeeId: hrId, typeId: 'education', fileName: 'deg.pdf', content: PDF });
    expect(own.status).toBe('PENDING');
    expect(await failure(call(docs.review, hr, { orgId: org, employeeId: hrId, documentId: own.documentId, decision: 'VERIFY' }))).toBe('FORBIDDEN');
    await call(docs.review, hr2, { orgId: org, employeeId: hrId, documentId: own.documentId, decision: 'VERIFY' });
  });

  it('rejects files that are not PDF, JPEG or PNG, and requires expiry dates where the type has them', async () => {
    expect(await failure(upload(hr, 'pan-card', { content: Buffer.from('MZ not a pdf').toString('base64') }))).toBe('INVALID_INPUT');
    expect(await failure(upload(hr, 'driving-licence'))).toBe('INVALID_INPUT');
    expect(await failure(upload(hr, 'driving-licence', { expiresOn: inDays(-1) }))).toBe('INVALID_INPUT');
    expect((await upload(hr, 'driving-licence', { expiresOn: inDays(200) })).status).toBe('VERIFIED');
  });

  it('a newer verified copy supersedes the old one, and verification ticks the onboarding checklist', async () => {
    const hire = await call<{ employeeId: string }>(emp.create, hr, { orgId: org, fullName: 'Neha Kapoor', branchId: central });
    workerId = hire.employeeId;
    await call(emp.transition, hr, { orgId: org, employeeId: workerId, transition: 'START_ONBOARDING' });
    const first = await upload(hr, 'pan-card');
    const onboarding = (await db.doc(`orgs/${org}/employees/${workerId}`).get()).get('onboarding') as { key: string; done: boolean }[];
    expect(onboarding.find((i) => i.key === 'pan')?.done).toBe(true);
    const second = await upload(hr2, 'pan-card');
    expect((await docOf(first.documentId)).status).toBe('SUPERSEDED');
    expect((await docOf(second.documentId)).status).toBe('VERIFIED');
  });

  it('removal: HR removes anything; employees only withdraw their own pending upload', async () => {
    const verified = await upload(hr, 'pan-card');
    const pending = await upload(worker, 'photo', { content: PNG, fileName: 'me.png' });
    expect(await failure(call(docs.remove, worker, { orgId: org, employeeId: workerId, documentId: verified.documentId, reason: 'Mistake' }))).toBe('FORBIDDEN');
    await call(docs.remove, worker, { orgId: org, employeeId: workerId, documentId: pending.documentId, reason: 'Wrong photo' });
    await call(docs.remove, hr, { orgId: org, employeeId: workerId, documentId: verified.documentId, reason: 'Duplicate' });
    expect((await docOf(pending.documentId)).status).toBe('REMOVED');
    expect((await docOf(verified.documentId)).status).toBe('REMOVED');
  });

  it('the daily sweep marks expired documents; document types can be changed and archived', async () => {
    const lic = await upload(hr, 'driving-licence', { expiresOn: inDays(5) });
    expect(await docs.expireDocuments(new Date(Date.now() + 3 * 86_400_000))).toBe(0);
    expect(await docs.expireDocuments(new Date(Date.now() + 7 * 86_400_000))).toBe(1);
    expect((await docOf(lic.documentId)).status).toBe('EXPIRED');
    expect(await docs.expireDocuments(new Date(Date.now() + 7 * 86_400_000))).toBe(0);

    expect(await failure(call(docs.saveType, bm, { orgId: org, name: 'Medical certificate', category: 'OTHER', required: false, hasExpiry: true, selfUpload: true }))).toBe('FORBIDDEN');
    const { typeId } = await call<{ typeId: string }>(docs.saveType, hr, { orgId: org, name: 'Medical certificate', category: 'OTHER', required: false, hasExpiry: true, reminderDays: 20, selfUpload: true });
    expect((await upload(worker, typeId, { expiresOn: inDays(100) })).status).toBe('PENDING');
    // Overriding a default type under its id; archiving stops new uploads.
    await call(docs.saveType, hr, { orgId: org, typeId: 'photo', name: 'Passport photo', category: 'IDENTITY', required: true, hasExpiry: false, selfUpload: true, checklistKey: 'photo' });
    expect((await db.doc(`orgs/${org}/documentTypes/photo`).get()).get('name')).toBe('Passport photo');
    await call(docs.archiveType, hr, { orgId: org, typeId: 'education', reason: 'Not needed' });
    expect(await failure(upload(hr, 'education'))).toBe('NOT_FOUND');
  });
});
