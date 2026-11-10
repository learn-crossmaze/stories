import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource-variable/nunito';
import './site.css';

import { APP_URL, CONTACT_EMAIL } from './config';
import { loadSnapshot, type PublicSnapshot } from './data';
import { wireThemeSwitch } from './theme';
import { ageShelves, bookDialog, branchesSection, contactsSection, esc, findBook, genreChips, plansSection, shelf, type ShelfKind, statsLine } from './render';

// Links to the app and the enquiry address (set in apps/site/.env).
document.querySelectorAll<HTMLAnchorElement>('[data-app-link]').forEach((a) => (a.href = APP_URL + (a.dataset.appLink || '')));
document.querySelectorAll<HTMLElement>('[data-contact-email]').forEach((el) => {
  if (!CONTACT_EMAIL) return el.remove();
  el.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
    a.href = `mailto:${CONTACT_EMAIL}${a.dataset.subject ? `?subject=${encodeURIComponent(a.dataset.subject)}` : ''}`;
    a.textContent = a.textContent?.trim() ? a.textContent : CONTACT_EMAIL;
  });
  el.hidden = false;
});

// The current page in the menu.
const here = location.pathname.replace(/\/$/, '') || '/';
document.querySelectorAll<HTMLAnchorElement>('.site-nav a').forEach((a) => {
  if ((a.getAttribute('href') ?? '').replace(/\/$/, '') === here) a.setAttribute('aria-current', 'page');
});

// Small-screen menu: opens over the page; Escape, a tap outside or choosing a page closes it.
const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
const nav = document.querySelector<HTMLElement>('.site-nav');
const setMenu = (open: boolean, refocus = false) => {
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  document.body.classList.toggle('menu-open', open);
  if (open) nav?.querySelector<HTMLElement>('a')?.focus();
  else if (refocus) toggle.focus();
};
toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('menu-open')) setMenu(false, true);
});
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('menu-open')) return;
  const target = e.target as Node;
  if (toggle?.contains(target)) return;
  if (!nav?.contains(target) || (target as HTMLElement).closest?.('a')) setMenu(false);
});
// Back to a wide screen with the menu open: reset it.
matchMedia('(min-width: 1100px)').addEventListener('change', (e) => e.matches && setMenu(false));

wireThemeSwitch();

document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = String(new Date().getFullYear())));

// Live parts: plans, branches and numbers from Stories itself.
const renderers: Record<string, (s: PublicSnapshot, el: HTMLElement) => string> = {
  plans: (s, el) => plansSection(s, APP_URL, Number(el.dataset.limit) || undefined),
  branches: (s, el) => branchesSection(s, Number(el.dataset.limit) || undefined),
  stats: (s) => statsLine(s),
  contacts: (s) => contactsSection(s),
  shelf: (s, el) => {
    const kind = el.dataset.shelf as Exclude<ShelfKind, 'byAge'>;
    return shelf(s.showcase?.[kind], kind, el.dataset.label ?? '', APP_URL, Number(el.dataset.limit) || undefined);
  },
  ages: (s) => ageShelves(s, APP_URL),
  genres: (s) => genreChips(s, APP_URL),
};

/** Tabs (Top picks by age): click or arrow keys switch the panel. */
function wireTabs(root: HTMLElement) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const select = (tab: HTMLButtonElement) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')!)!.hidden = !on;
    }
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) {
        e.preventDefault();
        select(next);
        next.focus();
      }
    });
  });
}
/** Shelves: arrow buttons on wide screens, shown only when there is more to scroll to. */
function wireShelves(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.shelf-wrap').forEach((wrap) => {
    const list = wrap.querySelector<HTMLElement>('.shelf')!;
    const [prev, next] = [wrap.querySelector<HTMLButtonElement>('.prev')!, wrap.querySelector<HTMLButtonElement>('.next')!];
    const update = () => {
      prev.hidden = list.scrollLeft <= 12;
      next.hidden = list.scrollLeft + list.clientWidth >= list.scrollWidth - 12;
    };
    for (const b of [prev, next]) b.addEventListener('click', () => list.scrollBy({ left: Number(b.dataset.dir) * list.clientWidth * 0.85, behavior: 'smooth' }));
    list.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(list);
    update();
  });
}

