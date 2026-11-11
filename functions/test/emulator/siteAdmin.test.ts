import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import * as site from '../../src/site/admin.js';
import * as inbox from '../../src/site/inbox.js';
import { handleSitePublic } from '../../src/site/public.js';
import { todayInIndia } from '../../src/site/content.js';
import { readLiveSite } from '../../src/site/live.js';
import { fill, resolvePage, sitemapXml } from '../../src/site/pages.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, editor: TestUser, bm: TestUser, lib: TestUser, otherBm: TestUser;
let org: string, central: string, north: string;

const post = (over: Record<string, unknown> = {}) => ({
  title: 'Ten books for rainy days', slug: 'ten-books-for-rainy-days', summary: 'Cosy reads.', design: 'BOOKLIST',
  intro: 'When it pours, **read**.\n\n- Tea\n- A blanket', ...over,
});
const day = (offset: number) => new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [editor, bm, lib, otherBm] = await Promise.all(['web@stories.test', 'bm@stories.test', 'lib@stories.test', 'bm2@stories.test'].map((e) => createUser(e)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories for All', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact: { phone: '7259921508' }, operatingHours: [{ day: 'MON', open: '10:00', close: '19:00' }] })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: editor.email, roles: ['WEBSITE_EDITOR'], branchIds: ['*'] });
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['SENIOR_LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: otherBm.email, roles: ['SENIOR_LIBRARIAN'], branchIds: [north] });
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
});

describe('website: blog posts', () => {
  it('librarians write and send for review; branch managers publish posts about their branch', async () => {
    const { id } = await call<{ id: string }>(site.save, lib, { kind: 'post', draft: post({ branch: { orgId: org, branchId: central } }) });
    expect(await failure(call(site.publish, lib, { kind: 'post', id }))).toBe('FORBIDDEN');
    await call(site.requestReview, lib, { id });
    // The other branch's manager can't see or publish it; this branch's manager can.
    expect((await call<{ reviews: unknown[] }>(site.overview, otherBm, {}, null)).reviews).toHaveLength(0);
    expect((await call<{ reviews: { id: string }[] }>(site.overview, bm, {}, null)).reviews.map((r) => r.id)).toEqual([id]);
    expect(await failure(call(site.publish, otherBm, { kind: 'post', id }))).toBe('FORBIDDEN');
    await call(site.publish, bm, { kind: 'post', id });
    const doc = (await db.doc(`sitePosts/${id}`).get()).data()!;
    expect(doc).toMatchObject({ isLive: true, changed: false, review: null, liveSlug: 'ten-books-for-rainy-days', liveOn: todayInIndia(), liveBranchId: central });
    // Edits wait for the next publish.
    await call(site.save, lib, { kind: 'post', id, draft: post({ title: 'Twelve books for rainy days', branch: { orgId: org, branchId: central } }) });
    expect((await db.doc(`sitePosts/${id}`).get()).get('live.title')).toBe('Ten books for rainy days');
    expect((await call<{ status: string }>(site.get, lib, { kind: 'post', id }, null)).status).toBe('CHANGED');
    // A librarian can't tie a post to a branch they don't work at, or delete a published post.
    expect(await failure(call(site.save, lib, { kind: 'post', draft: post({ slug: 'north-news', branch: { orgId: org, branchId: north } }) }))).toBe('FORBIDDEN');
    expect(await failure(call(site.remove, lib, { kind: 'post', id }))).toBe('FORBIDDEN');
  });

  it('keeps addresses unique and checks what goes in', async () => {
    await call(site.save, editor, { kind: 'post', draft: post() });
    expect(await failure(call(site.save, editor, { kind: 'post', draft: post({ title: 'Another' }) }))).toBe('SLUG_TAKEN');
    expect(await failure(call(site.save, editor, { kind: 'post', draft: post({ slug: 'x2', cover: { url: 'https://evil.example/a.jpg', alt: '' } }) }))).toBe('INVALID_INPUT');
    expect(await failure(call(site.save, editor, { kind: 'post', draft: post({ slug: 'x3', cta: { label: 'Go', url: 'javascript:alert(1)' } }) }))).toBe('INVALID_INPUT');
    expect(await failure(call(site.save, editor, { kind: 'promotion', draft: { title: 'Diwali', startOn: day(3), endOn: day(1) } }))).toBe('INVALID_INPUT');
  });

  it('renders published posts with their design, the blog list, previews and the sitemap', async () => {
    const book = await db.collection('books').add({ title: 'Malgudi Days', authorNames: ['R. K. Narayan'], status: 'ACTIVE', coverUrl: null });
    const { id } = await call<{ id: string }>(site.save, editor, { kind: 'post', draft: post({ books: [{ bookId: book.id, note: 'Short stories for a rainy afternoon.' }], tags: ['rainy days'] }) });
    const doc = (await db.doc(`sitePosts/${id}`).get()).data()!;
    // Not published yet: only the preview link shows it.
    expect((await resolvePage('/blog/ten-books-for-rainy-days', new URLSearchParams())).status).toBe(404);
    expect((await resolvePage(`/preview/post/${id}`, new URLSearchParams({ t: 'wrong-token-wrong-token' }))).status).toBe(404);
    const preview = await resolvePage(`/preview/post/${id}`, new URLSearchParams({ t: doc.previewToken }));
    expect(preview).toMatchObject({ status: 200, private: true });
    expect(preview.main).toContain('Preview of the saved draft');

    await call(site.publish, editor, { kind: 'post', id });
    const page = await resolvePage('/blog/ten-books-for-rainy-days', new URLSearchParams());
    expect(page.status).toBe(200);
    expect(page.main).toContain('class="post post-booklist"');
    expect(page.main).toContain('Malgudi Days');
    expect(page.main).toContain('href="/account/explore?q=Malgudi%20Days"');
    expect(page.main).toContain('<strong>read</strong>');
    expect(page.main).toContain('<ul><li>Tea</li><li>A blanket</li></ul>');
    const html = fill('<head><!--ssr:head--></head><main><!--ssr:main--></main>', page);
    expect(html).toContain('<title>Ten books for rainy days · Stories for All</title>');
    expect(html).toContain('<link rel="canonical" href="https://storiesforall.in/blog/ten-books-for-rainy-days" />');
    expect(html).toContain('"@type":"BlogPosting"');
    expect((await resolvePage('/blog', new URLSearchParams())).main).toContain('href="/blog/ten-books-for-rainy-days"');
    expect((await resolvePage('/blog', new URLSearchParams({ tag: 'rainy days' }))).main).toContain('Ten books for rainy days');
    expect(await sitemapXml()).toContain('<loc>https://storiesforall.in/blog/ten-books-for-rainy-days</loc>');
    expect((await readLiveSite()).posts.map((p) => p.slug)).toEqual(['ten-books-for-rainy-days']);

    // Hidden, then published: off the website.
    await call(site.save, editor, { kind: 'post', id, draft: post({ hidden: true }) });
    expect((await call<{ result: string }>(site.publish, editor, { kind: 'post', id })).result).toBe('unpublish');
    expect((await resolvePage('/blog/ten-books-for-rainy-days', new URLSearchParams())).status).toBe(404);
  });
});

describe('website: branch pages', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    slug: 'central', tagline: 'Your neighbourhood library', intro: 'Two floors of books.', amenities: ['WIFI', 'KIDS_CORNER'],
    librarian: { name: 'Priya Rao', title: 'Head librarian', bio: 'Loves picture books.', since: 2026, languages: ['Kannada', 'English'], favourites: ['Matilda'] },
    notices: [{ text: 'Closed for Diwali', from: day(2), to: day(3), closed: true }, { text: 'Old notice', from: day(-9), to: day(-8) }],
    ...over,
  });

  it('branch managers edit and publish only their branches', async () => {
    expect(await failure(call(site.save, otherBm, { kind: 'branch', id: central, orgId: org, draft: page() }))).toBe('FORBIDDEN');
    await call(site.save, bm, { kind: 'branch', id: central, orgId: org, draft: page() });
    expect((await call<{ items: { id: string }[] }>(site.list, bm, { kind: 'branch' }, null)).items.map((i) => i.id)).toEqual([central]);
    expect((await call<{ items: unknown[] }>(site.list, editor, { kind: 'branch' }, null)).items).toHaveLength(2);
    expect(await failure(call(site.publish, lib, { kind: 'branch', id: central }))).toBe('FORBIDDEN');
    await call(site.publish, bm, { kind: 'branch', id: central });
    // Another branch can't take the same address.
    expect(await failure(call(site.save, editor, { kind: 'branch', id: north, orgId: org, draft: page() }))).toBe('SLUG_TAKEN');

    const p = await resolvePage('/branches/central', new URLSearchParams());
    expect(p.status).toBe(200);
    expect(p.main).toContain('Meet Priya Rao');
    expect(p.main).toContain('Closed · ');
    expect(p.main).not.toContain('Old notice');
    expect(p.main).toContain("Children's corner".replace("'", '&#39;'));
    expect(p.main).toContain('href="https://wa.me/917259921508?text=');
    expect(JSON.stringify(p.jsonLd)).toContain('"@type":"Library"');
    expect((await readLiveSite()).branchPages[central]).toMatchObject({ slug: 'central', tagline: 'Your neighbourhood library' });
  });
});

