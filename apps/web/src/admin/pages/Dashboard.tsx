import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { listStaff } from '../../data/org';
import { useAsync } from '../../data/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { Icon, SkeletonRows } from '../../ui';
import { useWorkspace } from '../Workspace';

interface Todo {
  label: string;
  to: string;
}

/**
 * Phase 0 dashboard: answers "what do I need to do now?" from real data.
 * Module dashboards (circulation, tasks, HR…) add their own items later.
 */
export function DashboardPage() {
  const { claims, user } = useAuth();
  const { org, orgs, orgsLoading, branches, branchesLoading } = useWorkspace();
  const staffVisible = !!org && can(claims, 'staff.view', org.id);
  const staff = useAsync(
    () => (org && staffVisible ? listStaff(org.id, branchScope(claims, org.id)) : Promise.resolve(null)),
    [org?.id, staffVisible],
  );

  if (orgsLoading || branchesLoading) return <SkeletonRows rows={3} />;

  const activeBranches = branches.filter((b) => b.status === 'ACTIVE');
  const activeStaff = staff.data?.filter((m) => m.status === 'ACTIVE') ?? null;
  const todos: Todo[] = [];
  if (user && !user.emailVerified) todos.push({ label: t.todoVerifyEmail, to: paths.setup });
  if (claims.sa && orgs.length === 0) todos.push({ label: t.todoCreateOrg, to: paths.adminOrgs });
  if (org && can(claims, 'branches.manage', org.id) && activeBranches.length === 0) {
    todos.push({ label: t.todoCreateBranch, to: paths.adminBranches });
  }
  if (org && can(claims, 'staff.manageRoles', org.id) && activeStaff && activeStaff.length <= 1) {
    todos.push({ label: t.todoAddStaff, to: paths.adminStaff });
  }

  return (
    <>
      <header className="page-header">
        <h1>{org?.name ?? t.consoleTitle}</h1>
        <p className="muted">{t.dashboardTitle}</p>
      </header>
      <section className="card">
        {todos.length === 0 ? (
          <p className="all-clear">
            <Icon name="check" /> {t.dashboardAllClear}
          </p>
        ) : (
          <ul className="todo-list">
            {todos.map((todo) => (
              <li key={todo.label}>
                <Link to={todo.to}>
                  <Icon name="alert" />
                  <span>{todo.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {org && (
        <section className="stats" aria-label="Summary">
          <div className="stat">
            <span className="stat-value">{activeBranches.length}</span>
            <span className="stat-label">{t.navBranches}</span>
          </div>
          {activeStaff && (
            <div className="stat">
              <span className="stat-value">{activeStaff.length}</span>
              <span className="stat-label">{t.navStaff}</span>
            </div>
          )}
        </section>
      )}
    </>
  );
}
