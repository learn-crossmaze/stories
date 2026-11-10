import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource-variable/nunito';
import './site.css';

import { APP_URL, CONTACT_EMAIL } from './config';
import { loadSnapshot, type PublicSnapshot } from './data';
import { ageShelves, branchesSection, contactsSection, esc, genreChips, plansSection, shelf, type ShelfKind, statsLine } from './render';

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

// Small-screen menu.
const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
});

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
const live = [...document.querySelectorAll<HTMLElement>('[data-live]')];

async function fill() {
  if (!live.length) return;
  live.forEach((el) => el.setAttribute('aria-busy', 'true'));
  try {
    const snapshot = await loadSnapshot();
    for (const el of live) {
      const html = renderers[el.dataset.live!]?.(snapshot, el) ?? '';
      el.innerHTML = html;
      // A shelf with nothing on it yet (a new library) hides its whole section.
      if (!html && el.dataset.hideEmpty !== undefined) {
        const section = el.closest('section');
        if (section) section.hidden = true;
      }
      if (el.dataset.live === 'ages') wireTabs(el);
    }
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