describe('website: promotions, settings, publish all', () => {
  it('only the website team runs promotions; the website shows those running today', async () => {
    expect(await failure(call(site.save, bm, { kind: 'promotion', draft: { title: 'Diwali offer', startOn: day(0), endOn: day(5) } }))).toBe('FORBIDDEN');
    const running = (await call<{ id: string }>(site.save, editor, { kind: 'promotion', draft: { title: 'Diwali offer', message: 'One month free', code: 'diwali25', startOn: day(0), endOn: day(5), placement: 'BAR' } })).id;
    const later = (await call<{ id: string }>(site.save, editor, { kind: 'promotion', draft: { title: 'Christmas', startOn: day(30), endOn: day(35) } })).id;
    await call(site.publish, editor, { kind: 'promotion', id: running });
    await call(site.publish, editor, { kind: 'promotion', id: later });
    const live = await readLiveSite();
    expect(live.promotions.map((p) => [p.title, p.code])).toEqual([['Diwali offer', 'DIWALI25']]);
    const items = (await call<{ items: { id: string; status: string }[] }>(site.list, editor, { kind: 'promotion' }, null)).items;
    expect(Object.fromEntries(items.map((i) => [i.id, i.status]))).toEqual({ [running]: 'LIVE', [later]: 'UPCOMING' });
  });

  it('publishes every change at once, and can go back to what is live', async () => {
    await call(site.save, editor, { kind: 'sections', draft: { faqs: [{ q: 'Can I pause my plan?', a: 'Yes, ask at your branch.' }] } });
    await call(site.save, editor, { kind: 'greetings', draft: { autoOpen: false } });
    await call(site.save, bm, { kind: 'branch', id: central, orgId: org, draft: { slug: 'central' } });
    const pending = (await call<{ pending: { kind: string }[] }>(site.overview, editor, {}, null)).pending.map((p) => p.kind).sort();
    expect(pending).toEqual(['branch', 'greetings', 'sections']);
    // A branch manager may only publish their own part.
    const mine = await call<{ published: { kind: string }[] }>(site.publishAll, bm, {});
    expect(mine.published.map((p) => p.kind)).toEqual(['branch']);
    const rest = await call<{ published: { kind: string }[] }>(site.publishAll, editor, {});
    expect(rest.published.map((p) => p.kind).sort()).toEqual(['greetings', 'sections']);
    const live = await readLiveSite();
    expect(live.faqs).toEqual([{ q: 'Can I pause my plan?', a: 'Yes, ask at your branch.' }]);
    expect(live.greetings).toMatchObject({ enabled: true, autoOpen: false });

    await call(site.save, editor, { kind: 'sections', draft: { faqs: [] } });
    await call(site.discard, editor, { kind: 'sections' });
    expect((await call<{ draft: { faqs: unknown[] }; changed: boolean }>(site.get, editor, { kind: 'sections' }, null)).draft.faqs).toHaveLength(1);
    // Everyone else is kept out.
    expect(await failure(call(site.save, lib, { kind: 'settings', draft: {} }))).toBe('FORBIDDEN');
    expect(await failure(call(site.overview, await createUser('member@stories.test'), {}, null))).toBe('FORBIDDEN');
  });
});

