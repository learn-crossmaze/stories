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

export function planCard(plan: PublicPlan, appUrl: string) {
  const prices = plan.prices
    .map((p) => {
      const was = p.discountLabel ? ` <s class="was" aria-label="was ${esc(rupees(p.listPriceMinor))}">${esc(rupees(p.listPriceMinor))}</s>` : '';
      const offer = p.discountLabel ? ` <span class="badge">${esc(p.discountLabel)}</span>` : '';
      return `<li><span class="price">${esc(rupees(p.priceMinor))}</span>${was} <span class="per">/ ${esc(PERIOD[p.duration] ?? p.duration.toLowerCase())}</span>${offer}</li>`;
    })
    .join('');
  return `<article class="card plan">
  <h3>${esc(plan.name)}</h3>
  ${plan.description ? `<p class="muted">${esc(plan.description)}</p>` : ''}
  <p class="plan-limit"><strong>${plan.booksAtATime}</strong> book${plan.booksAtATime === 1 ? '' : 's'} at a time</p>
  <ul class="prices">${prices}</ul>
  <ul class="facts">
    <li>Unlimited exchanges</li>
    <li>For ${esc(audiences(plan.audiences))}</li>
    <li>${plan.homeDelivery ? 'Home delivery available' : 'Pick up at your branch'}</li>
    <li>Refundable deposit ${esc(rupees(plan.depositMinor))}</li>
  </ul>
  <a class="btn btn-filled" href="${esc(appUrl)}">Choose ${esc(plan.name)}</a>
</article>`;
}

/** Plans, grouped by organization when there is more than one (e.g. a franchise with its own plans). */
export function plansSection(s: PublicSnapshot, appUrl: string, limit?: number) {
  if (!s.plans.length) return '<p class="muted">Plans will appear here soon. Visit or call your nearest branch to join.</p>';
  const orgsWithPlans = s.orgs.filter((o) => s.plans.some((p) => p.orgId === o.id));
  if (orgsWithPlans.length <= 1 || limit) {
    return `<div class="grid">${s.plans.slice(0, limit).map((p) => planCard(p, appUrl)).join('')}</div>`;
  }
  return orgsWithPlans
    .map((o) => `<h3 class="group-title">${esc(o.name)}</h3><div class="grid">${s.plans.filter((p) => p.orgId === o.id).map((p) => planCard(p, appUrl)).join('')}</div>`)
    .join('');
}

export function branchCard(b: PublicBranch) {
  const a = b.address;
  const lines = hoursLines(b.hours, b.weeklyOffs);
  return `<article class="card branch">
  <h3>${esc(b.name)}</h3>
  <address>${esc(a.line1)}${a.line2 ? `<br />${esc(a.line2)}` : ''}<br />${esc(a.city)}, ${esc(a.state)} ${esc(a.postalCode)}</address>
  ${lines.length ? `<ul class="hours">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
  <ul class="facts">
    ${b.delivery.offered ? `<li>Home delivery: ${b.delivery.feeMinor ? `${esc(rupees(b.delivery.feeMinor))} a visit` : 'free'}</li>` : '<li>Pick up at the branch</li>'}
  </ul>
  <p class="actions">
    ${b.phone ? `<a class="btn btn-outlined" href="${esc(telHref(b.phone))}">Call ${esc(b.phone)}</a>` : ''}
    <a class="btn btn-text" href="${esc(mapsUrl(a))}" target="_blank" rel="noopener">Directions</a>
    ${b.email ? `<a class="btn btn-text" href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ''}
  </p>
</article>`;
}

export function branchesSection(s: PublicSnapshot, limit?: number) {
  if (!s.branches.length) return '<p class="muted">Our first branches are opening soon.</p>';
  return `<div class="grid">${s.branches.slice(0, limit).map(branchCard).join('')}</div>`;
}

/** "2,400 titles · 3 branches". */
export function statsLine(s: PublicSnapshot) {
  const parts = [];
  if (s.titles) parts.push(`${s.titles.toLocaleString('en-IN')} title${s.titles === 1 ? '' : 's'} to choose from`);
  if (s.branches.length) parts.push(`${s.branches.length} branch${s.branches.length === 1 ? '' : 'es'}`);
  return esc(parts.join(' · '));
}

/** Contact lines for every branch (Contact page). */
export function contactsSection(s: PublicSnapshot) {
  if (!s.branches.length) return '';
  return `<ul class="contacts">${s.branches
    .map(
      (b) => `<li><strong>${esc(b.name)}</strong>, ${esc(b.address.city)}${b.phone ? ` · <a href="${esc(telHref(b.phone))}">${esc(b.phone)}</a>` : ''}${b.email ? ` · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ''}</li>`,
    )
    .join('')}</ul>`;
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
  return AGE_LABEL[book.ageGroup] ?? '';
}

export function bookCard(book: ShowcaseBook, kind: ShelfKind, index: number, appUrl: string) {
  const by = book.authors.length ? book.authors.join(', ') : '';
  const cover = book.coverUrl
    ? `<img src="${esc(book.coverUrl)}" alt="" loading="lazy" decoding="async" />`
    : `<span class="drawn-cover c-${coverColour(book.id)}" aria-hidden="true"><span class="drawn-title">${esc(book.title)}</span>${by ? `<span class="drawn-author">${esc(by)}</span>` : ''}</span>`;
  return `<li class="book">
  <a href="${esc(appUrl)}/explore" aria-label="${esc(`${book.title}${by ? ` by ${by}` : ''}. ${reason(kind, book)}. Find it in the Stories app`)}">
    <span class="cover">${cover}<span class="ribbon">${esc(ribbon(kind, book, index))}</span></span>
    <span class="book-title">${esc(book.title)}</span>
    ${by ? `<span class="book-author">${esc(by)}</span>` : ''}
    <span class="book-reason">${esc(reason(kind, book))}</span>
  </a>
</li>`;
}

/** A sideways-scrolling shelf; '' when there is nothing to show (the section then hides). */
export function shelf(books: ShowcaseBook[] | undefined, kind: ShelfKind, label: string, appUrl: string, limit?: number) {
  const list = (books ?? []).slice(0, limit);
  if (!list.length) return '';
  return `<ul class="shelf" role="list" tabindex="0" aria-label="${esc(label)}">${list.map((b, i) => bookCard(b, kind, i, appUrl)).join('')}</ul>`;
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

/** Genre chips with the number of titles ('' when the catalogue is empty). */
export function genreChips(s: PublicSnapshot, appUrl: string) {
  const genres = s.showcase?.genres ?? [];
  if (!genres.length) return '';
  return `<ul class="chips" role="list">${genres
    .map((g, i) => `<li><a class="chip k-${i % 7}" href="${esc(appUrl)}/explore">${esc(GENRE_LABEL[g.key] ?? g.key)} <span class="chip-count">${g.count.toLocaleString('en-IN')}</span></a></li>`)
    .join('')}</ul>`;
}
