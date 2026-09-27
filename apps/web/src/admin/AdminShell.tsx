import { Fragment } from 'react';
import { Link, NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { rolesIn } from '../auth/claims';
import { ROLES } from '../generated/rbac';
import { paths } from '../paths';
import { t } from '../strings';
import { Icon } from '../ui';
import { visibleNav } from './nav';
import { useWorkspace, WorkspaceProvider } from './Workspace';

function BranchSwitcher() {
  const { myBranches, branch, setBranchId } = useWorkspace();
  if (myBranches.length === 0) return null;
  if (myBranches.length === 1) return <span className="org-name muted">· {branch?.name}</span>;
  return (
    <label className="org-switcher">
      <span className="sr-only">{t.branch}</span>
      <select value={branch?.id ?? ''} onChange={(e) => setBranchId(e.target.value)}>
        {myBranches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

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
          {visibleNav(claims, org?.id ?? null).map((item, i, all) => (
            <Fragment key={item.to}>
              {item.section && item.section !== all[i - 1]?.section && <span className="admin-nav-section">{item.section}</span>}
              <NavLink to={item.to} end={item.to === paths.admin} className="admin-nav-item">
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </Fragment>
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
          <BranchSwitcher />
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
