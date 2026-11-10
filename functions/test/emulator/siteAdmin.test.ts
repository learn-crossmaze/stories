import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import * as site from '../../src/site/admin.js';
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
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['BRANCH_MANAGER'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: otherBm.email, roles: ['BRANCH_MANAGER'], branchIds: [north] });
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
    await call(site.save, editor, { kind: 'settings', draft: { faqs: [{ q: 'Can I pause my plan?', a: 'Yes, ask at your branch.' }] } });
    await call(site.save, editor, { kind: 'greetings', draft: { autoOpen: false } });
    await call(site.save, bm, { kind: 'branch', id: central, orgId: org, draft: { slug: 'central' } });
    const pending = (await call<{ pending: { kind: string }[] }>(site.overview, editor, {}, null)).pending.map((p) => p.kind).sort();
    expect(pending).toEqual(['branch', 'greetings', 'settings']);
    // A branch manager may only publish their own part.
    const mine = await call<{ published: { kind: string }[] }>(site.publishAll, bm, {});
    expect(mine.published.map((p) => p.kind)).toEqual(['branch']);
    const rest = await call<{ published: { kind: string }[] }>(site.publishAll, editor, {});
    expect(rest.published.map((p) => p.kind).sort()).toEqual(['greetings', 'settings']);
    const live = await readLiveSite();
    expect(live.faqs).toEqual([{ q: 'Can I pause my plan?', a: 'Yes, ask at your branch.' }]);
    expect(live.greetings).toMatchObject({ enabled: true, autoOpen: false });

    await call(site.save, editor, { kind: 'settings', draft: { faqs: [] } });
    await call(site.discard, editor, { kind: 'settings' });
    expect((await call<{ draft: { faqs: unknown[] }; changed: boolean }>(site.get, editor, { kind: 'settings' }, null)).draft.faqs).toHaveLength(1);
    // Everyone else is kept out.
    expect(await failure(call(site.save, lib, { kind: 'settings', draft: {} }))).toBe('FORBIDDEN');
    expect(await failure(call(site.overview, await createUser('member@stories.test'), {}, null))).toBe('FORBIDDEN');
  });
});
