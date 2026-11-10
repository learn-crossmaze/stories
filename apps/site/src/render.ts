// Pure HTML builders for the live parts of the site. Every value from the data is escaped.
import type { PublicBranch, PublicPlan, PublicSnapshot, ShowcaseBook } from './data';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Paise as rupees: ₹1,399 or ₹1,399.50. */
export const rupees = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const PERIOD: Record<string, string> = { MONTHLY: 'month', QUARTERLY: '3 months', HALF_YEARLY: '6 months', ANNUAL: 'year' };
const AUDIENCE: Record<string, string> = { CHILDREN: 'Children (under 13)', TEENS: 'Teens (13–17)', ADULTS: 'Adults (18+)' };
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_NAME: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

export const audiences = (list: string[]) => list.map((a) => AUDIENCE[a] ?? a).join(', ');

/** "10:00" → "10 am", "19:30" → "7:30 pm". */
export function time12(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}

/** Opening hours as short lines: ["Mon–Sat: 10 am – 7 pm", "Closed: Sun"]. Consecutive days with the same hours are grouped. */
export function hoursLines(hours: PublicBranch['hours'], weeklyOffs: string[]): string[] {
  // A weekly off wins over hours saved for that day.
  const byDay = new Map(hours.filter((h) => !weeklyOffs.includes(h.day)).map((h) => [h.day, `${time12(h.open)} – ${time12(h.close)}`]));
  const lines: string[] = [];
  let start = -1;
  for (let i = 0; i <= DAYS.length; i++) {
    const cur = byDay.get(DAYS[i]);
    const prev = start >= 0 ? byDay.get(DAYS[start]) : undefined;
    if (start >= 0 && cur !== prev) {
      const span = start === i - 1 ? DAY_NAME[DAYS[start]] : `${DAY_NAME[DAYS[start]]}–${DAY_NAME[DAYS[i - 1]]}`;
      lines.push(`${span}: ${prev}`);
      start = -1;
    }
    if (cur && start < 0) start = i;
  }
  const closed = DAYS.filter((d) => weeklyOffs.includes(d) || (byDay.size > 0 && !byDay.has(d)));
  if (closed.length) lines.push(`Closed: ${closed.map((d) => DAY_NAME[d]).join(', ')}`);
  return lines;
}

export const mapsUrl = (a: PublicBranch['address']) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(', '))}`;

const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, '')}`;

/** The ten-digit Indian number in a phone as saved ("+91 72599 21508", "07259921508"…), or null. */
const indianNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return null;
};

