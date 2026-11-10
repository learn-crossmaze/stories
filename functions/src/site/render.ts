// HTML for the website's server-rendered pages (blog, branch pages, About), injected into the site's own page
// template (apps/site/_t/page.html) by pages.ts. Pure functions: every value from the data is escaped here.
import type { BranchDraft, PostDraft, SettingsDraft, SiteImage } from './content.js';
import type { PublicBranch } from './public.js';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A link target allowed in text: a page of the site, https, mailto or tel. Anything else is dropped. */
export const safeHref = (url: string) => (/^\/(?!\/)/.test(url) || /^https:\/\//.test(url) || /^mailto:/.test(url) || /^tel:/.test(url) ? url : null);

/** **bold**, _italic_ and [text](link), on already-escaped text. */
function inline(escaped: string) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
      const url = safeHref(href.replace(/&amp;/g, '&'));
      if (!url) return text;
      const external = url.startsWith('https://');
      return `<a href="${esc(url)}"${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
    });
}

/** Editor text → paragraphs and bullet lists. Blank lines separate paragraphs; lines starting "- " are bullets. */
export function richText(text: string | null | undefined): string {
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  return blocks
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim());
      if (lines.every((l) => /^[-•*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(esc(l.replace(/^[-•*]\s+/, '')))}</li>`).join('')}</ul>`;
      return `<p>${lines.map((l) => inline(esc(l))).join('<br />')}</p>`;
    })
    .join('');
}

/** Plain words of editor text (for meta descriptions and summaries). */
export const plain = (text: string | null | undefined, max = 160) => {
  const s = String(text ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
};

const img = (i: SiteImage | null | undefined, cls = '', eager = false, sizes = '') =>
  i ? `<img class="${cls}" src="${esc(i.url)}" alt="${esc(i.alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${sizes} />` : '';
const figure = (i: SiteImage | null | undefined, cls = 'figure') => (i ? `<figure class="${cls}">${img(i)}${i.alt ? `<figcaption>${esc(i.alt)}</figcaption>` : ''}</figure>` : '');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-11-10" → "10 November 2026". */
export const longDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

/** A book the page mentions, as the catalogue has it. */
export interface BookInfo {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
}

const COLOURS = ['coral', 'sky', 'sun', 'mint', 'grape', 'pink', 'tangerine'];
const colour = (seed: string) => COLOURS[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLOURS.length];

/** The cover of a book (or a drawn one), as on the site's shelves. */
export function bookCover(b: { id: string; title: string; authors: string[]; coverUrl: string | null }) {
  const by = b.authors.join(', ');
  return b.coverUrl
    ? `<span class="cover"><img src="${esc(b.coverUrl)}" alt="" loading="lazy" decoding="async" /></span>`
    : `<span class="cover"><span class="drawn-cover c-${colour(b.id)}" aria-hidden="true"><span class="drawn-title">${esc(b.title)}</span>${by ? `<span class="drawn-author">${esc(by)}</span>` : ''}</span></span>`;
}

const reserveUrl = (title: string) => `/account/explore?q=${encodeURIComponent(title)}`;

/** A list of books with notes: covers, titles, authors, why, and a Reserve link. */
export function bookList(items: { book: BookInfo; note: string }[], big = false) {
  if (!items.length) return '';
  return `<ol class="booklist${big ? ' booklist-big' : ''}">${items
    .map(
      ({ book, note }, i) => `<li class="booklist-item">
  ${bookCover(book)}
  <div class="booklist-text">
    ${big ? `<span class="booklist-n">${i + 1}</span>` : ''}
    <h3>${esc(book.title)}</h3>
    ${book.authors.length ? `<p class="booklist-by">${esc(book.authors.join(', '))}</p>` : ''}
    ${note ? `<p>${esc(note)}</p>` : ''}
    <a class="btn btn-outlined btn-small" href="${esc(reserveUrl(book.title))}">Reserve it</a>
  </div>
</li>`,
    )
    .join('')}</ol>`;
}

