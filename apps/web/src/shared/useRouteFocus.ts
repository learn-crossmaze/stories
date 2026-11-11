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
 */
export function useRouteFocus(mainId: string, fallbackTitle?: string) {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const moveFocus = !first.current;
    first.current = false;
    let tries = 0;
    let timer = 0;
    const apply = () => {
      const h1 = document.querySelector<HTMLElement>(`#${mainId} h1`);
      const text = h1?.textContent?.trim();
      if (!h1 || !text) {
        if (++tries < 30) timer = window.setTimeout(apply, 100);
        else if (fallbackTitle) document.title = named(`${fallbackTitle} · ${t.appTitle}`);
        return;
      }
      document.title = named(`${text} · ${t.appTitle}`);
      if (moveFocus) {
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
        window.scrollTo({ top: 0 });
      }
    };
    apply();
    return () => window.clearTimeout(timer);
  }, [pathname, mainId, fallbackTitle]);
}