/** Plans: the billing-period switcher shows one price per card. */
function wirePeriods(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.plans').forEach((plans) => {
    const buttons = [...plans.querySelectorAll<HTMLButtonElement>('.period')];
    for (const b of buttons) {
      b.addEventListener('click', () => {
        plans.dataset.show = b.dataset.period;
        for (const o of buttons) o.setAttribute('aria-pressed', String(o === b));
      });
    }
  });
}

// The book quick view: one dialog for every shelf on the page.
let snapshotForBooks: PublicSnapshot | null = null;
let bookDialogEl: HTMLDialogElement | null = null;
function openBook(button: HTMLButtonElement) {
  if (!snapshotForBooks) return;
  const kind = button.dataset.kind as ShelfKind;
  const book = findBook(snapshotForBooks, kind, button.dataset.book ?? '');
  if (!book) return;
  if (!bookDialogEl) {
    const dialog = document.createElement('dialog');
    dialog.className = 'book-dialog';
    dialog.setAttribute('aria-labelledby', 'book-dialog-title');
    // A tap on the backdrop (outside the card) closes it.
    dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
    dialog.addEventListener('close', () => document.querySelector<HTMLElement>('[data-opened-book]')?.focus());
    document.body.append(dialog);
    bookDialogEl = dialog;
  }
  document.querySelectorAll('[data-opened-book]').forEach((el) => el.removeAttribute('data-opened-book'));
  button.setAttribute('data-opened-book', '');
  bookDialogEl.innerHTML = `<div class="bd-card"><button type="button" class="bd-close" aria-label="Close">×</button>${bookDialog(book, kind, APP_URL)}</div>`;
  bookDialogEl.querySelector('.bd-close')!.addEventListener('click', () => bookDialogEl!.close());
  bookDialogEl.showModal();
  bookDialogEl.querySelector<HTMLElement>('.btn-filled')?.focus();
}
document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest?.<HTMLButtonElement>('.book-open');
  if (button) openBook(button);
});

/** "Jump to" chips (Books page) only for shelves that have books. */
function hideDeadJumps() {
  document.querySelectorAll<HTMLAnchorElement>('.jump a[href^="#"]').forEach((a) => {
    const target = document.getElementById(a.hash.slice(1));
    a.hidden = !target || !!target.closest('[hidden]');
  });
}

const live = [...document.querySelectorAll<HTMLElement>('[data-live]')];

async function fill() {
  if (!live.length) return;
  live.forEach((el) => el.setAttribute('aria-busy', 'true'));
  try {
    const snapshot = await loadSnapshot();
    snapshotForBooks = snapshot;
    for (const el of live) {
      const html = renderers[el.dataset.live!]?.(snapshot, el) ?? '';
      el.innerHTML = html;
      // A shelf with nothing on it yet (a new library) hides its whole section.
      const section = el.dataset.hideEmpty !== undefined ? el.closest('section') : null;
      if (section) section.hidden = !html;
      if (el.dataset.live === 'ages') wireTabs(el);
      wireShelves(el);
      wirePeriods(el);
    }
    hideDeadJumps();
  } catch {
    for (const el of live) {
      if (el.dataset.live === 'stats') {
        el.textContent = '';
        continue;
      }
      el.innerHTML = `<p class="notice" role="status">We couldn't load the latest ${esc(el.dataset.what ?? el.dataset.live)} just now. <button type="button" class="btn btn-text" data-retry>Try again</button></p>`;
    }
    document.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => void fill(), { once: true }));
  } finally {
    live.forEach((el) => el.removeAttribute('aria-busy'));
  }
}
void fill();