const crumbs = (items: [string, string | null][]) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([label, href]) => `<li>${href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`}</li>`).join('')}</ol></nav>`;

// ------------------------------------------------------------------ blog

export interface PostView {
  draft: PostDraft;
  slug: string;
  date: string | null;
  books: { book: BookInfo; note: string }[];
  branch: { name: string; slug: string | null } | null;
}

export const DESIGN_LABEL: Record<PostDraft['design'], string> = {
  CLASSIC: 'Story', MAGAZINE: 'Feature', PHOTO: 'Photo story', TIPS: 'Tips', NOTICE: 'Notice', LETTER: 'Letter', BOOKLIST: 'Book list',
};

/** The author line: "Priya Rao, Head librarian · Stories Whitefield · 10 November 2026". */
function byline(p: PostView) {
  const who = [p.draft.author.name, p.draft.author.role].filter(Boolean).join(', ');
  const parts = [who && `<span>${esc(who)}</span>`, p.branch && (p.branch.slug ? `<a href="/branches/${esc(p.branch.slug)}">${esc(p.branch.name)}</a>` : `<span>${esc(p.branch.name)}</span>`), p.date && `<time datetime="${esc(p.date)}">${esc(longDate(p.date))}</time>`].filter(Boolean);
  return parts.length ? `<p class="post-meta">${parts.join('<span aria-hidden="true"> · </span>')}</p>` : '';
}

function quoteBlock(q: PostDraft['quote']) {
  return q ? `<blockquote class="post-quote"><p>${esc(q.text)}</p>${q.by ? `<footer>${esc(q.by)}</footer>` : ''}</blockquote>` : '';
}
function takeawaysBlock(t: string[]) {
  return t.length ? `<aside class="post-takeaways" aria-label="Key points"><h2>Key points</h2><ul>${t.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></aside>` : '';
}
function ctaBlock(c: PostDraft['cta'], big = false) {
  const href = c && safeHref(c.url);
  return c && href ? `<p class="post-cta"><a class="btn btn-filled${big ? ' btn-large' : ''}" href="${esc(href)}">${esc(c.label)}</a></p>` : '';
}
function shareBlock(title: string, url: string) {
  const wa = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
  return `<div class="post-share"><span>Share</span><a class="btn btn-outlined btn-small" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a><button type="button" class="btn btn-outlined btn-small" data-copy="${esc(url)}">Copy link</button></div>`;
}
const sectionId = (i: number) => `s${i + 1}`;

function sectionsHtml(p: PostView, mode: 'plain' | 'photo' | 'tips' | 'toc') {
  const s = p.draft.sections.filter((x) => x.heading || x.text || x.image);
  if (!s.length) return '';
  if (mode === 'tips') {
    return `<ol class="post-tips">${s.map((x, i) => `<li id="${sectionId(i)}"><span class="tip-n" aria-hidden="true">${i + 1}</span>${x.heading ? `<h2>${esc(x.heading)}</h2>` : ''}${richText(x.text)}${figure(x.image)}</li>`).join('')}</ol>`;
  }
  if (mode === 'photo') {
    return s.map((x, i) => `<section class="post-photo-row${i % 2 ? ' flip' : ''}" id="${sectionId(i)}">${figure(x.image, 'figure big')}<div>${x.heading ? `<h2>${esc(x.heading)}</h2>` : ''}${richText(x.text)}</div></section>`).join('');
  }
  return s.map((x, i) => `<section id="${sectionId(i)}">${x.heading ? `<h2>${esc(x.heading)}</h2>` : ''}${figure(x.image)}${richText(x.text)}</section>`).join('');
}

