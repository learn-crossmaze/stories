// The website's server-rendered pages: /blog, /blog/<slug>, /branches/<slug>, /about, and private previews
// (/preview/post/<id>?t=…, /preview/branch/<id>?t=…). Each is the site's own page template
// (apps/site/_t/page.html, built and deployed with the site, so it has the current header, footer, styles and
// scripts) with the content filled in, so search engines read the whole page without running scripts.
import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';

import { db } from '../core/firebase.js';
import type { BranchDraft, JobDraft, PostDraft, SectionsDraft, SettingsDraft } from './content.js';
import { sectionsDraft, settingsDraft, todayInIndia } from './content.js';
import type { SiteDoc } from './admin.js';
import { booksById, cardOf, livePosts } from './live.js';
import { toPublicBranch } from './public.js';
import { aboutHtml, blogIndexHtml, branchHtml, branchJsonLd, careersHtml, esc, notFoundHtml, plain, postHtml, type PostView } from './render.js';

/** The website's addresses: the template is fetched from the one the visitor is on (others fall back to the first). */
const SITE_HOSTS = ['storiesforall.in', 'www.storiesforall.in', 'storiesforall-website.web.app', 'storiesforall-website.firebaseapp.com'];
export const CANONICAL = 'https://storiesforall.in';

interface Page {
  status: number;
  title: string;
  description: string;
  /** Path on the site, for the canonical address. */
  path: string;
  main: string;
  image?: string | null;
  jsonLd?: unknown;
  /** Private previews and missing pages stay out of search results and caches. */
  private?: boolean;
}

type Res = { status: (n: number) => Res; set: (k: string, v: string) => Res; send: (b?: unknown) => void };

let cached: { origin: string; html: string; at: number } | null = null;
const TEMPLATE_TTL_MS = 5 * 60_000;

/** The deployed site's page template, cached for 5 minutes per instance. */
export async function template(origin: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (cached && cached.origin === origin && Date.now() - cached.at < TEMPLATE_TTL_MS) return cached.html;
  const res = await fetcher(`${origin}/_t/page.html`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`template answered ${res.status}`);
  const html = await res.text();
  if (!html.includes('<!--ssr:main-->')) throw new Error('template has no <!--ssr:main--> slot');
  cached = { origin, html, at: Date.now() };
  return html;
}
export const resetTemplateCache = () => (cached = null);

export function originOf(req: Pick<Request, 'headers'>) {
  if (process.env.SITE_TEMPLATE_ORIGIN) return process.env.SITE_TEMPLATE_ORIGIN;
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().toLowerCase();
  return `https://${SITE_HOSTS.includes(host) ? host : SITE_HOSTS[2]}`;
}

/** Fills the template: the head (title, description, canonical, social cards, structured data) and the main. */
export function fill(html: string, page: Page) {
  const url = `${CANONICAL}${page.path}`;
  const title = page.title.includes('Stories for All') ? page.title : `${page.title} · Stories for All`;
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    page.private ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    page.image ? `<meta property="og:image" content="${esc(page.image)}" />` : '',
    page.jsonLd ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  return html.replace('<!--ssr:head-->', head).replace('<!--ssr:main-->', page.main);
}

// ------------------------------------------------------------------ pages

async function postView(doc: SiteDoc, draft: PostDraft): Promise<PostView> {
  const books = await booksById(draft.books.map((b) => b.bookId));
  let branch: PostView['branch'] = null;
  if (draft.branch) {
    const [b, page] = await Promise.all([db.doc(`orgs/${draft.branch.orgId}/branches/${draft.branch.branchId}`).get(), db.doc(`siteBranches/${draft.branch.branchId}`).get()]);
    if (b.exists) branch = { name: String(b.get('name') ?? ''), slug: page.get('isLive') ? (page.get('liveSlug') as string) : null };
  }
  return {
    draft,
    slug: draft.slug,
    date: doc.liveOn ?? null,
    books: draft.books.flatMap((x) => (books.has(x.bookId) ? [{ book: books.get(x.bookId)!, note: x.note }] : [])),
    branch,
  };
}

