import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { rolesIn } from '../auth/claims';
import { ROLES } from '../generated/rbac';
import { paths } from '../paths';
import { Icon } from '../shared/ui';
import { useRouteFocus } from '../shared/useRouteFocus';
import { t } from '../strings';
import { navSections, visibleNav } from './nav';
import { useWorkspace, WorkspaceProvider } from './Workspace';

const MAIN_ID = 'main';

/** Where the user is working: organization and branch, each switchable when there is a choice. */
function WorkspaceBar() {
  const { orgs, org, setOrgId, myBranches, branch, setBranchId } = useWorkspace();
  return (
    <div className="workspace" aria-label={t.workspace} role="group">
      {orgs.length > 1 ? (
        <label className="workspace-field">
          <span className="workspace-label">{t.organization}</span>
          <select value={org?.id ?? ''} onChange={(e) => setOrgId(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        org && (
          <span className="workspace-field">
            <span className="workspace-label">{t.organization}</span>
            <span className="workspace-value">{org.name}</span>
          </span>
        )
      )}
      {myBranches.length > 1 ? (
        <label className="workspace-field">
          <span className="workspace-label">{t.branch}</span>
          <select value={branch?.id ?? ''} onChange={(e) => setBranchId(e.target.value)}>
            {myBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        branch && (
          <span className="workspace-field">
            <span className="workspace-label">{t.branch}</span>
            <span className="workspace-value">{branch.name}</span>
          </span>
        )
      )}
    </div>
  );
}

/** Name, roles and personal actions (appearance, member view, sign out) behind one button. */
function AccountMenu() {
  const { user, claims, repo } = useAuth();
  const { org } = useWorkspace();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const roles = claims.sa ? [ROLES.SUPER_ADMIN.label] : org ? rolesIn(claims, org.id).map((r) => ROLES[r].label) : [];
  const name = user?.displayName || user?.email || '';
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('.account-menu a, .account-menu button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${t.accountMenu}: ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="account-text">
          <span className="account-name">{name}</span>
          <span className="account-roles">{roles.join(' · ')}</span>
        </span>
        <Icon name="expand" />
      </button>
      {open && (
        <div className="account-menu" id={menuId}>
          <Link to={paths.adminAppearance} onClick={() => setOpen(false)}>
            <Icon name="palette" /> {t.navAppearance}
          </Link>
          <Link to={paths.home} onClick={() => setOpen(false)}>
            <Icon name="home" /> {t.memberView}
          </Link>
          <button type="button" onClick={() => repo.signOut()}>
            <Icon name="logout" /> {t.signOut}
          </button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  useRouteFocus(MAIN_ID, t.staffConsole);

  // The phone menu closes after choosing a page, and on Escape.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const sections = navSections(visibleNav(claims, org?.id ?? null));
  return (
    <div className={`admin${menuOpen ? ' admin-menu-open' : ''}`}>
      <a className="skip-link" href={`#${MAIN_ID}`}>
        {t.skipToContent}
      </a>
      <aside className="admin-nav" id="admin-menu" ref={drawer} aria-label={t.staffConsole}>
        <div className="admin-nav-top">
          <Link to={paths.admin} className="admin-brand">
            <Icon name="book" />
            <span>{t.appTitle}</span>
          </Link>
          <button type="button" className="btn btn-text btn-icon admin-menu-close" onClick={() => setMenuOpen(false)} aria-label={t.closeMenu}>
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label={t.mainMenu}>
          {sections.map(({ section, items }) => (
            <div key={section ?? 'top'} className="admin-nav-group" role={section ? 'group' : undefined} aria-label={section ?? undefined}>
              {section && (
                <span className="admin-nav-section" aria-hidden="true">
                  {section}
                </span>
              )}
              {items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === paths.admin} className="admin-nav-item">
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="admin-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className="admin-body">
        <header className="admin-header">
          <button
            ref={menuButton}
            type="button"
            className="btn btn-text btn-icon admin-menu-button"
            aria-expanded={menuOpen}
            aria-controls="admin-menu"
            aria-label={t.openMenu}
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <Link to={paths.admin} className="admin-brand admin-brand-compact">
            <Icon name="book" />
            <span>{t.appTitle}</span>
          </Link>
          <WorkspaceBar />
          <AccountMenu />
        </header>
        <main className="admin-main" id={MAIN_ID} tabIndex={-1}>
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