function toc(p: PostView) {
  const s = p.draft.sections.map((x, i) => [x.heading, i] as const).filter(([h]) => h);
  return s.length >= 2 ? `<nav class="post-toc" aria-label="In this post"><h2>In this post</h2><ol>${s.map(([h, i]) => `<li><a href="#${sectionId(i)}">${esc(h)}</a></li>`).join('')}</ol></nav>` : '';
}

/** A blog post in its design. `url` is its full address (for sharing). */
export function postHtml(p: PostView, url: string, related: PostCard[] = []) {
  const d = p.draft;
  const tags = d.tags.length ? `<p class="post-tags">${d.tags.map((t) => `<a class="chip" href="/blog?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</p>` : '';
  const books = d.design === 'BOOKLIST' ? '' : p.books.length ? `<section class="post-books"><h2>Books in this post</h2>${bookList(p.books)}</section>` : '';
  const end = `${quoteBlock(d.quote)}${takeawaysBlock(d.takeaways)}${books}${ctaBlock(d.cta)}${tags}${shareBlock(d.title, url)}`;
  const head = (cls = '') => `<header class="post-head ${cls}">${crumbs([['Home', '/'], ['Blog', '/blog'], [d.title, null]])}<p class="eyebrow">${esc(DESIGN_LABEL[d.design])}</p><h1>${esc(d.title)}</h1>${d.summary ? `<p class="lead">${esc(d.summary)}</p>` : ''}${byline(p)}</header>`;
  let body: string;
  switch (d.design) {
    case 'MAGAZINE':
      body = `<header class="post-hero">${d.cover ? img(d.cover, 'post-hero-img', true) : ''}<div class="post-hero-text wrap">${crumbs([['Home', '/'], ['Blog', '/blog'], [d.title, null]])}<p class="eyebrow">${esc(DESIGN_LABEL[d.design])}</p><h1>${esc(d.title)}</h1>${d.summary ? `<p class="lead">${esc(d.summary)}</p>` : ''}${byline(p)}</div></header>
<div class="wrap post-body post-mag"><div class="post-mag-side">${toc(p)}</div><div class="prose">${richText(d.intro)}${sectionsHtml(p, 'plain')}${end}</div></div>`;
      return `<article class="post post-magazine">${body}</article>${relatedHtml(related)}`;
    case 'PHOTO':
      body = `${head()}${figure(d.cover, 'figure big')}<div class="prose">${richText(d.intro)}</div>${sectionsHtml(p, 'photo')}<div class="prose">${end}</div>`;
      break;
    case 'TIPS':
      body = `${head()}${figure(d.cover, 'figure')}<div class="prose">${richText(d.intro)}</div>${sectionsHtml(p, 'tips')}<div class="prose">${end}</div>`;
      break;
    case 'NOTICE':
      body = `<div class="post-notice card">${head('notice-head')}${figure(d.cover)}<div class="prose">${richText(d.intro)}${sectionsHtml(p, 'plain')}</div>${ctaBlock(d.cta, true)}</div><div class="prose">${quoteBlock(d.quote)}${takeawaysBlock(d.takeaways)}${books}${tags}${shareBlock(d.title, url)}</div>`;
      break;
    case 'LETTER': {
      const sign = d.author.name ? `<p class="letter-sign">With love,<br /><strong>${esc(d.author.name)}</strong>${d.author.role ? `<br /><span>${esc(d.author.role)}</span>` : ''}</p>` : '';
      body = `${head()}<div class="post-letter card"><div class="prose">${richText(d.intro)}${sectionsHtml(p, 'plain')}${sign}</div></div><div class="prose">${end}</div>`;
      break;
    }
    case 'BOOKLIST':
      body = `${head()}${figure(d.cover)}<div class="prose">${richText(d.intro)}</div>${bookList(p.books, true)}<div class="prose">${sectionsHtml(p, 'plain')}${end}</div>`;
      break;
    default:
      body = `${head()}${figure(d.cover, 'figure big')}<div class="prose">${richText(d.intro)}${sectionsHtml(p, 'plain')}${end}</div>`;
  }
  return `<article class="post post-${d.design.toLowerCase()}"><div class="wrap post-body">${body}</div></article>${relatedHtml(related)}`;
}

