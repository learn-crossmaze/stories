import { NavLink, Outlet } from 'react-router';

import { paths } from '../paths';
import { t } from '../strings';
import { Icon, type IconName } from '../ui';

const destinations: [string, IconName, string][] = [
  [paths.home, 'home', t.navHome],
  [paths.explore, 'explore', t.navExplore],
  [paths.myBooks, 'book', t.navMyBooks],
  [paths.orders, 'truck', t.navOrders],
  [paths.profile, 'person', t.navProfile],
];

/** Member navigation: bottom bar on phones, side rail on wider screens (CSS). */
export function MemberShell() {
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Main">
        <span className="shell-logo" aria-hidden="true">
          <Icon name="book" />
        </span>
        {destinations.map(([to, icon, label]) => (
          <NavLink key={to} to={to} end className="nav-item">
            <Icon name={icon} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
