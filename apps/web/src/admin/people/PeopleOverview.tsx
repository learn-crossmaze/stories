// People → Overview: headcount, today, what is waiting, and this month at a glance (scoped to the viewer's branches).
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { dayRecords, monthIST, pendingCorrections, todayIST } from '../../data/attendance';
import { listEmployees } from '../../data/hr';
import { documentQueue, listDocumentTypes } from '../../data/hrDocuments';
import { approvedLeaveIn, daysLabel, pendingLeave } from '../../data/leave';
import { approvedRuns, money, monthName, submittedRuns } from '../../data/payroll';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Stat } from '../components/kit';
import { useWorkspace } from '../Workspace';

const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

/** A labelled bar per row: the text carries the number, the bar only shows proportion. */
function Bars({ rows, label }: { rows: { name: string; value: number; text?: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name}>
          <span className="bar-label">{r.name}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{r.text ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

const tally = (names: string[]) => {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
};

export function PeopleOverviewPage() {
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const orgId = org?.id ?? '';
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const may = (p: Permission) => !!org && can(claims, p, org.id);
  const month = monthIST();
  const notMine = <T extends { employeeUid?: string | null }>(xs: T[] | null) => xs?.filter((x) => x.employeeUid !== user?.uid).length ?? 0;

  const data = useAsync(async () => {
    if (!org) return null;
    const optional = <T,>(ok: boolean, load: () => Promise<T>) => (ok ? load().catch(() => null) : Promise.resolve(null));
    const [people, today, leave, corrections, docs, runs, away, paid] = await Promise.all([
      listEmployees(orgId, scope),
      optional(may('attendance.view'), () => dayRecords(orgId, todayIST(), scope)),
      optional(may('leave.approve'), () => pendingLeave(orgId, scope)),
      optional(may('corrections.approve'), () => pendingCorrections(orgId, scope)),
      optional(may('documents.verify'), async () => documentQueue(orgId, scope, await listDocumentTypes(orgId))),
      optional(may('payroll.approve'), () => submittedRuns(orgId, scope)),
      optional(may('attendance.view'), () => approvedLeaveIn(orgId, month, scope)),
      optional(may('salary.view'), () => approvedRuns(orgId, scope)),
    ]);
    return { people, today, leave, corrections, docs, runs, away, paid };
  }, [orgId, JSON.stringify(scope)]);

  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  if (data.loading && !data.data) return <SkeletonRows rows={6} />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />;
  const d = data.data;

  const working = d.people.filter((p) => WORKING.includes(p.status));
  const count = (...s: string[]) => d.people.filter((p) => s.includes(p.status)).length;
  const records = new Map((d.today ?? []).map((r) => [r.employeeId, r]));
  const onLeave = working.filter((p) => records.get(p.id)?.status === 'ON_LEAVE').length;
  const checkedIn = working.filter((p) => records.get(p.id)?.checkIn).length;

  const waiting = [
    { n: notMine(d.leave), label: ht.todoLeave, to: paths.adminLeave },
    { n: notMine(d.corrections), label: ht.todoCorrections, to: paths.adminAttendance },
    { n: d.docs?.pending.filter((x) => x.uploadedBy !== user?.uid).length ?? 0, label: ht.todoDocsPending, to: paths.adminDocuments },
    { n: d.runs?.filter((r) => r.preparedBy !== user?.uid && r.submittedBy !== user?.uid).length ?? 0, label: ht.todoPayroll, to: paths.adminPayroll },
  ].filter((w) => w.n > 0);

  // Leave days that fall in this month, by type.
  const leaveByType = new Map<string, number>();
  for (const r of d.away ?? []) {
    const inMonth = r.dates.filter((x) => x.startsWith(month)).length * (r.halfDay === 'NONE' ? 1 : 0.5);
    leaveByType.set(r.typeName, (leaveByType.get(r.typeName) ?? 0) + inMonth);
  }
  const leaveRows = [...leaveByType.entries()].map(([name, value]) => ({ name, value, text: daysLabel(value) })).sort((a, b) => b.value - a.value);

  const lastMonth = d.paid?.[0]?.month ?? null;
  const lastRuns = d.paid?.filter((r) => r.month === lastMonth) ?? [];
  const sum = (k: 'net' | 'gross' | 'employerCost') => lastRuns.reduce((n, r) => n + r.totals[k], 0);

  return (
    <>
      <header className="page-header">
        <h1>{ht.navOverview}</h1>
        <p className="muted">{ht.overviewIntro}</p>
      </header>

      <section aria-labelledby="ov-headcount">
        <h2 id="ov-headcount">{ht.headcount}</h2>
        <div className="stats">
          <Stat value={count('ACTIVE')} label={ht.statActive} to={paths.adminPeople} />
          <Stat value={count('ONBOARDING')} label={ht.statOnboarding} />
          <Stat value={count('NOTICE_PERIOD', 'OFFBOARDING')} label={ht.statLeaving} />
          <Stat value={d.people.filter((p) => p.joiningDate?.startsWith(month)).length} label={ht.statJoined} />
          <Stat value={d.people.filter((p) => p.exitDate?.startsWith(month)).length} label={ht.statLeft} />
        </div>
      </section>

      {d.today && (
        <section className="section" aria-labelledby="ov-today">
          <h2 id="ov-today">{ht.today}</h2>
          <div className="stats">
            <Stat value={checkedIn} label={ht.todayIn} to={paths.adminAttendance} />
            <Stat value={onLeave} label={ht.todayOnLeave} to={paths.adminLeave} />
            <Stat value={Math.max(0, working.length - checkedIn - onLeave)} label={ht.todayNotIn} to={paths.adminAttendance} />
          </div>
        </section>
      )}

      <div className="overview-grid">
        <section className="card" aria-labelledby="ov-waiting">
          <h2 id="ov-waiting">{ht.waitingOnYou}</h2>
          {waiting.length ? (
            <ul className="todo-list">
              {waiting.map((w) => (
                <li key={w.to}>
                  <Link to={w.to}>
                    <span>{w.label(w.n)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{ht.nothingWaiting}</p>
          )}
        </section>

        <section className="card" aria-labelledby="ov-branch">
          <h2 id="ov-branch">{ht.byBranch}</h2>
          <Bars label={ht.byBranch} rows={tally(working.map((p) => (p.branchId ? branchName(p.branchId) : ht.headOffice)))} />
        </section>

        <section className="card" aria-labelledby="ov-dept">
          <h2 id="ov-dept">{ht.byDepartment}</h2>
          <Bars label={ht.byDepartment} rows={tally(working.map((p) => p.departmentName ?? ht.noDepartment))} />
        </section>

        {d.away && (
          <section className="card" aria-labelledby="ov-leave">
            <h2 id="ov-leave">{ht.leaveThisMonth(monthName(month))}</h2>
            {leaveRows.length ? <Bars label={ht.leaveThisMonth(monthName(month))} rows={leaveRows} /> : <p className="muted">{ht.noLeaveThisMonth}</p>}
          </section>
        )}

        {d.paid && (
          <section className="card" aria-labelledby="ov-pay">
            <h2 id="ov-pay">{ht.lastPayroll}</h2>
            {lastMonth ? (
              <>
                <p className="muted small">{ht.payrollSummary(monthName(lastMonth), lastRuns.map((r) => (r.branchId ? branchName(r.branchId) : ht.headOffice)).join(', '))}</p>
                <dl className="run-summary">
                  <div>
                    <dt>{ht.totalsGross}</dt>
                    <dd>{money(sum('gross'))}</dd>
                  </div>
                  <div>
                    <dt>{ht.totalsNet}</dt>
                    <dd>{money(sum('net'))}</dd>
                  </div>
                  <div>
                    <dt>{ht.totalsEmployerCost}</dt>
                    <dd>{money(sum('employerCost'))}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="muted">{ht.noApprovedPayroll}</p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
