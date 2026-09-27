import { Link, NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { rolesIn } from '../auth/claims';
import { ROLES } from '../generated/rbac';
import { paths } from '../paths';
import { t } from '../strings';
import { Icon } from '../ui';
import { visibleNav } from './nav';
import { useWorkspace, WorkspaceProvider } from './Workspace';

function OrgSwitcher() {
  const { orgs, org, setOrgId } = useWorkspace();
  if (orgs.length === 0) return null;
  if (orgs.length === 1) return <span className="org-name">{org?.name}</span>;
  return (
    <label className="org-switcher">
      <span className="sr-only">{t.organization}</span>
      <select value={org?.id ?? ''} onChange={(e) => setOrgId(e.target.value)}>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Shell() {
  const { user, claims, repo } = useAuth();
  const { org } = useWorkspace();
  const roles = claims.sa ? [ROLES.SUPER_ADMIN.label] : org ? rolesIn(claims, org.id).map((r) => ROLES[r].label) : [];
  return (
    <div className="admin">
      <aside className="admin-nav">
        <Link to={paths.admin} className="admin-brand">
          <Icon name="book" />
          <span>{t.appTitle}</span>
        </Link>
        <nav aria-label={t.staffConsole}>
          {visibleNav(claims, org?.id ?? null).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === paths.admin} className="admin-nav-item">
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <Link to={paths.home} className="admin-nav-item admin-nav-foot">
          <Icon name="home" />
          <span>{t.memberView}</span>
        </Link>
      </aside>
      <div className="admin-body">
        <header className="admin-header">
          <OrgSwitcher />
          <div className="admin-user">
            <span className="admin-user-name">{user?.displayName ?? user?.email}</span>
            <span className="muted admin-user-roles">{roles.join(' · ')}</span>
          </div>
          <button type="button" className="btn btn-text" onClick={() => repo.signOut()}>
            {t.signOut}
          </button>
        </header>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AdminShell() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
