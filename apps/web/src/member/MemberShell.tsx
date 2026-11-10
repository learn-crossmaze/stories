import { Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { homeViewFor, isStaff } from '../auth/claims';
import { env } from '../config/env';
import { paths, viewHome } from '../paths';
import { Icon, type IconName, SkeletonRows } from '../shared/ui';
import { useRouteFocus } from '../shared/useRouteFocus';
import { t } from '../strings';
import { MemberDataProvider } from './memberData';

const MAIN_ID = 'main';

const destinations: [string, IconName, string][] = [
  [paths.home, 'home', t.memberAreaAccount],
  [paths.explore, 'explore', t.navExplore],
  [paths.myBooks, 'book', t.navMyBooks],
  [paths.membership, 'card', t.navMembership],
  [paths.profile, 'person', t.navProfile],
];

/** The public website the member area is part of (same site: the member area is served at /account). */
const SITE = env.memberUrl.replace(/\/account$/, '');
const site = (path: string) => `${SITE}${path}`;

type SiteTheme = 'candy' | 'library';
const THEME_KEY = 'stories.siteTheme';
const readTheme = (): SiteTheme => (document.documentElement.dataset.theme === 'library' ? 'library' : 'candy');

/** The website's two looks; the choice is saved for the website and the member area alike. */
function ThemeSwitch() {
  const [theme, setTheme] = useState<SiteTheme>(readTheme);
  const choose = (next: SiteTheme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private windows: lasts for this visit only.
    }
    setTheme(next);
  };
  return (
    <div className="m-theme-switch" role="group" aria-label="Website look">
      <span>Look:</span>
      {(['candy', 'library'] as const).map((k) => (
        <button key={k} type="button" aria-pressed={theme === k} onClick={() => choose(k)}>
          {k === 'candy' ? 'Candy' : 'Reading room'}
        </button>
      ))}
    </div>
  );
}

/**
 * The member area's frame, in the website's look: the website header (with its main pages), the account's own
 * tabs, and the website footer. Staff see a link to their console.
 */
export function MemberShell() {
  const { claims, repo } = useAuth();
  useRouteFocus(MAIN_ID, t.memberAreaAccount);
  return (
    <div className="m-site">
      <a className="skip-link" href={`#${MAIN_ID}`}>
        {t.skipToContent}
      </a>
      <header className="m-header">
        <div className="m-wrap m-header-row">
          <a className="m-brand" href={site('/')} aria-label="Stories for All, website home">
            <img src="/account/icon-192.png" alt="" width="30" height="30" />
            <span className="m-wordmark">
              Stories <em>for all</em>
            </span>
          </a>
          <nav className="m-site-links" aria-label={t.memberAreaWebsite}>
            <a href={site('/books')}>Books</a>
            <a href={site('/plans')}>Plans</a>
            <a href={site('/branches')}>Branches</a>
            <a href={site('/how-it-works')}>How it works</a>
          </nav>
          <div className="m-header-actions">
            {isStaff(claims) && (
              <a className="m-btn m-btn-outlined" href={`${env.staffUrl}${viewHome[homeViewFor(claims)]}`}>
                <Icon name="console" /> {t.staffConsole}
              </a>
            )}
            <button type="button" className="m-btn m-btn-text" onClick={() => repo.signOut()}>
              {t.signOut}
            </button>
          </div>
        </div>
        <nav className="m-tabs" aria-label={t.mainMenu}>
          <div className="m-wrap m-tabs-row">
            {destinations.map(([to, icon, label]) => (
              <NavLink key={to} to={to} end className="m-tab">
                <Icon name={icon} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
      <main className="m-main m-wrap" id={MAIN_ID} tabIndex={-1}>
        <MemberDataProvider>
          <Suspense fallback={<SkeletonRows />}>
            <Outlet />
          </Suspense>
        </MemberDataProvider>
      </main>
      <footer className="m-footer">
        <div className="m-wrap m-footer-grid">
          <div>
            <p className="m-wordmark">
              Stories <em>for all</em>
            </p>
            <p className="m-footer-muted">Every book begins a new story.</p>
          </div>
          <nav aria-label="Library">
            <h2>Library</h2>
            <a href={site('/books')}>Trending and new books</a>
            <a href={site('/plans')}>Plans and prices</a>
            <a href={site('/branches')}>Branches and hours</a>
          </nav>
          <nav aria-label="Stories">
            <h2>Stories</h2>
            <a href={site('/how-it-works')}>How it works</a>
            <a href={site('/franchise')}>Open a franchise</a>
            <a href={site('/contact')}>Contact</a>
          </nav>
        </div>
        <div className="m-wrap m-legal">
          <p>© {new Date().getFullYear()} Stories for All · storiesforall.in</p>
          <ThemeSwitch />
        </div>
      </footer>
    </div>
  );
}