async function postPage(doc: SiteDoc, draft: PostDraft, preview: boolean): Promise<Page> {
  const view = await postView(doc, draft);
  const path = `/blog/${draft.slug}`;
  const related = preview ? [] : (await livePosts(4)).filter((p) => p.liveSlug !== draft.slug).slice(0, 3).map(cardOf);
  return {
    status: 200,
    title: draft.title,
    description: draft.summary || plain(draft.intro) || 'From the Stories for All blog.',
    path,
    main: postHtml(view, `${CANONICAL}${path}`, related),
    image: draft.cover?.url ?? null,
    private: preview,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: draft.title,
      description: draft.summary || plain(draft.intro),
      datePublished: view.date ?? undefined,
      image: draft.cover?.url,
      author: draft.author.name ? { '@type': 'Person', name: draft.author.name } : { '@type': 'Organization', name: 'Stories for All' },
      publisher: { '@type': 'Organization', name: 'Stories for All', logo: { '@type': 'ImageObject', url: `${CANONICAL}/icon-512.png` } },
      mainEntityOfPage: `${CANONICAL}${path}`,
    },
  };
}

async function branchPage(doc: SiteDoc, draft: BranchDraft, preview: boolean): Promise<Page | null> {
  if (!doc.orgId || !doc.branchId) return null;
  const snap = await db.doc(`orgs/${doc.orgId}/branches/${doc.branchId}`).get();
  if (!snap.exists || snap.get('status') !== 'ACTIVE') return null;
  const branch = toPublicBranch(snap, doc.orgId);
  const [books, posts] = await Promise.all([
    booksById(draft.picks.map((p) => p.bookId)),
    db.collection('sitePosts').where('liveBranchId', '==', doc.branchId).limit(12).get(),
  ]);
  const path = `/branches/${draft.slug}`;
  return {
    status: 200,
    title: `${branch.name}, ${branch.address.city} · library`,
    description: plain(draft.tagline || draft.intro, 155) || `${branch.name}: a Stories library in ${branch.address.city}. Opening hours, address, our librarian and what’s on.`,
    path,
    image: draft.photos[0]?.url ?? null,
    private: preview,
    jsonLd: branchJsonLd(branch, draft, `${CANONICAL}${path}`),
    main: branchHtml({
      branch,
      page: draft,
      picks: draft.picks.flatMap((p) => (books.has(p.bookId) ? [{ book: books.get(p.bookId)!, note: p.note }] : [])),
      posts: posts.docs
        .map((d) => d.data() as SiteDoc)
        .filter((d) => d.isLive)
        .sort((a, b) => String(b.liveOn).localeCompare(String(a.liveOn)))
        .slice(0, 3)
        .map(cardOf),
      today: todayInIndia(),
    }),
  };
}

const missing = (what: string, path: string): Page => ({ status: 404, title: 'Not found', description: 'This page is not on the website.', path, main: notFoundHtml(what), private: true });

