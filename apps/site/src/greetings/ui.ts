// Festive cards on the website (from the Crossmaze website's greetings): on the day, a small glass toast with the
// greeting and "See our card", and a pop-up with that year's card (Share on WhatsApp, Download), what the day is
// about, a reading idea, something to try with a book, books to borrow, and the library's offer. The console's
// Website → Festive cards page chooses the words, pictures, books and offer (published to /api/public).
import { indiaToday, occasionsOn, datesTable } from './calendar';
import { CARD_FONTS, type Measure, renderCard, turn } from './card';
import dates from './dates.json';
import { textFor } from './library';
import { occasions } from './occasions';
import { paletteFor } from './palettes';
import { type CardPick, type Occasion, pickKey } from './types';

import poppinsUrl from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?url';
import nunitoUrl from '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url';

/** What the website's data says about cards (functions/src/site/live.ts PublicGreetings). */
export interface GreetingsConfig {
  enabled: boolean;
  autoOpen: boolean;
  delaySeconds: number;
  offer: { on: boolean; text: string; cta: { label: string; url: string } | null };
  picks: Record<string, { hidden: boolean; words: string; picture: { url: string; alt: string } | null; gen: number | null; books: { id: string; title: string; authors: string[]; coverUrl: string | null }[] }>;
}

const LOGO = '/logo.svg';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const theme = () => document.documentElement.dataset.theme;
const table = datesTable(dates.events, occasions);

/** Today's occasions that the library hasn't switched off. */
export function todaysOccasions(config: GreetingsConfig | null, iso = indiaToday()): Occasion[] {
  if (config && !config.enabled) return [];
  const year = Number(iso.slice(0, 4));
  return occasionsOn(iso, occasions, table).filter((o) => !config?.picks[pickKey(o.id, year)]?.hidden);
}

let measure: Measure | undefined;
async function cardMeasure(): Promise<Measure> {
  if (measure) return measure;
  await Promise.all([document.fonts.load(`700 40px '${CARD_FONTS.display}'`), document.fonts.load(`700 40px '${CARD_FONTS.text}'`)]).catch(() => undefined);
  const ctx = document.createElement('canvas').getContext('2d');
  measure = ctx ? (text, font) => ((ctx.font = font), ctx.measureText(text).width) : undefined;
  return measure ?? ((text) => text.length * 18);
}

let config: GreetingsConfig | null = null;
const pickFor = (o: Occasion, year: number): CardPick => {
  const p = config?.picks[pickKey(o.id, year)];
  return p ? { wish: p.words || undefined, photo: p.picture?.url, gen: p.gen ?? undefined } : {};
};

