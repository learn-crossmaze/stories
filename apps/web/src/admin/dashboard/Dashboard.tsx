import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { branchCounts } from '../../data/circulation';
import { monthIST, monthLock, pendingCorrections, previousMonth } from '../../data/attendance';
import { documentQueue, listDocumentTypes } from '../../data/hrDocuments';
import { pendingLeave } from '../../data/leave';
import { submittedRuns } from '../../data/payroll';
import { CheckInCard } from '../people/MyAttendance';
import { listStaff } from '../../data/org';
import { ht } from '../../strings/hr';
import { useAsync } from '../../shared/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { Icon, SkeletonRows } from '../../shared/ui';
import { Stat } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';
import { useTeamPaths } from '../view';

const approverOk = <T,>(ok: boolean, load: () => Promise<T>) => (ok ? load() : Promise.resolve(null));

const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

interface Todo {
  label: string;
  to: string;
}

/**
 * Phase 0 dashboard: answers "what do I need to do now?" from real data.
 * Module dashboards (circulation, tasks, HR…) add their own items later.
 */
export function DashboardPage() {
  const team = useTeamPaths();
  const { claims, user } = useAuth();
  const { org, orgs, orgsLoading, branches, branchesLoading, branch, myBranches } = useWorkspace();
  const staffVisible = !!org && can(claims, 'staff.view', org.id);
  const staff = useAsync(() => (org && staffVisible ? listStaff(org.id, branchScope(claims, org.id)) : Promise.resolve(null)), [org?.id, staffVisible]);

  const desk = !!org && !!branch && can(claims, 'members.view', org.id, branch.id);
  const approver = !!org && can(claims, 'deposits.approve', org.id);
  const counts = useAsync(
    () => (org && branch && desk ? branchCounts(org.id, branch.id, approver, branchScope(claims, org.id)) : Promise.resolve(null)),
    [org?.id, branch?.id, desk, approver],
  );

  const verifier = !!org && can(claims, 'documents.verify', org.id);
  const docs = useAsync(async () => {
    if (!org || !verifier) return null;
    return documentQueue(org.id, branchScope(claims, org.id), await listDocumentTypes(org.id));
  }, [org?.id, verifier]);

  const correctionsApprover = !!org && can(claims, 'corrections.approve', org.id);
  const finalizer = !!org && !!branch && can(claims, 'attendance.finalize', org.id, branch.id);
  const leaveApprover = !!org && can(claims, 'leave.approve', org.id);
  const payrollApprover = !!org && can(claims, 'payroll.approve', org.id);
  const att = useAsync(async () => {
    if (!org) return null;
    const scope = branchScope(claims, org.id);
    const [corrections, lock, leave, runs] = await Promise.all([
      approverOk(correctionsApprover, () => pendingCorrections(org.id, scope)),
      finalizer && branch ? monthLock(org.id, previousMonth(monthIST()), branch.id) : Promise.resolve(undefined),
      approverOk(leaveApprover, () => pendingLeave(org.id, scope)),
      approverOk(payrollApprover, () => submittedRuns(org.id, scope)),
    ]);
    return {
      corrections: corrections?.filter((c) => c.employeeUid !== user?.uid).length ?? 0,
      unfinalized: lock !== undefined && lock?.status !== 'FINALIZED',
      leave: leave?.filter((r) => r.employeeUid !== user?.uid).length ?? 0,
      payroll: runs?.filter((r) => r.preparedBy !== user?.uid && r.submittedBy !== user?.uid).length ?? 0,
    };
  }, [org?.id, branch?.id, correctionsApprover, finalizer, leaveApprover, payrollApprover]);

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
  const d = docs.data;
  if (d?.pending.length) todos.push({ label: ht.todoDocsPending(d.pending.length), to: paths.adminDocuments });
  if (d?.expired.length) todos.push({ label: ht.todoDocsExpired(d.expired.length), to: paths.adminDocuments });
  if (d?.expiring.length) todos.push({ label: ht.todoDocsExpiring(d.expiring.length), to: paths.adminDocuments });
  if (att.data?.corrections) todos.push({ label: ht.todoCorrections(att.data.corrections), to: team.attendance });
  if (att.data?.payroll) todos.push({ label: ht.todoPayroll(att.data.payroll), to: paths.adminPayroll });
  if (att.data?.leave) todos.push({ label: ht.todoLeave(att.data.leave), to: team.leave });
  if (att.data?.unfinalized) todos.push({ label: ht.todoFinalize(previousMonth(monthIST())), to: team.attendance });
  if (c?.approvals) todos.push({ label: `${c.approvals} ${lt.approvalsPending.toLowerCase()}`, to: paths.adminDeposits });

  const firstName = (user?.displayName ?? '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;
  const orgWide = !!org && branchScope(claims, org.id) === 'ALL';

  return (
    <>
      <header className="page-header">
        <h1>{t.navDashboard}</h1>
        <p className="muted">
          {firstName ? `${greeting}, ${firstName}` : greeting} · {today.format(new Date())}
        </p>
      </header>

      <CheckInCard compact />

      <section className="section" aria-labelledby="dash-attention">
        <h2 id="dash-attention">{t.dashboardAttention}</h2>
        <div className="card">
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
        </div>
      </section>

      {c && branch && (
        <section className="section" aria-labelledby="dash-today">
          <h2 id="dash-today">{t.dashboardToday(branch.name)}</h2>
          <div className="stats">
            <Stat value={c.issuedToday} label={lt.issuedToday} to={paths.adminDesk} />
            <Stat value={c.exchangesToday} label={lt.exchangesToday} to={paths.adminDesk} />
            <Stat value={c.holds} label={lt.holdsReady} to={paths.adminReservations} />
            <Stat value={c.waiting} label={lt.waitingReservations} to={paths.adminReservations} />
            <Stat value={c.inspection} label={lt.awaitingInspection} to={paths.adminInventory} />
            <Stat value={c.incoming} label={lt.incomingTransfers} to={paths.adminTransfers} />
          </div>
        </section>
      )}

      {org && (orgWide || activeStaff) && (
        <section className="section" aria-labelledby="dash-org">
          <h2 id="dash-org">{org.name}</h2>
          <div className="stats">
            <Stat value={shownBranches.length} label={t.navBranches} to={paths.adminBranches} />
            {activeStaff && <Stat value={activeStaff.length} label={t.dashboardStaffWithAccess} to={paths.adminStaff} />}
          </div>
        </section>
      )}
    </>
  );
}
