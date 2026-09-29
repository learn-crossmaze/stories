import { NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { homeViewFor, isStaff } from '../auth/claims';
import { paths, viewHome } from '../paths';
import { Icon, type IconName } from '../shared/ui';
import { useRouteFocus } from '../shared/useRouteFocus';
import { t } from '../strings';
import { MemberDataProvider } from './memberData';

const MAIN_ID = 'main';

const destinations: [string, IconName, string][] = [
  [paths.home, 'home', t.navHome],
  [paths.explore, 'explore', t.navExplore],
  [paths.myBooks, 'book', t.navMyBooks],
  [paths.membership, 'card', t.navMembership],
  [paths.profile, 'person', t.navProfile],
];

/** Member navigation: bottom bar on phones, side rail on wider screens (CSS). */
export function MemberShell() {
  const { claims } = useAuth();
  useRouteFocus(MAIN_ID, t.appTitle);
  return (
    <div className="shell">
      <a className="skip-link" href={`#${MAIN_ID}`}>
        {t.skipToContent}
      </a>
      <nav className="shell-nav" aria-label={t.mainMenu}>
        <span className="shell-logo" aria-hidden="true">
          <Icon name="book" />
        </span>
        {destinations.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end className="nav-item">
            <Icon name={icon} />
            <span>{label}</span>
          </NavLink>
        ))}
        {isStaff(claims) && (
          <NavLink to={viewHome[homeViewFor(claims)]} className="nav-item nav-item-staff">
            <Icon name="console" />
            <span>{t.staffConsole}</span>
          </NavLink>
        )}
      </nav>
      <main className="shell-main" id={MAIN_ID} tabIndex={-1}>
        <MemberDataProvider>
          <Outlet />
        </MemberDataProvider>
      </main>
    </div>
  );
}
