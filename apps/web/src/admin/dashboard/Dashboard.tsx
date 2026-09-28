import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { branchCounts } from '../../data/circulation';
import { listStaff } from '../../data/org';
import { useAsync } from '../../shared/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { Icon, SkeletonRows } from '../../shared/ui';
import { Stat } from '../components/kit';
import { lt } from '../../strings/library';
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
  const { org, orgs, orgsLoading, branches, branchesLoading, branch, myBranches } = useWorkspace();
  const staffVisible = !!org && can(claims, 'staff.view', org.id);
  const staff = useAsync(
    () => (org && staffVisible ? listStaff(org.id, branchScope(claims, org.id)) : Promise.resolve(null)),
    [org?.id, staffVisible],
  );

  const desk = !!org && !!branch && can(claims, 'members.view', org.id, branch.id);
  const approver = !!org && can(claims, 'deposits.approve', org.id);
  const counts = useAsync(
    () => (org && branch && desk ? branchCounts(org.id, branch.id, approver, branchScope(claims, org.id)) : Promise.resolve(null)),
    [org?.id, branch?.id, desk, approver],
  );

  if (orgsLoading || branchesLoading) return <SkeletonRows rows={3} />;

  const activeBranches = branches.filter((b) => b.status === 'ACTIVE');
  // Branch staff count only the branches they work at.
  const shownBranches = org && branchScope(claims, org.id) === 'ALL' ? activeBranches : myBranches;
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
  const c = counts.data;
  if (c?.inspection) todos.push({ label: `${c.inspection} ${lt.awaitingInspection.toLowerCase()}`, to: paths.adminDesk });
  if (c?.incoming) todos.push({ label: `${c.incoming} ${lt.incomingTransfers.toLowerCase()}`, to: paths.adminTransfers });
  if (c?.approvals) todos.push({ label: `${c.approvals} ${lt.approvalsPending.toLowerCase()}`, to: paths.adminDeposits });

  return (
    <>
      <header className="page-header">
        <h1>{org?.name ?? t.consoleTitle}{branch && <span className="muted"> · {branch.name}</span>}</h1>
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
      {c && (
        <section className="stats" aria-label={lt.deskTitle}>
          <Stat value={c.issuedToday} label={lt.issuedToday} to={paths.adminDesk} />
          <Stat value={c.exchangesToday} label={lt.exchangesToday} to={paths.adminDesk} />
          <Stat value={c.inspection} label={lt.awaitingInspection} to={paths.adminDesk} />
          <Stat value={c.holds} label={lt.holdsReady} to={paths.adminReservations} />
          <Stat value={c.waiting} label={lt.waitingReservations} to={paths.adminReservations} />
          <Stat value={c.incoming} label={lt.incomingTransfers} to={paths.adminTransfers} />
        </section>
      )}
      {org && (
        <section className="stats" aria-label="Summary">
          <div className="stat">
            <span className="stat-value">{shownBranches.length}</span>
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