/** A phone as people read it: "7259921508" → "+91 72599 21508". Numbers already written with spaces stay as written. */
export function formatPhone(phone: string) {
  const n = indianNumber(phone);
  if (!n || /\s/.test(phone.trim())) return phone.trim();
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

/** A WhatsApp chat link for an Indian mobile number (they start with 6–9), else null. */
export function whatsappUrl(phone: string, text?: string) {
  const n = indianNumber(phone);
  if (!n || !/^[6-9]/.test(n)) return null;
  return `https://wa.me/91${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const addressLine = (a: PublicBranch['address']) => [a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(', ');

// ------------------------------------------------------------------ plans

/** Billing periods in the order the switcher shows them. */
export const PERIODS = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'] as const;
const PERIOD_TAB: Record<string, string> = { MONTHLY: 'Monthly', QUARTERLY: '3 months', HALF_YEARLY: '6 months', ANNUAL: 'Yearly' };

/** "For all ages" when a plan suits everyone; else the groups it is for. */
export const audienceLine = (list: string[]) =>
  ['CHILDREN', 'TEENS', 'ADULTS'].every((a) => list.includes(a)) ? 'For all ages' : `For ${audiences(list)}`;

type Price = PublicPlan['prices'][number];

/** "₹300 a month · Save 17% on monthly" for a longer period; '' for monthly. */
export function priceNote(p: Price, monthly: Price | undefined) {
  if (p.months <= 1) return '';
  const perMonth = Math.round(p.priceMinor / p.months / 100) * 100;
  const parts = [`${rupees(perMonth)} a month`];
  if (monthly) {
    const save = Math.round((1 - p.priceMinor / p.months / monthly.priceMinor) * 100);
    if (save >= 1) parts.push(`save ${save}% on monthly`);
  }
  return parts.join(' · ');
}

const joinLink = (appUrl: string, planId: string, duration?: string) =>
  `${appUrl}/membership?plan=${encodeURIComponent(planId)}${duration ? `&d=${encodeURIComponent(duration)}` : ''}`;

/**
 * A plan card. It carries a price for every billing period (each marked with data-d); the plans section shows the
 * one the visitor picked in the switcher, so a card is one price tall.
 */
export function planCard(plan: PublicPlan, appUrl: string, periods: readonly string[] = plan.prices.map((p) => p.duration)) {
  const monthly = plan.prices.find((p) => p.duration === 'MONTHLY');
  const rows = periods
    .map((d) => {
      const p = plan.prices.find((x) => x.duration === d);
      const per = PERIOD[d] ?? d.toLowerCase();
      if (!p) return `<div class="price-row" data-d="${esc(d)}"><p class="muted price-missing">Not offered for ${esc(per)}. Try another option above.</p></div>`;
      const was = p.discountLabel && p.listPriceMinor > p.priceMinor ? ` <s class="was"><span class="visually-hidden">was </span>${esc(rupees(p.listPriceMinor))}</s>` : '';
      const note = priceNote(p, monthly);
      return `<div class="price-row" data-d="${esc(d)}">
    <p class="price-line"><span class="price">${esc(rupees(p.priceMinor))}</span>${was} <span class="per">/ ${esc(per)}</span></p>
    ${note || p.discountLabel ? `<p class="price-note">${p.discountLabel ? `<span class="badge">${esc(p.discountLabel)}</span> ` : ''}${esc(note)}</p>` : ''}
  </div>`;
    })
    .join('');
  const ctas = periods
    .map((d) => {
      const has = plan.prices.some((x) => x.duration === d);
      return `<a class="btn btn-filled" data-d="${esc(d)}" href="${esc(joinLink(appUrl, plan.id, has ? d : undefined))}">Choose ${esc(plan.name)}</a>`;
    })
    .join('');
  return `<article class="card plan">
  <h3>${esc(plan.name)}</h3>
  <p class="plan-limit"><strong>${plan.booksAtATime}</strong> book${plan.booksAtATime === 1 ? '' : 's'} at a time</p>
  <div class="prices">${rows}</div>
  ${plan.description ? `<p class="muted plan-desc">${esc(plan.description)}</p>` : ''}
  <ul class="facts">
    <li>Unlimited exchanges</li>
    <li>${esc(audienceLine(plan.audiences))}</li>
    <li>${plan.homeDelivery ? 'Home delivery available' : 'Pick up at your branch'}</li>
    <li>+ ${esc(rupees(plan.depositMinor))} refundable deposit (paid once)</li>
  </ul>
  <div class="plan-cta">${ctas}</div>
</article>`;
}

/** The billing-period switcher; '' when every plan has just one period. */
function periodSwitch(periods: readonly string[], selected: string) {
  if (periods.length < 2) return '';
  return `<div class="periods" role="group" aria-label="How often you pay">${periods
    .map((d) => `<button type="button" class="period" data-period="${esc(d)}" aria-pressed="${d === selected}">${esc(PERIOD_TAB[d] ?? d)}</button>`)
    .join('')}</div>`;
}

/** Plans with a billing-period switcher, grouped by organization when there is more than one (e.g. a franchise). */
export function plansSection(s: PublicSnapshot, appUrl: string, limit?: number) {
  if (!s.plans.length) return '<p class="muted">Plans will appear here soon. Visit or call your nearest branch to join.</p>';
  const shown = s.plans.slice(0, limit);
  const present = new Set(shown.flatMap((p) => p.prices.map((x) => x.duration)));
  const periods = [...PERIODS.filter((d) => present.has(d)), ...[...present].filter((d) => !(PERIODS as readonly string[]).includes(d))];
  const selected = present.has('MONTHLY') ? 'MONTHLY' : periods[0];
  const grid = (plans: PublicPlan[]) => `<div class="grid plan-grid">${plans.map((p) => planCard(p, appUrl, periods)).join('')}</div>`;
  const orgsWithPlans = s.orgs.filter((o) => shown.some((p) => p.orgId === o.id));
  const body =
    orgsWithPlans.length <= 1 || limit
      ? grid(shown)
      : orgsWithPlans.map((o) => `<h3 class="group-title">${esc(o.name)}</h3>${grid(shown.filter((p) => p.orgId === o.id))}`).join('');
  return `<div class="plans" data-show="${esc(selected)}">${periodSwitch(periods, selected)}${body}</div>`;
}

// ------------------------------------------------------------------ branches

/** Call, WhatsApp, directions and email for a branch. */
function branchActions(b: PublicBranch) {
  const wa = b.phone ? whatsappUrl(b.phone, `Hello ${b.name}, I'd like to know about membership.`) : null;
  return `<p class="actions">
    ${b.phone ? `<a class="btn btn-outlined" href="${esc(telHref(b.phone))}" aria-label="Call ${esc(b.name)}, ${esc(formatPhone(b.phone))}">Call ${esc(formatPhone(b.phone))}</a>` : ''}
    ${wa ? `<a class="btn btn-outlined btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
    <a class="btn btn-outlined" href="${esc(mapsUrl(b.address))}" target="_blank" rel="noopener">Directions</a>
  </p>
  ${b.email ? `<p class="branch-email">Email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>` : ''}`;
}

export function branchCard(b: PublicBranch) {
  const a = b.address;
  const lines = hoursLines(b.hours, b.weeklyOffs);
  return `<article class="card branch">
  <h3>${esc(b.name)}</h3>
  <address>${esc(a.line1)}${a.line2 ? `<br />${esc(a.line2)}` : ''}<br />${esc(a.city)}, ${esc(a.state)} ${esc(a.postalCode)}</address>
  ${lines.length ? `<ul class="hours" aria-label="Opening hours">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  <ul class="facts">
    ${b.delivery.offered ? `<li>Home delivery: ${b.delivery.feeMinor ? `${esc(rupees(b.delivery.feeMinor))} a visit` : 'free'}</li>` : '<li>Pick up at the branch</li>'}
  </ul>
  ${branchActions(b)}
</article>`;
}

/** A map of the branch (Google Maps embed, loaded when it scrolls into view). */
export const branchMap = (b: PublicBranch) =>
  `<iframe class="map" title="Map showing ${esc(b.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(`https://www.google.com/maps?q=${encodeURIComponent(addressLine(b.address))}&output=embed`)}"></iframe>`;

/** Branch cards; a single branch sits beside its map instead of alone in an empty row. */
export function branchesSection(s: PublicSnapshot, limit?: number) {
  if (!s.branches.length) return '<p class="muted">Our first branches are opening soon.</p>';
  const list = s.branches.slice(0, limit);
  if (list.length === 1) return `<div class="branch-solo">${branchCard(list[0])}${branchMap(list[0])}</div>`;
  return `<div class="grid">${list.map(branchCard).join('')}</div>`;
}

/** "2,400 titles · 3 branches". */
export function statsLine(s: PublicSnapshot) {
  const parts = [];
  if (s.titles) parts.push(`${s.titles.toLocaleString('en-IN')} title${s.titles === 1 ? '' : 's'} to choose from`);
  if (s.branches.length) parts.push(`${s.branches.length} branch${s.branches.length === 1 ? '' : 'es'}`);
  return esc(parts.join(' · '));
}

/** Ways to reach every branch (Contact page): call, WhatsApp, email and where to find it. */
export function contactsSection(s: PublicSnapshot) {
  if (!s.branches.length) return '<p class="muted">Our first branches are opening soon.</p>';
  const cards = s.branches.map((b) => {
      const lines = hoursLines(b.hours, b.weeklyOffs);
      return `<article class="card contact-card">
  <h3>${esc(b.name)}</h3>
  <address>${esc(addressLine(b.address))}</address>
  ${lines.length ? `<p class="hours-inline">${lines.map(esc).join(' · ')}</p>` : ''}
  ${branchActions(b)}
</article>`;
  });
  return s.branches.length === 1 ? `<div class="branch-solo">${cards[0]}${branchMap(s.branches[0])}</div>` : `<div class="grid contacts">${cards.join('')}</div>`;
}

// ------------------------------------------------------------------ books

export const GENRE_LABEL: Record<string, string> = {
  FICTION: 'Fiction', FANTASY: 'Fantasy', MYSTERY: 'Mystery', ADVENTURE: 'Adventure', SCIENCE: 'Science',
  BIOGRAPHY: 'Biography', SELF_HELP: 'Self-help', CLASSICS: 'Classics', COMICS: 'Comics', EDUCATIONAL: 'Learning',
};
export const AGE_LABEL: Record<string, string> = { CHILDREN: 'Little readers', TEENS: 'Teens', ADULTS: 'Grown-ups' };
export type ShelfKind = 'trending' | 'popular' | 'newArrivals' | 'mostWanted' | 'byAge';

const COVER_COLOURS = ['coral', 'sky', 'sun', 'mint', 'grape', 'pink', 'tangerine'];
/** A steady colour per book for the drawn cover (when the title has no cover image). */
export const coverColour = (id: string) => COVER_COLOURS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COVER_COLOURS.length];

/** The ribbon on a card: its place on the shelf, or what makes it special. */
export function ribbon(kind: ShelfKind, book: ShowcaseBook, index: number): string {
  if (kind === 'newArrivals') return 'New';
  if (kind === 'mostWanted') return `${book.count ?? 0} waiting`;
  return `#${index + 1}`;
}

/** The small line under the author: why the book is on this shelf. */
export function reason(kind: ShelfKind, book: ShowcaseBook, now = Date.now()): string {
  const n = book.count ?? 0;
  if (kind === 'trending') return `Borrowed ${n} time${n === 1 ? '' : 's'} this month`;
  if (kind === 'popular') return `Borrowed ${n.toLocaleString('en-IN')} time${n === 1 ? '' : 's'}`;
  if (kind === 'mostWanted') return `${n} reader${n === 1 ? '' : 's'} in the queue`;
  if (kind === 'newArrivals' && book.addedAt) {
    const days = Math.max(0, Math.floor((now - Date.parse(book.addedAt)) / 86_400_000));
    return days === 0 ? 'Added today' : days === 1 ? 'Added yesterday' : days < 14 ? `Added ${days} days ago` : `Added ${new Date(book.addedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  }
  return AGE_LABEL[book.ageGroup] ? `Popular with ${AGE_LABEL[book.ageGroup].toLowerCase()}` : '';
}

const authorsOf = (book: ShowcaseBook) => book.authors.join(', ');

function coverArt(book: ShowcaseBook, eager = false) {
  const by = authorsOf(book);
  return book.coverUrl
    ? `<img src="${esc(book.coverUrl)}" alt="" ${eager ? '' : 'loading="lazy" '}decoding="async" />`
    : `<span class="drawn-cover c-${coverColour(book.id)}" aria-hidden="true"><span class="drawn-title">${esc(book.title)}</span>${by ? `<span class="drawn-author">${esc(by)}</span>` : ''}</span>`;
}

/** A book on a shelf: a button that opens its quick view (see bookDialog). */
export function bookCard(book: ShowcaseBook, kind: ShelfKind, index: number, _appUrl?: string) {
  const by = authorsOf(book);
  return `<li class="book">
  <button type="button" class="book-open" data-book="${esc(book.id)}" data-kind="${esc(kind)}" data-index="${index}" aria-haspopup="dialog" aria-label="${esc(`${book.title}${by ? ` by ${by}` : ''}. ${reason(kind, book)}. Show details`)}">
    <span class="cover">${coverArt(book)}<span class="ribbon">${esc(ribbon(kind, book, index))}</span></span>
    <span class="book-title">${esc(book.title)}</span>
    ${by ? `<span class="book-author">${esc(by)}</span>` : ''}
    <span class="book-reason">${esc(reason(kind, book))}</span>
  </button>
</li>`;
}

/** The inside of the book quick view: the cover, what it is, why it is popular, and how to borrow it. */
export function bookDialog(book: ShowcaseBook, kind: ShelfKind, appUrl: string) {
  const by = authorsOf(book);
  const genres = book.genres.map((g) => GENRE_LABEL[g] ?? g);
  const why = reason(kind, book);
  const borrow = `${appUrl}/explore?q=${encodeURIComponent(book.title)}`;
  return `<div class="bd-cover cover">${coverArt(book, true)}</div>
<div class="bd-body">
  <h2 id="book-dialog-title">${esc(book.title)}</h2>
  ${by ? `<p class="bd-author">by ${esc(by)}</p>` : ''}
  <ul class="bd-tags" role="list">
    ${why ? `<li class="bd-why">${esc(why)}</li>` : ''}
    ${AGE_LABEL[book.ageGroup] ? `<li>${esc(AGE_LABEL[book.ageGroup])}</li>` : ''}
    ${genres.map((g) => `<li>${esc(g)}</li>`).join('')}
  </ul>
  <p class="muted">Members borrow it within their plan: reserve it online, then pick it up at a branch or have it delivered home.</p>
  <p class="actions">
    <a class="btn btn-filled" href="${esc(borrow)}">Reserve it</a>
    <a class="btn btn-outlined" href="${esc(`${appUrl}/sign-in?create=1&next=${encodeURIComponent(`/explore?q=${book.title}`)}`)}">New here? Become a member</a>
  </p>
  <p class="bd-small muted">Already a member? <strong>Reserve it</strong> opens your account with this book found for you.</p>
</div>`;
}

/** A sideways-scrolling shelf; '' when there is nothing to show (the section then hides). */
export function shelf(books: ShowcaseBook[] | undefined, kind: ShelfKind, label: string, appUrl: string, limit?: number) {
  const list = (books ?? []).slice(0, limit);
  if (!list.length) return '';
  return `<div class="shelf-wrap">
  <button type="button" class="shelf-arrow prev" data-dir="-1" aria-label="Scroll back" hidden>‹</button>
  <ul class="shelf" role="list" tabindex="0" aria-label="${esc(label)}">${list.map((b, i) => bookCard(b, kind, i, appUrl)).join('')}</ul>
  <button type="button" class="shelf-arrow next" data-dir="1" aria-label="Scroll on" hidden>›</button>
</div>`;
}

/** Top picks per age group as tabs ('' when every group is empty). */
export function ageShelves(s: PublicSnapshot, appUrl: string) {
  const groups = (['CHILDREN', 'TEENS', 'ADULTS'] as const).filter((a) => s.showcase?.byAge[a]?.length);
  if (!groups.length) return '';
  const tabs = groups
    .map((a, i) => `<button type="button" role="tab" id="tab-${a}" aria-controls="panel-${a}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" class="tab t-${a.toLowerCase()}">${esc(AGE_LABEL[a])}</button>`)
    .join('');
  const panels = groups
    .map((a, i) => `<div role="tabpanel" id="panel-${a}" aria-labelledby="tab-${a}"${i === 0 ? '' : ' hidden'}>${shelf(s.showcase!.byAge[a], 'byAge', `Top picks for ${AGE_LABEL[a].toLowerCase()}`, appUrl)}</div>`)
    .join('');
  return `<div class="tabs" role="tablist" aria-label="Age group">${tabs}</div>${panels}`;
}

/** Genres with the number of titles ('' when the catalogue is empty). Information only: they don't lead anywhere. */
export function genreChips(s: PublicSnapshot, _appUrl?: string) {
  const genres = s.showcase?.genres ?? [];
  if (!genres.length) return '';
  return `<ul class="chips" role="list" aria-label="Books by genre">${genres
    .map((g, i) => `<li><span class="chip k-${i % 7}">${esc(GENRE_LABEL[g.key] ?? g.key)} <span class="chip-count">${g.count.toLocaleString('en-IN')}<span class="visually-hidden"> titles</span></span></span></li>`)
    .join('')}</ul>`;
}

/** The book a shelf button stands for, with that shelf's numbers (a book can be on several shelves). */
export function findBook(s: PublicSnapshot, kind: ShelfKind, id: string): ShowcaseBook | undefined {
  const sc = s.showcase;
  if (!sc) return undefined;
  const lists = kind === 'byAge' ? [sc.byAge.CHILDREN, sc.byAge.TEENS, sc.byAge.ADULTS] : [sc[kind]];
  return lists.flat().find((b) => b.id === id);
}