export interface PostCard {
  slug: string;
  title: string;
  summary: string;
  design: PostDraft['design'];
  cover: SiteImage | null;
  date: string | null;
  author: string;
  tags: string[];
}

export function postCard(c: PostCard) {
  const cover = c.cover
    ? `<span class="post-card-img">${img(c.cover)}</span>`
    : `<span class="post-card-img drawn c-${colour(c.slug)}" aria-hidden="true"><span>${esc(DESIGN_LABEL[c.design])}</span></span>`;
  return `<li><a class="card post-card" href="/blog/${esc(c.slug)}">${cover}<span class="post-card-text"><span class="eyebrow">${esc(DESIGN_LABEL[c.design])}${c.date ? ` · ${esc(longDate(c.date))}` : ''}</span><span class="post-card-title">${esc(c.title)}</span>${c.summary ? `<span class="muted">${esc(plain(c.summary, 140))}</span>` : ''}</span></a></li>`;
}

function relatedHtml(related: PostCard[]) {
  return related.length ? `<section class="band"><div class="wrap"><div class="section-head"><h2>More from the blog</h2><a class="more" href="/blog">All posts →</a></div><ul class="post-grid" role="list">${related.map(postCard).join('')}</ul></div></section>` : '';
}

export function blogIndexHtml(cards: PostCard[], tags: string[], tag: string | null) {
  const chips = tags.length
    ? `<nav class="jump" aria-label="Topics"><a class="chip k-0" href="/blog"${tag ? '' : ' aria-current="page"'}>All</a>${tags.map((t, i) => `<a class="chip k-${(i + 1) % 7}" href="/blog?tag=${encodeURIComponent(t)}"${t === tag ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>`
    : '';
  return `<section class="page-head"><div class="wrap"><h1>From the library</h1><p class="lead">Book lists, reading tips, news from our branches and notes from our librarians.</p>${chips}</div></section>
<section><div class="wrap">${cards.length ? `<ul class="post-grid" role="list">${cards.map(postCard).join('')}</ul>` : `<p class="muted">${tag ? 'No posts with this topic yet.' : 'Our first posts are on their way.'}</p>`}</div></section>`;
}

// ------------------------------------------------------------------ branch pages

export const AMENITY_LABEL: Record<string, string> = {
  WIFI: 'Free Wi-Fi', AC: 'Air-conditioned', KIDS_CORNER: "Children's corner", READING_ROOM: 'Reading room', STUDY_DESKS: 'Study desks',
  PARKING: 'Parking', WHEELCHAIR: 'Wheelchair access', BOARD_GAMES: 'Board games', CAFE: 'Café', POWER_BACKUP: 'Power backup',
  NEWSPAPERS: 'Newspapers and magazines', PRINTING: 'Printing', EVENTS_SPACE: 'Space for events', BABY_CARE: 'Baby care room',
};

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_NAME: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const SCHEMA_DAY: Record<string, string> = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
export function time12(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}
/** ["Mon–Sat: 10 am – 7 pm", "Closed: Sun"] (the same rule as the website's branch cards). */
export function hoursLines(hours: PublicBranch['hours'], weeklyOffs: string[]): string[] {
  const byDay = new Map(hours.filter((h) => !weeklyOffs.includes(h.day)).map((h) => [h.day, `${time12(h.open)} – ${time12(h.close)}`]));
  const lines: string[] = [];
  let start = -1;
  for (let i = 0; i <= DAYS.length; i++) {
    const cur = byDay.get(DAYS[i]);
    const prev = start >= 0 ? byDay.get(DAYS[start]) : undefined;
    if (start >= 0 && cur !== prev) {
      lines.push(`${start === i - 1 ? DAY_NAME[DAYS[start]] : `${DAY_NAME[DAYS[start]]}–${DAY_NAME[DAYS[i - 1]]}`}: ${prev}`);
      start = -1;
    }
    if (cur && start < 0) start = i;
  }
  const closed = DAYS.filter((d) => weeklyOffs.includes(d) || (byDay.size > 0 && !byDay.has(d)));
  if (closed.length) lines.push(`Closed: ${closed.map((d) => DAY_NAME[d]).join(', ')}`);
  return lines;
}

const digits = (p: string) => p.replace(/\D/g, '');
const indian = (p: string) => {
  const d = digits(p);
  return d.length === 10 ? d : d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : null;
};
export const formatPhone = (p: string) => {
  const n = indian(p);
  return n && !/\s/.test(p.trim()) ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : p.trim();
};
export const whatsappLink = (p: string, text: string) => {
  const n = indian(p);
  return n && /^[6-9]/.test(n) ? `https://wa.me/91${n}?text=${encodeURIComponent(text)}` : null;
};
const addressLine = (a: PublicBranch['address']) => [a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(', ');

export interface BranchView {
  branch: PublicBranch;
  page: BranchDraft;
  picks: { book: BookInfo; note: string }[];
  posts: PostCard[];
  today: string;
}

/** Notices showing today or starting within two weeks, soonest first. */
export function currentNotices(notices: BranchDraft['notices'], today: string) {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  return notices.filter((n) => n.to >= today && n.from <= soon).sort((a, b) => a.from.localeCompare(b.from));
}

const noticeDates = (n: { from: string; to: string }) => (n.from === n.to ? longDate(n.from) : `${longDate(n.from)} – ${longDate(n.to)}`);

export function branchHtml(v: BranchView) {
  const { branch: b, page: p } = v;
  const name = b.name;
  const hours = hoursLines(b.hours, b.weeklyOffs);
  const phone = p.whatsapp || b.phone || '';
  const wa = phone ? whatsappLink(phone, `Hello ${name}, I'd like to know about membership.`) : null;
  const map = p.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine(b.address))}`;
  const notices = currentNotices(p.notices, v.today);
  const lib = p.librarian;
  const gallery = p.photos.slice(1);
  const hero = p.photos[0];

  const noticeHtml = notices.length
    ? `<section class="section-tight" aria-labelledby="h-notices"><div class="wrap"><h2 id="h-notices" class="visually-hidden">Important information</h2><ul class="notices" role="list">${notices
        .map((n) => `<li class="notice-item${n.closed ? ' closed' : ''}"><strong>${n.closed ? 'Closed' : 'Please note'} · ${esc(noticeDates(n))}</strong><span>${esc(n.text)}</span></li>`)
        .join('')}</ul></div></section>`
    : '';

  const highlights = p.highlights.length ? `<ul class="highlights" role="list">${p.highlights.map((h) => `<li><strong>${esc(h.value)}</strong><span>${esc(h.label)}</span></li>`).join('')}</ul>` : '';

  const visit = `<aside class="card branch-visit" aria-labelledby="h-visit">
  <h2 id="h-visit">Visit us</h2>
  <address>${esc(addressLine(b.address))}</address>
  ${hours.length ? `<ul class="hours" aria-label="Opening hours">${hours.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  <ul class="facts"><li>${b.delivery.offered ? `Home delivery${b.delivery.feeMinor ? `: ₹${(b.delivery.feeMinor / 100).toLocaleString('en-IN')} a visit` : ', free'}` : 'Pick up at the branch'}</li></ul>
  <p class="actions">
    ${b.phone ? `<a class="btn btn-outlined" href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}">Call ${esc(formatPhone(b.phone))}</a>` : ''}
    ${wa ? `<a class="btn btn-outlined btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
    <a class="btn btn-outlined" href="${esc(map)}" target="_blank" rel="noopener">Directions</a>
  </p>
  ${b.email ? `<p class="branch-email">Email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>` : ''}
  <p><a class="btn btn-filled" href="/account/sign-in?create=1">Become a member here</a></p>
</aside>`;

  const librarian = lib
    ? `<section class="band" aria-labelledby="h-librarian"><div class="wrap librarian">
  <div class="librarian-photo">${lib.photo ? img(lib.photo) : `<span class="librarian-initials" aria-hidden="true">${esc(lib.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>`}</div>
  <div class="librarian-text">
    <p class="eyebrow">${esc(lib.title || 'Head librarian')}</p>
    <h2 id="h-librarian">Meet ${esc(lib.name)}</h2>
    ${lib.quote ? `<blockquote class="post-quote"><p>${esc(lib.quote)}</p></blockquote>` : ''}
    <div class="prose">${richText(lib.bio)}</div>
    <ul class="facts">
      ${lib.since ? `<li>With Stories since ${lib.since}</li>` : ''}
      ${lib.languages.length ? `<li>Speaks ${esc(lib.languages.join(', '))}</li>` : ''}
    </ul>
    ${lib.favourites.length ? `<h3>Books ${esc(lib.name.split(/\s+/)[0])} loves</h3><ul class="chips" role="list">${lib.favourites.map((f, i) => `<li><span class="chip k-${i % 7}">${esc(f)}</span></li>`).join('')}</ul>` : ''}
  </div>
</div></section>`
    : '';

  const picks = v.picks.length ? `<section aria-labelledby="h-picks"><div class="wrap"><h2 id="h-picks">${lib ? `${esc(lib.name.split(/\s+/)[0])}’s picks` : 'Our librarians recommend'}</h2><p class="muted">Ask for them at the counter, or reserve them online.</p>${bookList(v.picks)}</div></section>` : '';

  const activities = p.activities.length
    ? `<section class="band" aria-labelledby="h-activities"><div class="wrap"><h2 id="h-activities">What’s on</h2><div class="grid">${p.activities
        .map((a) => `<article class="card tint"><p class="eyebrow">${esc(a.when)}</p><h3>${esc(a.title)}</h3>${a.audience ? `<p class="muted small">For ${esc(a.audience)}</p>` : ''}${a.text ? `<p>${esc(a.text)}</p>` : ''}</article>`)
        .join('')}</div></div></section>`
    : '';

  const amenities = p.amenities.length ? `<h2>At this library</h2><ul class="amenities" role="list">${p.amenities.map((a) => `<li>${esc(AMENITY_LABEL[a] ?? a)}</li>`).join('')}</ul>` : '';
  const good = p.goodToKnow.length ? `<h2>Good to know</h2><ul>${p.goodToKnow.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '';
  const galleryHtml = gallery.length ? `<section aria-labelledby="h-gallery"><div class="wrap"><h2 id="h-gallery">Inside the library</h2><ul class="gallery" role="list">${gallery.map((g) => `<li>${figure(g, 'figure')}</li>`).join('')}</ul></div></section>` : '';
  const postsHtml = v.posts.length ? `<section aria-labelledby="h-posts"><div class="wrap"><div class="section-head"><h2 id="h-posts">News from ${esc(name)}</h2><a class="more" href="/blog">All posts →</a></div><ul class="post-grid" role="list">${v.posts.map(postCard).join('')}</ul></div></section>` : '';

  return `<section class="page-head branch-head" data-branch-id="${esc(b.id)}"><div class="wrap">
  ${crumbs([['Home', '/'], ['Branches', '/branches'], [name, null]])}
  <div class="branch-hero">
    <div>
      <p class="eyebrow">${esc(b.address.city)}</p>
      <h1>${esc(name)}</h1>
      ${p.tagline ? `<p class="lead">${esc(p.tagline)}</p>` : ''}
      ${highlights}
    </div>
    ${hero ? `<figure class="figure branch-cover">${img(hero, '', true)}</figure>` : ''}
  </div>
</div></section>
${noticeHtml}
<section class="section-tight"><div class="wrap branch-main">
  <div class="prose">${richText(p.intro)}${richText(p.about)}${amenities}${good}</div>
  ${visit}
</div></section>
${librarian}
${picks}
${activities}
${galleryHtml}
${postsHtml}`;
}

/** What search engines read about a branch: a schema.org Library with its address, phone and hours. */
export function branchJsonLd(b: PublicBranch, p: BranchDraft, url: string) {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Library',
    name: b.name,
    url,
    address: { '@type': 'PostalAddress', streetAddress: [b.address.line1, b.address.line2].filter(Boolean).join(', '), addressLocality: b.address.city, addressRegion: b.address.state, postalCode: b.address.postalCode, addressCountry: 'IN' },
    parentOrganization: { '@type': 'Organization', name: 'Stories for All', url: 'https://storiesforall.in/' },
  };
  if (b.phone) ld.telephone = b.phone;
  if (b.email) ld.email = b.email;
  if (p.photos[0]) ld.image = p.photos.map((x) => x.url);
  const open = b.hours.filter((h) => !b.weeklyOffs.includes(h.day));
  if (open.length) ld.openingHoursSpecification = open.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAY[h.day], opens: h.open, closes: h.close }));
  return ld;
}

// ------------------------------------------------------------------ about

export function aboutHtml(s: SettingsDraft) {
  const a = s.about;
  const facts = a.facts.length ? `<ul class="highlights" role="list">${a.facts.map((f) => `<li><strong>${esc(f.value)}</strong><span>${esc(f.label)}</span></li>`).join('')}</ul>` : '';
  const photos = a.photos.length ? `<ul class="gallery" role="list">${a.photos.map((p) => `<li>${figure(p)}</li>`).join('')}</ul>` : '';
  const team = s.team.length
    ? `<section class="band" aria-labelledby="h-team"><div class="wrap"><h2 id="h-team">The people behind Stories</h2><div class="grid">${s.team
        .map((m) => `<article class="card team-card">${m.photo ? img(m.photo, 'team-photo') : `<span class="librarian-initials small" aria-hidden="true">${esc(m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(''))}</span>`}<h3>${esc(m.name)}</h3>${m.role ? `<p class="eyebrow">${esc(m.role)}</p>` : ''}${m.bio ? `<p>${esc(m.bio)}</p>` : ''}</article>`)
        .join('')}</div></div></section>`
    : '';
  return `<section class="page-head"><div class="wrap">${crumbs([['Home', '/'], ['About us', null]])}<h1>${esc(a.heading || 'Every book begins a new story')}</h1>${a.intro ? `<p class="lead">${esc(a.intro)}</p>` : '<p class="lead">Stories for All is a subscription library for children, teens and grown-ups.</p>'}${facts}</div></section>
<section class="section-tight"><div class="wrap"><div class="prose">${richText(a.body) || '<p>Subscribe once, borrow within your plan and exchange books as often as you like, at your branch or at your door.</p>'}</div>${photos}</div></section>
${team}
<section class="band band-pink cta"><div class="wrap"><h2>Come and read with us</h2><p>Find a branch near you, or join online in a couple of minutes.</p><p class="actions" style="justify-content:center"><a class="btn btn-filled btn-large" href="/account/sign-in?create=1">Become a member</a><a class="btn btn-outlined btn-large" href="/branches">Find a branch</a></p></div></section>`;
}

/** A page that isn't there (or was taken down). */
export const notFoundHtml = (what = 'page') =>
  `<section class="page-head"><div class="wrap"><h1>We couldn’t find that ${esc(what)}</h1><p class="lead">It may have moved, or it isn’t on the website any more.</p><p class="actions"><a class="btn btn-filled" href="/">Go to the home page</a><a class="btn btn-outlined" href="/blog">Read the blog</a></p></div></section>`;