/** Which page a path is, and its content. */
export async function resolvePage(path: string, search: URLSearchParams): Promise<Page> {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;

  if (first === 'preview' && (second === 'post' || second === 'branch') && third && parts.length === 3) {
    const snap = await db.doc(`${second === 'post' ? 'sitePosts' : 'siteBranches'}/${third}`).get();
    const doc = snap.exists ? (snap.data() as SiteDoc) : null;
    const token = search.get('t') ?? '';
    if (!doc || !doc.previewToken || token.length < 20 || token !== doc.previewToken) return missing('preview', path);
    const page = second === 'post' ? await postPage(doc, doc.draft as unknown as PostDraft, true) : await branchPage(doc, doc.draft as unknown as BranchDraft, true);
    if (!page) return missing('preview', path);
    return { ...page, title: `Preview: ${page.title}`, main: `<p class="preview-banner" role="status">Preview of the saved draft. Only people with this link can see it; it isn’t on the website until it is published.</p>${page.main}` };
  }

  if (first === 'blog' && parts.length === 1) {
    const tag = (search.get('tag') ?? '').toLowerCase().slice(0, 30) || null;
    const all = (await livePosts(120)).map(cardOf);
    const tags = [...new Set(all.flatMap((c) => c.tags))].sort();
    const cards = tag ? all.filter((c) => c.tags.includes(tag)) : all;
    return {
      status: 200,
      title: tag ? `Blog: ${tag}` : 'Blog',
      description: 'Book lists, reading tips, library news and notes from the Stories for All librarians.',
      path: tag ? `/blog?tag=${encodeURIComponent(tag)}` : '/blog',
      main: blogIndexHtml(cards, tags, tag),
    };
  }

  if (first === 'blog' && second && parts.length === 2) {
    const snap = await db.collection('sitePosts').where('liveSlug', '==', second).limit(1).get();
    const doc = snap.docs[0]?.data() as SiteDoc | undefined;
    if (!doc?.isLive || !doc.live) return missing('post', path);
    return postPage(doc, doc.live as unknown as PostDraft, false);
  }

  if (first === 'branches' && second && parts.length === 2) {
    const snap = await db.collection('siteBranches').where('liveSlug', '==', second).limit(1).get();
    const doc = snap.docs[0]?.data() as SiteDoc | undefined;
    if (!doc?.isLive || !doc.live) return missing('branch', path);
    return (await branchPage(doc, doc.live as unknown as BranchDraft, false)) ?? missing('branch', path);
  }

  if (first === 'about' && parts.length === 1) {
    const s = (await db.doc('siteContent/settings').get()).get('live') as SettingsDraft | null | undefined;
    const settings = s ?? settingsDraft.parse({});
    return {
      status: 200,
      title: 'About us',
      description: settings.about.intro || 'Stories for All is a subscription library for children, teens and grown-ups, with branches and home delivery.',
      path: '/about',
      main: aboutHtml(settings),
      image: settings.about.photos[0]?.url ?? null,
    };
  }

  if (first === 'careers' && parts.length === 1) {
    const [jobs, sections, settings] = await Promise.all([
      db.collection('siteJobs').where('isLive', '==', true).get(),
      db.doc('siteContent/sections').get(),
      db.doc('siteContent/settings').get(),
    ]);
    const open = jobs.docs.map((d) => ({ id: d.id, job: d.get('live') as JobDraft })).filter((j) => j.job && !j.job.hidden).sort((a, b) => a.job.title.localeCompare(b.job.title));
    const perks = ((sections.get('live') as SectionsDraft | undefined) ?? sectionsDraft.parse({})).careerPerks;
    const email = ((settings.get('live') as SettingsDraft | undefined) ?? settingsDraft.parse({})).contact.careersEmail;
    return {
      status: 200,
      title: 'Careers',
      description: open.length ? `Join Stories for All: ${open.map((j) => j.job.title).join(', ')}.` : 'Work with books and readers at Stories for All. Send us your CV.',
      path: '/careers',
      main: careersHtml(open, perks, email),
    };
  }

  return missing('page', path);
}

/** The website's static pages (apps/site) and every published post and branch page. */
export const STATIC_PAGES = ['/', '/books', '/plans', '/branches', '/how-it-works', '/blog', '/about', '/careers', '/franchise', '/contact'];

export async function sitemapXml() {
  const [posts, branches] = await Promise.all([livePosts(500), db.collection('siteBranches').where('isLive', '==', true).get()]);
  const urls = [
    ...STATIC_PAGES.map((p) => ({ loc: `${CANONICAL}${p === '/' ? '/' : p}`, lastmod: null as string | null })),
    ...branches.docs.map((d) => ({ loc: `${CANONICAL}/branches/${d.get('liveSlug') as string}`, lastmod: null })),
    ...posts.map((p) => ({ loc: `${CANONICAL}/blog/${p.liveSlug}`, lastmod: p.liveOn ?? null })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`;
}

/** GET for the server-rendered pages (Hosting rewrites them here). */
export async function handleSitePages(req: Request, res: Res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET').send('method not allowed');
  const url = new URL(req.originalUrl || req.url, 'https://storiesforall.in');
  try {
    if (url.pathname === '/sitemap.xml') {
      res.status(200).set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=300, s-maxage=3600');
      return res.send(await sitemapXml());
    }
    const [page, html] = await Promise.all([resolvePage(url.pathname, url.searchParams), template(originOf(req))]);
    res
      .status(page.status)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', page.private ? 'private, no-store' : 'public, max-age=60, s-maxage=300')
      .set('X-Robots-Tag', page.private ? 'noindex' : 'all');
    res.send(fill(html, page));
  } catch (e) {
    logger.error('site: page failed', { path: url.pathname, error: e instanceof Error ? e.message : String(e) });
    res.status(503).set('Cache-Control', 'no-store').set('Content-Type', 'text/html; charset=utf-8').send('<!doctype html><title>Stories for All</title><p>This page is unavailable just now. Please try again in a minute.</p>');
  }
}
