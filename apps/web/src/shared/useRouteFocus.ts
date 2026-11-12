import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { t } from '../strings';

/** The total waiting for the person, shown before the page's name in the browser tab: "(5) Members · Stories". */
let waiting = 0;
const named = (title: string) => (waiting ? `(${waiting > 99 ? '99+' : waiting}) ${title}` : title);
const plainTitle = () => document.title.replace(/^\(\d+\+?\) /, '');
export function setWaitingInTitle(n: number) {
  waiting = n;
  document.title = named(plainTitle());
}

/**
 * After every navigation: names the browser tab after the page's heading
 * ("Members · Stories") and, except on the first load, moves keyboard and
 * screen-reader focus to that heading so the new page is announced. Pages
 * only need an <h1> inside the element with `mainId`; headings that appear
 * once data has loaded are picked up too.
 *
 * A page that should open ready to type or scan marks that field with
 * `data-autofocus`: focus goes there instead of the heading (on the first
 * load too), also when the field turns up a moment after the heading, as long
 * as nobody has moved focus meanwhile. A dialog that opened with the page
 * keeps focus.
 */
export function useRouteFocus(mainId: string, fallbackTitle?: string) {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const navigated = !first.current;
    first.current = false;
    let tries = 0;
    let timer = 0;
    let heading: HTMLElement | null = null;
    const apply = () => {
      let arriving = false;
      if (!heading) {
        const h1 = document.querySelector<HTMLElement>(`#${mainId} h1`);
        const text = h1?.textContent?.trim();
        if (!h1 || !text) {
          if (++tries < 30) timer = window.setTimeout(apply, 100);
          else if (fallbackTitle) document.title = named(`${fallbackTitle} · ${t.appTitle}`);
          return;
        }
        document.title = named(`${text} · ${t.appTitle}`);
        heading = h1;
        arriving = navigated;
      }
      // Focus taken from an open dialog would leave the keyboard on the page behind it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const active = document.activeElement;
      const untouched = !active || active === document.body || active === heading;
      const field = document.querySelector<HTMLElement>(`#${mainId} [data-autofocus]:not(:disabled)`);
      if (arriving) window.scrollTo({ top: 0 });
      if (field) {
        // Not preventScroll: a field below the fold should come into view.
        if (field !== active && (arriving || untouched)) field.focus();
        // Focused by the page itself before the jump to the top (not in every test DOM, hence the "?.").
        else if (arriving) field.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      if (arriving) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      } else if (!untouched) return;
      // Keep looking for a field that appears once the page's data has loaded.
      if (++tries < 30) timer = window.setTimeout(apply, 100);
    };
    apply();
    return () => window.clearTimeout(timer);
  }, [pathname, mainId, fallbackTitle]);
}