/** The card as SVG markup. */
export async function cardSvg(o: Occasion, year: number, opts: { defs?: string; logo?: string; photo?: string; pick?: CardPick } = {}) {
  const pick = opts.pick ?? pickFor(o, year);
  return renderCard({
    occasion: o,
    text: textFor(o.id, o.name),
    year,
    palette: paletteFor(theme(), o.solemn),
    logo: opts.logo ?? LOGO,
    measure: await cardMeasure(),
    defs: opts.defs ?? '',
    pick: opts.photo && pick.photo ? { ...pick, photo: opts.photo } : pick,
  });
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
const fetchDataUrl = async (url: string) => dataUrl(await (await fetch(url)).blob());

/** The card as a 1080 × 1080 PNG: an SVG drawn as a picture loads nothing itself, so the fonts and logo go inside it. */
async function cardPng(o: Occasion, year: number) {
  const own = pickFor(o, year).photo;
  const [display, text, logo, photo] = await Promise.all([fetchDataUrl(poppinsUrl), fetchDataUrl(nunitoUrl), fetchDataUrl(LOGO), own ? fetchDataUrl(own) : undefined]);
  const defs = `<style>@font-face{font-family:'${CARD_FONTS.display}';src:url(${display}) format('woff2');font-weight:700}@font-face{font-family:'${CARD_FONTS.text}';src:url(${text}) format('woff2');font-weight:200 1000}</style>`;
  const svg = await cardSvg(o, year, { defs, logo, photo });
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  await new Promise((r) => setTimeout(r, 150));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1080;
  canvas.getContext('2d')?.drawImage(img, 0, 0, 1080, 1080);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not make the picture');
  return new File([blob], `stories-${o.id}-${year}.png`, { type: 'image/png' });
}

async function share(o: Occasion, year: number, button: HTMLButtonElement) {
  const message = `${textFor(o.id, o.name).title(year)} from all of us at Stories for All! ${location.origin}`;
  button.disabled = true;
  try {
    const file = await cardPng(o, year);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: message });
      return;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
  } finally {
    button.disabled = false;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

async function download(o: Occasion, year: number, button: HTMLButtonElement) {
  button.disabled = true;
  try {
    const file = await cardPng(o, year);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } finally {
    button.disabled = false;
  }
}

const safeUrl = (u: string) => (/^\/(?!\/)|^https:\/\/|^tel:|^mailto:/.test(u) ? u : '/plans');

function textHtml(o: Occasion, year: number) {
  const t = textFor(o.id, o.name);
  const books = config?.picks[pickKey(o.id, year)]?.books ?? [];
  const offer = config?.offer;
  const showOffer = !o.solemn && (offer ? offer.on : true);
  return `<p class="eyebrow">${esc(t.eyebrow)}</p>
<h2 id="greet-title">${esc(t.heading)}</h2>
<p>${esc(t.about)}</p>
<h3>Read for the day</h3>
<p>${t.little}</p>
${
  books.length
    ? `<ul class="greet-books" role="list">${books
        .map((b) => `<li><a href="/account/explore?q=${encodeURIComponent(b.title)}">${b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="" loading="lazy" />` : ''}<span><strong>${esc(b.title)}</strong>${b.authors.length ? `<span>${esc(b.authors.join(', '))}</span>` : ''}</span></a></li>`)
        .join('')}</ul>`
    : ''
}
<h3>Try this with a book</h3>
<div class="greet-try"><p>${esc(turn(t.activities, year))}</p></div>
${
  showOffer
    ? `<div class="greet-offer"><b>${esc(offer?.text || 'Make this the year of reading: join Stories for All.')}</b><a class="btn btn-filled" href="${esc(safeUrl(offer?.cta?.url ?? '/account/sign-in?create=1'))}">${esc(offer?.cta?.label ?? 'Become a member')}</a></div>`
    : ''
}`;
}

let dialog: HTMLDialogElement | undefined;

/** Opens the pop-up for today's occasions (tabs switch between them). */
export async function openGreeting(list: Occasion[], year: number) {
  if (!list.length) return;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'greet-dialog';
    dialog.setAttribute('aria-labelledby', 'greet-title');
    dialog.addEventListener('click', (e) => e.target === dialog && dialog?.close());
    document.body.append(dialog);
  }
  const d = dialog;
  const show = async (o: Occasion) => {
    d.innerHTML = `<div class="greet-body">
<button type="button" class="bd-close greet-close" aria-label="Close">×</button>
<div class="greet-card">${await cardSvg(o, year)}
<div class="greet-share"><button type="button" class="btn btn-filled greet-wa">${innerWidth < 640 ? 'WhatsApp' : 'Share on WhatsApp'}</button><button type="button" class="btn btn-outlined greet-dl">Download</button></div></div>
<div class="greet-text">
${list.length > 1 ? `<div class="periods greet-tabs" role="group" aria-label="Today's greetings">${list.map((x) => `<button type="button" class="period" aria-pressed="${x.id === o.id}" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
${textHtml(o, year)}
</div></div>`;
    d.querySelector('.greet-close')?.addEventListener('click', () => d.close());
    const wa = d.querySelector<HTMLButtonElement>('.greet-wa');
    const dl = d.querySelector<HTMLButtonElement>('.greet-dl');
    wa?.addEventListener('click', () => void share(o, year, wa));
    dl?.addEventListener('click', () => void download(o, year, dl));
    d.querySelectorAll<HTMLButtonElement>('.greet-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        const next = list.find((x) => x.id === b.dataset.id);
        if (next) void show(next).then(() => d.querySelector<HTMLButtonElement>(`.greet-tabs [data-id="${next.id}"]`)?.focus());
      }),
    );
  };
  await show(list[0]);
  if (!d.open) d.showModal();
}

const CLOSED = 'stories.greetClosed';
const SHOWN = 'stories.greetShown';
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};
const recall = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/**
 * Shows today's greeting, if there is one: the toast on every page, and the pop-up by itself on the home page
 * once a day. Returns whether a greeting is showing (so a promotion pop-up stays away that day).
 */
export function showGreeting(cfg: GreetingsConfig | null, opts: { home: boolean; iso?: string } = { home: false }): boolean {
  config = cfg;
  const iso = opts.iso ?? indiaToday();
  const year = Number(iso.slice(0, 4));
  const list = todaysOccasions(cfg, iso);
  if (!list.length || recall(CLOSED) === iso) return false;
  const first = list[0];
  const t = textFor(first.id, first.name);
  const solemn = list.every((o) => o.solemn);
  const title = list.length === 1 ? t.title(year) : list.map((o) => o.name).join(' & ');
  const toast = document.createElement('aside');
  toast.className = `greet-toast${solemn ? ' solemn' : ''}`;
  toast.setAttribute('aria-label', 'Today’s greeting');
  toast.innerHTML = `<span class="greet-thumb" aria-hidden="true"></span><span class="greet-words"><b>${esc(title)}${solemn ? '' : '!'}</b><span>${esc(t.bar)}</span></span><button type="button" class="btn btn-filled greet-open">${solemn && list.length === 1 ? 'Read more' : 'See our card'}</button><button type="button" class="greet-x" aria-label="Close the greeting">×</button>`;
  document.body.append(toast);
  void cardSvg(first, year).then((svg) => {
    const img = new Image();
    img.alt = '';
    img.src = pickFor(first, year).photo ?? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    toast.querySelector('.greet-thumb')?.replaceChildren(img);
  });
  toast.querySelector('.greet-open')?.addEventListener('click', () => void openGreeting(list, year));
  toast.querySelector('.greet-x')?.addEventListener('click', () => {
    toast.remove();
    remember(CLOSED, iso);
  });
  if (opts.home && (cfg?.autoOpen ?? true) && recall(SHOWN) !== iso) {
    setTimeout(() => {
      const busy = document.activeElement?.closest('input, textarea, select') || document.querySelector('dialog[open]');
      if (!toast.isConnected || busy || document.hidden) return;
      if (remember(SHOWN, iso)) void openGreeting(list, year);
    }, (cfg?.delaySeconds ?? 6) * 1000);
  }
  return true;
}