describe('website: enquiries, calls, jobs, testimonials, sections', () => {
  const reply = () => {
    const r = { code: 0, body: undefined as unknown };
    const res = { status(n: number) { r.code = n; return res; }, set() { return res; }, json(b: unknown) { r.body = b; }, send(b?: unknown) { r.body = b; } };
    return { r, res };
  };
  const post = (path: string, body: unknown, ip = '203.0.113.7') => ({ method: 'POST', path, url: path, body, headers: { 'x-forwarded-for': ip }, ip } as never);

  it('saves enquiries from the website, alerts the branch managers, and shows them to the right people', async () => {
    const { r, res } = reply();
    await handleSitePublic(post('/api/submit', { form: 'MEMBERSHIP', name: 'Asha Rao', phone: '+91 72599 21508', branchId: central, readers: 'Children', page: '/branches/central' }), res as never);
    expect(r).toMatchObject({ code: 200, body: { ok: true } });
    // A robot (hidden field filled) is thanked, and nothing is kept.
    const bot = reply();
    await handleSitePublic(post('/api/submit', { form: 'CONTACT', name: 'Spam Bot', phone: '9999999999', website: 'http://spam' }), bot.res as never);
    expect(bot.r.code).toBe(200);
    const bad = reply();
    await handleSitePublic(post('/api/submit', { form: 'CONTACT', name: 'A', phone: '12' }), bad.res as never);
    expect(bad.r.code).toBe(400);

    const all = await db.collection('siteSubmissions').get();
    expect(all.docs.map((d) => d.get('name'))).toEqual(['Asha Rao']);
    expect(all.docs[0].data()).toMatchObject({ form: 'MEMBERSHIP', branchId: central, branchName: 'Central', orgId: org, handled: false });
    const alerted = await db.collection(`users/${bm.uid}/notifications`).get();
    expect(alerted.docs.map((d) => d.get('title'))).toEqual(['Membership enquiry from Asha Rao']);
    expect((await db.collection(`users/${otherBm.uid}/notifications`).get()).size).toBe(0);

    expect((await call<{ items: unknown[] }>(inbox.submissions, editor, {}, null)).items).toHaveLength(1);
    expect((await call<{ items: unknown[] }>(inbox.submissions, bm, {}, null)).items).toHaveLength(1);
    expect((await call<{ items: unknown[] }>(inbox.submissions, otherBm, {}, null)).items).toHaveLength(0);
    expect(await failure(call(inbox.submissions, lib, {}, null))).toBe('FORBIDDEN');
    // The branch's managers count it among what waits for them; other branches' managers don't.
    expect((await call<{ counts: { newSubmissions: number } }>(site.overview, bm, {}, null)).counts.newSubmissions).toBe(1);
    expect((await call<{ counts: { newSubmissions: number } }>(site.overview, otherBm, {}, null)).counts.newSubmissions).toBe(0);
    await call(inbox.markHandled, bm, { id: all.docs[0].id, handled: true });
    expect((await call<{ counts: { newSubmissions: number } }>(site.overview, editor, {}, null)).counts.newSubmissions).toBe(0);
  });

  it('keeps job applications with their CV private, and lists the jobs on Careers', async () => {
    const { id: jobId } = await call<{ id: string }>(site.save, editor, { kind: 'job', draft: { title: 'Librarian', location: 'Stories Central', overview: 'Help readers find books.', responsibilities: ['Run storytime'] } });
    await call(site.publish, editor, { kind: 'job', id: jobId });
    const page = await resolvePage('/careers', new URLSearchParams());
    expect(page.main).toContain('Librarian');
    expect(page.main).toContain(`<option value="${jobId}">Librarian</option>`);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]).toString('base64');
    const { r, res } = reply();
    await handleSitePublic(post('/api/submit', { form: 'JOB', name: 'Ravi Kumar', phone: '9876543210', jobId, resume: { name: 'ravi.pdf', data: pdf } }), res as never);
    expect(r.code).toBe(200);
    const sub = (await db.collection('siteSubmissions').where('form', '==', 'JOB').get()).docs[0];
    expect(sub.get('jobTitle')).toBe('Librarian');
    const cv = await call<{ name: string; data: string }>(inbox.resumeFile, editor, { id: sub.id }, null);
    expect(cv.name).toBe('ravi.pdf');
    expect(Buffer.from(cv.data, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    // Not a branch's enquiry: branch managers don't see it.
    expect(await failure(call(inbox.resumeFile, bm, { id: sub.id }, null))).toBe('NOT_FOUND');
    const notPdf = reply();
    await handleSitePublic(post('/api/submit', { form: 'JOB', name: 'Ravi Kumar', phone: '9876543210', resume: { name: 'x.exe', data: Buffer.from('MZ....').toString('base64') } }, '198.51.100.1'), notPdf.res as never);
    expect(notPdf.r.code).toBe(400);
  });

  it('counts taps on call and WhatsApp buttons, without keeping who tapped', async () => {
    for (const channel of ['phone', 'whatsapp', 'phone']) {
      const { res } = reply();
      await handleSitePublic(post('/api/tap', JSON.stringify({ channel, number: '+91 72599 21508', branch: 'Central', page: '/branches/central', place: 'Visit us', device: 'Phone', visit: 'abc123def' })), res as never);
    }
    const { items } = await call<{ items: { channel: string; number: string }[] }>(inbox.calls, editor, { days: 7 }, null);
    expect(items.map((i) => i.channel).sort()).toEqual(['phone', 'phone', 'whatsapp']);
    expect(items[0].number).toBe('917259921508');
    expect(JSON.stringify(items)).not.toContain('203.0.113.7');
    expect(await failure(call(inbox.calls, bm, { days: 7 }, null))).toBe('FORBIDDEN');
  });

  it('publishes testimonials, page sections and contact details to the website', async () => {
    const { id: t } = await call<{ id: string }>(site.save, editor, { kind: 'testimonial', draft: { quote: 'My daughter reads a book a day now!', name: 'Meera S.', detail: 'Member since 2026' } });
    await call(site.publish, editor, { kind: 'testimonial', id: t });
    await call(site.save, editor, { kind: 'sections', draft: { promises: [{ title: 'No due dates', text: 'Keep it while you read.' }], faqs: [{ q: 'Can I pause my plan?', a: 'Yes, at your branch.' }] } });
    await call(site.publish, editor, { kind: 'sections' });
    await call(site.save, editor, { kind: 'settings', draft: { contact: { email: 'hello@storiesforall.in' }, banner: { heading: 'Every book begins a', highlight: 'new story.' } } });
    await call(site.publish, editor, { kind: 'settings' });
    const live = await readLiveSite();
    expect(live.testimonials).toEqual([{ quote: 'My daughter reads a book a day now!', name: 'Meera S.', detail: 'Member since 2026' }]);
    expect(live.sections.promises).toHaveLength(1);
    expect(live.faqs).toEqual([{ q: 'Can I pause my plan?', a: 'Yes, at your branch.' }]);
    expect(live.contact.email).toBe('hello@storiesforall.in');
    expect(live.banner.highlight).toBe('new story.');
  });

  it('lists who can change the website, and who hears about enquiries', async () => {
    const { people } = await call<{ people: { email: string; level: string }[] }>(inbox.admins, editor, {}, null);
    expect(Object.fromEntries(people.map((p) => [p.email, p.level]))).toMatchObject({
      'sa@stories.test': 'MANAGER', 'web@stories.test': 'MANAGER', 'bm@stories.test': 'BRANCH', 'lib@stories.test': 'WRITER',
    });
    await call(inbox.saveConnections, editor, { alerts: ['WEB@stories.test'], alertBranchManagers: false });
    expect((await call<{ alerts: string[]; alertBranchManagers: boolean }>(inbox.connections, editor, {}, null))).toMatchObject({ alerts: ['web@stories.test'], alertBranchManagers: false });
    expect(await failure(call(inbox.saveConnections, editor, { alerts: ['nobody@stories.test'], alertBranchManagers: true }))).toBe('USER_NOT_FOUND');
  });
});

describe('website: every single page opens before anything is saved', () => {
  it('gives a blank draft for site settings, page sections and festival greetings', async () => {
    for (const kind of ['settings', 'sections', 'greetings']) {
      const item = await call<{ draft: unknown; exists: boolean }>(site.get, editor, { kind }, null);
      expect(item.exists, kind).toBe(false);
      expect(item.draft, kind).toBeTruthy();
    }
  });
});
