import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import * as site from '../../src/site/admin.js';
import { todayInIndia } from '../../src/site/content.js';
import * as inbox from '../../src/site/inbox.js';
import { handleSitePublic } from '../../src/site/public.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// The Website section's quicker paths: "Save and publish" in one transaction, the answer every save and publish
// gives the editor (so it does not read the item again), lists that read a few fields only, Publish all's single
// read stage, and enquiries: the open list, one enquiry, and marking from the list without touching its note.

let sa: TestUser, editor: TestUser, bm: TestUser, lib: TestUser, otherBm: TestUser;
let org: string, central: string, north: string;

const post = (over: Record<string, unknown> = {}) => ({ title: 'Ten books for rainy days', slug: 'ten-books-for-rainy-days', summary: 'Cosy reads.', design: 'BOOKLIST', ...over });
const postDoc = async (id: string) => (await db.doc(`sitePosts/${id}`).get()).data();
const publishLog = async (itemId: string) => (await db.collection('sitePublishLog').where('itemId', '==', itemId).get()).docs.map((d) => d.get('action') as string);
const audits = async (entityId: string) =>
  (await db.collection(`orgs/${org}/auditLogs`).where('entityId', '==', entityId).get()).docs.map((d) => d.get('action') as string).sort();

/** What the editor's bar shows of an item: every command's answer must agree with a fresh read on these. */
const STANDING = ['id', 'exists', 'status', 'isLive', 'changed', 'liveSlug', 'liveOn', 'previewToken', 'updatedBy', 'publishedBy', 'canPublish', 'canDelete'] as const;
type View = Record<(typeof STANDING)[number] | 'updatedAt' | 'publishedAt', unknown> & { id: string; review: { by: string; at: string } | null; result?: string };
const standing = (v: Record<string, unknown>) => Object.fromEntries(STANDING.map((k) => [k, v[k]]));
const read = (who: TestUser, kind: string, id?: string) => call<View & { draft: Record<string, unknown> }>(site.get, who, { kind, ...(id ? { id } : {}) }, null);

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [editor, bm, lib, otherBm] = await Promise.all(['web@stories.test', 'bm@stories.test', 'lib@stories.test', 'bm2@stories.test'].map((e) => createUser(e)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories for All', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: editor.email, roles: ['WEBSITE_EDITOR'], branchIds: ['*'] });
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['SENIOR_LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: otherBm.email, roles: ['SENIOR_LIBRARIAN'], branchIds: [north] });
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
});

describe('website: save and publish in one call', () => {
  it('saves and publishes a new post in one transaction, with both audit entries and one publish log row', async () => {
    const requestId = randomUUID();
    const saved = await call<View>(site.save, editor, { kind: 'post', draft: post(), publish: true }, requestId);
    expect(saved).toMatchObject({ exists: true, status: 'LIVE', isLive: true, changed: false, liveSlug: 'ten-books-for-rainy-days', liveOn: todayInIndia(), review: null, canPublish: true, canDelete: true, result: 'publish' });
    expect(saved.previewToken).toEqual(expect.any(String));
    expect(await postDoc(saved.id)).toMatchObject({
      isLive: true, changed: false, review: null, slug: 'ten-books-for-rainy-days', liveSlug: 'ten-books-for-rainy-days', liveOn: todayInIndia(), liveBranchId: null,
      live: { title: 'Ten books for rainy days' }, publishedBy: { uid: editor.uid }, createdBy: { uid: editor.uid },
    });
    expect(await publishLog(saved.id)).toEqual(['publish']);
    expect(await audits(saved.id)).toEqual(['site.post.publish', 'site.post.save']);
    // What the command answered is what a fresh read of the item says.
    expect(standing(saved)).toEqual(standing(await read(editor, 'post', saved.id)));

    // The same request again (a retry): the stored answer, and nothing is written twice.
    expect(await call<View>(site.save, editor, { kind: 'post', draft: post(), publish: true }, requestId)).toEqual(saved);
    expect(await publishLog(saved.id)).toEqual(['publish']);
    expect(await audits(saved.id)).toEqual(['site.post.publish', 'site.post.save']);

    // A later edit published the same way keeps the day it first went live.
    await db.doc(`sitePosts/${saved.id}`).update({ liveOn: '2026-01-05' });
    const again = await call<View>(site.save, editor, { kind: 'post', id: saved.id, draft: post({ title: 'Twelve books for rainy days' }), publish: true });
    expect(again).toMatchObject({ status: 'LIVE', liveOn: '2026-01-05', result: 'publish' });
    expect((await postDoc(saved.id))?.live).toMatchObject({ title: 'Twelve books for rainy days' });
  });

  it('refuses the whole save when the person may not publish: nothing is kept', async () => {
    const about = { orgId: org, branchId: central };
    expect(await failure(call(site.save, lib, { kind: 'post', draft: post({ branch: about }), publish: true }))).toBe('FORBIDDEN');
    expect((await db.collection('sitePosts').get()).size).toBe(0);
    // Their saved post: a later "save and publish" neither changes the draft nor publishes it.
    const { id } = await call<View>(site.save, lib, { kind: 'post', draft: post({ branch: about }) });
    expect(await failure(call(site.save, lib, { kind: 'post', id, draft: post({ title: 'Changed', branch: about }), publish: true }))).toBe('FORBIDDEN');
    expect(await postDoc(id)).toMatchObject({ isLive: false, draft: { title: 'Ten books for rainy days' } });
    expect(await publishLog(id)).toEqual([]);
    // Only the website team runs offers and the single pages.
    expect(await failure(call(site.save, bm, { kind: 'sections', draft: {}, publish: true }))).toBe('FORBIDDEN');
  });

  it('lets a branch manager save and publish a post about their branch, not about another or none', async () => {
    // What they may do is decided on the draft being saved: with no branch (or someone else's) they can't publish.
    expect(await failure(call(site.save, bm, { kind: 'post', draft: post(), publish: true }))).toBe('FORBIDDEN');
    expect(await failure(call(site.save, bm, { kind: 'post', draft: post({ branch: { orgId: org, branchId: north } }), publish: true }))).toBe('FORBIDDEN');
    expect((await db.collection('sitePosts').get()).size).toBe(0);
    // A librarian's post about the manager's branch: the manager edits and publishes it in one go, and the writer is told.
    const { id } = await call<View>(site.save, lib, { kind: 'post', draft: post({ branch: { orgId: org, branchId: central } }) });
    await call(site.requestReview, lib, { id });
    const done = await call<View>(site.save, bm, { kind: 'post', id, draft: post({ summary: 'Checked.', branch: { orgId: org, branchId: central } }), publish: true });
    expect(done).toMatchObject({ status: 'LIVE', isLive: true, review: null, canPublish: true, canDelete: false, result: 'publish' });
    expect(await postDoc(id)).toMatchObject({ isLive: true, liveBranchId: central, review: null, live: { summary: 'Checked.' } });
    expect((await db.collection(`users/${lib.uid}/notifications`).get()).docs.map((d) => d.get('kind'))).toEqual(['site.post.published']);
    expect(await failure(call(site.save, otherBm, { kind: 'post', id, draft: post({ branch: { orgId: org, branchId: central } }), publish: true }))).toBe('FORBIDDEN');
    // A branch page too: its own manager, in one call, on the first save.
    const page = await call<View>(site.save, bm, { kind: 'branch', id: central, orgId: org, draft: { slug: 'central' }, publish: true });
    expect(page).toMatchObject({ exists: true, status: 'LIVE', liveSlug: 'central', result: 'publish' });
    expect(page.previewToken).toEqual(expect.any(String));
    expect(await failure(call(site.save, otherBm, { kind: 'branch', id: central, orgId: org, draft: { slug: 'central' }, publish: true }))).toBe('FORBIDDEN');
  });

  it('takes a hidden item off the website, and does nothing for a hidden one that was never on it', async () => {
    const hiddenNew = await call<View>(site.save, editor, { kind: 'post', draft: post({ hidden: true }), publish: true });
    expect(hiddenNew).toMatchObject({ status: 'HIDDEN', isLive: false, changed: false, result: 'none' });
    expect(await publishLog(hiddenNew.id)).toEqual([]);
    expect(await audits(hiddenNew.id)).toEqual(['site.post.save']);

    const { id } = await call<View>(site.save, editor, { kind: 'post', draft: post({ slug: 'second' }), publish: true });
    const down = await call<View>(site.save, editor, { kind: 'post', id, draft: post({ slug: 'second', hidden: true }), publish: true });
    expect(down).toMatchObject({ status: 'HIDDEN', isLive: false, changed: false, liveSlug: null, result: 'unpublish' });
    expect(await postDoc(id)).toMatchObject({ isLive: false, live: null, liveSlug: null, changed: false, draft: { hidden: true } });
    expect(await publishLog(id)).toEqual(expect.arrayContaining(['publish', 'unpublish']));
    expect(await audits(id)).toEqual(['site.post.publish', 'site.post.save', 'site.post.save', 'site.post.unpublish']);
    expect(standing(down)).toEqual(standing(await read(editor, 'post', id)));
  });

  it('keeps addresses unique, and saves nothing when the address is taken', async () => {
    await call(site.save, editor, { kind: 'post', draft: post(), publish: true });
    expect(await failure(call(site.save, editor, { kind: 'post', draft: post({ title: 'Another' }), publish: true }))).toBe('SLUG_TAKEN');
    expect((await db.collection('sitePosts').get()).size).toBe(1);
  });
});

describe('website: what a save or publish answers', () => {
  it('answers every command with how the item now stands, as a fresh read would', async () => {
    const about = { orgId: org, branchId: central };
    const saved = await call<View>(site.save, lib, { kind: 'post', draft: post({ branch: about }) });
    // A plain save: a draft with a preview address, which its writer may delete but not publish.
    expect(saved).toMatchObject({ exists: true, status: 'DRAFT', isLive: false, changed: true, liveSlug: null, review: null, canPublish: false, canDelete: true });
    expect(saved).not.toHaveProperty('result');
    expect(saved).not.toHaveProperty('draft');
    expect(saved.updatedAt).toEqual(expect.any(String));
    expect(standing(saved)).toEqual(standing(await read(lib, 'post', saved.id)));

    const asked = await call<View>(site.requestReview, lib, { id: saved.id });
    expect(asked).toMatchObject({ status: 'IN_REVIEW', review: { by: 'lib' } });
    const afterAsk = await read(lib, 'post', saved.id);
    expect(standing(asked)).toEqual(standing(afterAsk));
    expect(afterAsk.review?.by).toBe('lib');

    const live = await call<View>(site.publish, bm, { kind: 'post', id: saved.id });
    expect(live).toMatchObject({ status: 'LIVE', isLive: true, changed: false, review: null, liveOn: todayInIndia(), canPublish: true, result: 'publish' });
    expect(standing(live)).toEqual(standing(await read(bm, 'post', saved.id)));
    // Its writer can no longer delete it.
    expect((await read(lib, 'post', saved.id)).canDelete).toBe(false);

    const changed = await call<View>(site.save, lib, { kind: 'post', id: saved.id, draft: post({ title: 'Twelve books', branch: about }) });
    expect(changed).toMatchObject({ status: 'CHANGED', isLive: true, changed: true, canDelete: false, liveSlug: 'ten-books-for-rainy-days' });
    expect(standing(changed)).toEqual(standing(await read(lib, 'post', saved.id)));

    const down = await call<View>(site.unpublish, bm, { kind: 'post', id: saved.id });
    expect(down).toMatchObject({ status: 'DRAFT', isLive: false, changed: true, liveSlug: null, result: 'unpublish' });
    expect(standing(down)).toEqual(standing(await read(bm, 'post', saved.id)));
    expect(await call<View>(site.unpublish, bm, { kind: 'post', id: saved.id })).toMatchObject({ status: 'DRAFT', result: 'none' });

    // A single page: its first save makes it exist, publishing it clears "changed".
    const sections = await call<View>(site.save, editor, { kind: 'sections', draft: { faqs: [{ q: 'Can I pause my plan?', a: 'Yes, ask at your branch.' }] } });
    expect(sections).toMatchObject({ id: 'sections', exists: true, status: 'DRAFT', changed: true, previewToken: null, canPublish: true, canDelete: false });
    expect(standing(sections)).toEqual(standing(await read(editor, 'sections')));
    const sectionsLive = await call<View>(site.publish, editor, { kind: 'sections' });
    expect(sectionsLive).toMatchObject({ status: 'LIVE', changed: false, result: 'publish' });
    expect(standing(sectionsLive)).toEqual(standing(await read(editor, 'sections')));
    // An offer shows its dates' standing.
    const day = (offset: number) => new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    const offer = await call<View>(site.save, editor, { kind: 'promotion', draft: { title: 'Christmas', startOn: day(30), endOn: day(35) }, publish: true });
    expect(offer).toMatchObject({ status: 'UPCOMING', isLive: true, canDelete: true, result: 'publish' });
    expect(standing(offer)).toEqual(standing(await read(editor, 'promotion', offer.id)));
  });
});

describe('website: lists and Publish all', () => {
  it('lists posts with the few fields a row needs, to those who may edit them', async () => {
    const mine = await call<View>(site.save, lib, { kind: 'post', draft: post({ branch: { orgId: org, branchId: central }, sections: [{ heading: 'One', text: 'x'.repeat(3000) }] }) });
    await call(site.requestReview, lib, { id: mine.id });
    const theirs = await call<View>(site.save, editor, { kind: 'post', draft: post({ title: 'Head office news', slug: 'head-office-news', design: 'NOTICE' }), publish: true });
    await call(site.save, editor, { kind: 'post', id: theirs.id, draft: post({ title: 'Head office news, again', slug: 'head-office-news', design: 'NOTICE' }) });

    type Row = { id: string; title: string; status: string; slug: string; liveSlug: string | null; design: string; liveOn: string | null; by: string; mine: boolean; updatedBy: string; updatedAt: string };
    const list = async (who: TestUser) => (await call<{ items: Row[] }>(site.list, who, { kind: 'post' }, null)).items;
    const all = await list(editor);
    expect(all.map((p) => p.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(all.find((p) => p.id === theirs.id)).toMatchObject({
      title: 'Head office news, again', status: 'CHANGED', slug: 'head-office-news', liveSlug: 'head-office-news', design: 'NOTICE', liveOn: todayInIndia(), by: 'web', mine: true, updatedBy: 'web',
    });
    expect(all.find((p) => p.id === mine.id)).toMatchObject({ title: 'Ten books for rainy days', status: 'IN_REVIEW', design: 'BOOKLIST', liveSlug: null, liveOn: null, by: 'lib', mine: false });
    expect(all[0].updatedAt).toEqual(expect.any(String));
    // The writer sees their own; their branch's manager sees it too (not theirs to delete); the other branch's manager neither.
    expect((await list(lib)).map((p) => [p.id, p.mine])).toEqual([[mine.id, true]]);
    expect((await list(bm)).map((p) => [p.id, p.mine])).toEqual([[mine.id, false]]);
    expect(await list(otherBm)).toEqual([]);
  });

  it('lists testimonials, jobs and branch pages by name', async () => {
    await call(site.save, editor, { kind: 'testimonial', draft: { quote: 'My daughter reads a book a day now!', name: 'Meera S.' } });
    await call(site.save, editor, { kind: 'job', draft: { title: 'Librarian', location: 'Central' }, publish: true });
    await call(site.save, bm, { kind: 'branch', id: central, orgId: org, draft: { slug: 'central-library' }, publish: true });
    await call(site.save, bm, { kind: 'branch', id: central, orgId: org, draft: { slug: 'central-library', tagline: 'New' } });
    const list = async (kind: string, who = editor) => (await call<{ items: Record<string, unknown>[] }>(site.list, who, { kind }, null)).items;
    expect(await list('testimonial')).toMatchObject([{ title: 'Meera S.', status: 'DRAFT' }]);
    expect(await list('job')).toMatchObject([{ title: 'Librarian', status: 'LIVE' }]);
    expect(await list('branch')).toMatchObject([
      { id: central, title: 'Central', status: 'CHANGED', slug: 'central-library', liveSlug: 'central-library', updatedBy: 'bm' },
      { id: north, title: 'North', status: 'NONE', slug: null, liveSlug: null },
    ]);
    expect(await failure(call(site.list, bm, { kind: 'job' }, null))).toBe('FORBIDDEN');
  });

  it('Publish all holds back an item whose address another live item uses, and publishes the rest', async () => {
    const live = await call<View>(site.save, editor, { kind: 'post', draft: post(), publish: true });
    const clash = await call<View>(site.save, editor, { kind: 'post', draft: post({ title: 'A clash', slug: 'a-clash' }) });
    const fine = await call<View>(site.save, editor, { kind: 'post', draft: post({ title: 'All fine here', slug: 'fine' }) });
    // Saving refuses a taken address, so this can only come from two saves racing: set it up by hand.
    await db.doc(`sitePosts/${clash.id}`).update({ 'draft.slug': 'ten-books-for-rainy-days', slug: 'ten-books-for-rainy-days' });
    const r = await call<{ published: { id: string; result: string }[]; blocked: { id: string; title: string; reason: string }[] }>(site.publishAll, editor, {});
    expect(r.published).toEqual([{ kind: 'post', id: fine.id, result: 'publish' }]);
    expect(r.blocked).toEqual([{ kind: 'post', id: clash.id, title: 'A clash', reason: 'Its address is used by another item.' }]);
    expect(await postDoc(clash.id)).toMatchObject({ isLive: false, changed: true });
    expect(await postDoc(fine.id)).toMatchObject({ isLive: true, liveSlug: 'fine', live: { title: 'All fine here' } });
    expect(await postDoc(live.id)).toMatchObject({ isLive: true, liveSlug: 'ten-books-for-rainy-days' });
  });
});

describe('website: enquiries from the list', () => {
  const reply = () => {
    const r = { code: 0, body: undefined as unknown };
    const res = { status(n: number) { r.code = n; return res; }, set() { return res; }, json(b: unknown) { r.body = b; }, send(b?: unknown) { r.body = b; } };
    return { r, res };
  };
  const submit = async (body: Record<string, unknown>, ip: string) => {
    const { r, res } = reply();
    await handleSitePublic({ method: 'POST', path: '/api/submit', url: '/api/submit', body, headers: { 'x-forwarded-for': ip }, ip } as never, res as never);
    expect(r.code).toBe(200);
  };
  type Row = { id: string; name: string; handled: boolean; note?: string; resume: unknown; createdAt: string | null; handledAt: string | null };
  const list = async (who: TestUser, open: boolean) => (await call<{ items: Row[] }>(inbox.submissions, who, { open }, null)).items;

  it('lists what is still to follow up, reads one enquiry, and keeps the note when the list marks it', async () => {
    await submit({ form: 'MEMBERSHIP', name: 'Asha Rao', phone: '+91 72599 21508', branchId: central }, '203.0.113.7');
    await submit({ form: 'CONTACT', name: 'Ravi Kumar', phone: '9876543210', message: 'Do you deliver?' }, '203.0.113.8');
    const [asha, ravi] = await Promise.all(['Asha Rao', 'Ravi Kumar'].map(async (name) => (await db.collection('siteSubmissions').where('name', '==', name).get()).docs[0].id));

    // The open list: newest first, and only what each person may see.
    expect((await list(editor, true)).map((s) => s.name)).toEqual(['Ravi Kumar', 'Asha Rao']);
    expect((await list(bm, true)).map((s) => s.name)).toEqual(['Asha Rao']);
    expect(await list(otherBm, true)).toEqual([]);
    expect(await failure(call(inbox.submissions, lib, { open: true }, null))).toBe('FORBIDDEN');

    // One enquiry, for the page a notification opens.
    const one = await call<Row & { phone: string }>(inbox.submissionOne, bm, { id: asha }, null);
    expect(one).toMatchObject({ id: asha, name: 'Asha Rao', phone: '+91 72599 21508', handled: false, resume: null, handledAt: null });
    expect(one.createdAt).toEqual(expect.any(String));
    expect((await call<Row>(inbox.submissionOne, editor, { id: asha }, null)).name).toBe('Asha Rao');
    expect(await failure(call(inbox.submissionOne, otherBm, { id: asha }, null))).toBe('NOT_FOUND');
    expect(await failure(call(inbox.submissionOne, bm, { id: ravi }, null))).toBe('NOT_FOUND');
    expect(await failure(call(inbox.submissionOne, editor, { id: 'nosuchsubmission0000' }, null))).toBe('NOT_FOUND');
    expect(await failure(call(inbox.submissionOne, lib, { id: asha }, null))).toBe('FORBIDDEN');

    // The enquiry's page saves a note; the list's button sends none and must leave it alone.
    await call(inbox.markHandled, bm, { id: asha, handled: false, note: 'Call back on Monday' });
    await call(inbox.markHandled, bm, { id: asha, handled: true });
    expect((await db.doc(`siteSubmissions/${asha}`).get()).data()).toMatchObject({ handled: true, note: 'Call back on Monday', handledBy: { uid: bm.uid } });
    expect((await list(editor, true)).map((s) => s.name)).toEqual(['Ravi Kumar']);
    expect(await list(bm, true)).toEqual([]);
    expect((await list(bm, false)).map((s) => [s.name, s.handled])).toEqual([['Asha Rao', true]]);
    expect(await list(editor, false)).toHaveLength(2);
    // Undo from the list: open again, the note still there; a note that is sent replaces it (an empty one clears it).
    await call(inbox.markHandled, bm, { id: asha, handled: false });
    expect((await db.doc(`siteSubmissions/${asha}`).get()).data()).toMatchObject({ handled: false, handledBy: null, note: 'Call back on Monday' });
    await call(inbox.markHandled, bm, { id: asha, handled: true, note: 'Joined on Tuesday' });
    expect((await call<Row>(inbox.submissionOne, bm, { id: asha }, null)).note).toBe('Joined on Tuesday');
    await call(inbox.markHandled, bm, { id: asha, handled: true, note: '' });
    expect((await db.doc(`siteSubmissions/${asha}`).get()).get('note')).toBe('');
  });

  it('tells website managers how many people are on the enquiry alerts list', async () => {
    type Counts = { counts: { newSubmissions: number | null; callsThisWeek: number | null; openJobs: number | null; alertRecipients: number | null } };
    expect((await call<Counts>(site.overview, editor, {}, null)).counts).toEqual({ newSubmissions: 0, callsThisWeek: 0, openJobs: 0, alertRecipients: 0 });
    await call(inbox.saveConnections, editor, { alerts: [editor.email, sa.email], alertBranchManagers: true });
    expect((await call<Counts>(site.overview, editor, {}, null)).counts.alertRecipients).toBe(2);
    expect((await call<Counts>(site.overview, sa, {}, null)).counts.alertRecipients).toBe(2);
    // Branch managers and writers are not told.
    expect((await call<Counts>(site.overview, bm, {}, null)).counts).toEqual({ newSubmissions: 0, callsThisWeek: null, openJobs: null, alertRecipients: null });
    expect((await call<Counts>(site.overview, lib, {}, null)).counts).toEqual({ newSubmissions: null, callsThisWeek: null, openJobs: null, alertRecipients: null });
  });
});
