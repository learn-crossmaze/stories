import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { rolesIn, type ViewId } from '../auth/claims';
import { ROLES } from '../generated/rbac';
import { paths, viewHome } from '../paths';
import { Icon, SkeletonRows } from '../shared/ui';
import { useRouteFocus } from '../shared/useRouteFocus';
import { t } from '../strings';
import { ht } from '../strings/hr';
import { availableViews, groupFor, isGroup, type NavEntry, navItemFor, VIEW_ICONS, visibleMenu } from './nav';
import { ViewContext } from './view';
import { NotificationBell } from './NotificationBell';
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

/** Name, roles and personal actions (my profile, appearance, member view, sign out) behind one button. */
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
          <Link to={paths.adminMe} onClick={() => setOpen(false)}>
            <Icon name="person" /> {ht.navMyProfile}
          </Link>
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

const OPEN_KEY = 'stories.menu.open';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** A view's menu: single pages, and groups that open and close (remembered on this device). */
function SideMenu({ entries }: { entries: NavEntry[] }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const current = groupFor(entries, pathname)?.id;
  // The most specific menu item for this page (so /ops/books/bulk marks "Add by ISBN", not also "Catalogue").
  const activeTo = navItemFor(pathname)?.to;
  const itemClass = (to: string, extra = '') => `admin-nav-item${extra}${to === activeTo ? ' active' : ''}`;
  // Arriving on a page opens its group.
  useEffect(() => {
    if (current) setOpen((o) => (o[current] ? o : { ...o, [current]: true }));
  }, [current]);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      // Private mode: the menu just doesn't remember.
    }
  }, [open]);

  return (
    <ul className="admin-nav-list">
      {entries.map((e) => {
        if (!isGroup(e)) {
          return (
            <li key={e.to}>
              <Link to={e.to} className={itemClass(e.to)} aria-current={e.to === activeTo ? 'page' : undefined}>
                <Icon name={e.icon} />
                <span>{e.label}</span>
              </Link>
            </li>
          );
        }
        const isOpen = !!open[e.id];
        const listId = `menu-${e.id}`;
        return (
          <li key={e.id}>
            <button
              type="button"
              className={`admin-nav-item nav-group-toggle${e.id === current ? ' has-active' : ''}`}
              aria-expanded={isOpen}
              aria-controls={listId}
              onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}
            >
              <Icon name={e.icon} />
              <span>{e.label}</span>
              <span className="nav-caret" aria-hidden="true">
                <Icon name="expand" />
              </span>
            </button>
            <ul id={listId} className="nav-sub" hidden={!isOpen}>
              {e.items.map((i) => (
                <li key={i.to}>
                  <Link to={i.to} className={itemClass(i.to, ' nav-sub-item')} aria-current={i.to === activeTo ? 'page' : undefined}>
                    <span>{i.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** Switches between the views this person can use, and the member app. */
function ViewSwitcher({ view }: { view: ViewId }) {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  const views = availableViews(claims, org?.id ?? null);
  return (
    <nav className="view-switch" aria-label={t.views}>
      {views.map((v) => (
        <Link key={v} to={viewHome[v]} className={v === view ? 'view-pill active' : 'view-pill'} aria-current={v === view ? 'true' : undefined}>
          <Icon name={VIEW_ICONS[v]} />
          <span>{t.viewNames[v]}</span>
        </Link>
      ))}
      <Link to={paths.home} className="view-pill">
        <Icon name={VIEW_ICONS.member} />
        <span>{t.viewNames.member}</span>
      </Link>
    </nav>
  );
}

function Shell({ view }: { view: ViewId }) {
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
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const entries = visibleMenu(claims, org?.id ?? null, view);
  const home = viewHome[view];
  return (
    <ViewContext.Provider value={view}>
      <div className={`admin${menuOpen ? ' admin-menu-open' : ''}`}>
        <a className="skip-link" href={`#${MAIN_ID}`}>
          {t.skipToContent}
        </a>
        <aside className="admin-nav" id="admin-menu" ref={drawer} aria-label={t.staffConsole}>
          <div className="admin-nav-top">
            <Link to={home} className="admin-brand">
              <Icon name="book" />
              <span>{t.appTitle}</span>
            </Link>
            <button type="button" className="btn btn-text btn-icon admin-menu-close" onClick={() => setMenuOpen(false)} aria-label={t.closeMenu}>
              <Icon name="close" />
            </button>
          </div>
          <ViewSwitcher view={view} />
          <nav aria-label={`${t.mainMenu}: ${t.viewNames[view]}`}>
            <SideMenu entries={entries} />
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
            <Link to={home} className="admin-brand admin-brand-compact">
              <Icon name="book" />
              <span>{t.appTitle}</span>
            </Link>
            <WorkspaceBar />
            <NotificationBell />
            <AccountMenu />
          </header>
          <main className="admin-main" id={MAIN_ID} tabIndex={-1}>
            <Suspense fallback={<SkeletonRows />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </ViewContext.Provider>
  );
}

export function AdminShell({ view }: { view: ViewId }) {
  return (
    <WorkspaceProvider>
      <Shell view={view} />
    </WorkspaceProvider>
  );
}
