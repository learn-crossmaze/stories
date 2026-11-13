// My profile (account menu): one place for a staff member's job details, today, attendance, leave, payslips, documents and tasks.
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { employeeMonth } from '../../data/attendance';
import { monthIST, todayIST } from '../../shared/dates';
import { available, employeeRequests, leaveBalance, listLeaveTypes } from '../../data/leave';
import { employeePayslips, monthName } from '../../data/payroll';
import { onboardingChanged } from '../../data/selfOnboarding';
import { paths } from '../../paths';
import { Badge, EmptyState, ErrorState, NoOrgState, SkeletonRows } from '../../shared/ui';
import { rupees } from '../../shared/format';
import { useAsync } from '../../shared/useAsync';
import { ht } from '../../strings/hr';
import { useWorkspace } from '../Workspace';
import { EmployeeDocumentsPanel } from './EmployeeDocuments';
import { CheckInCard } from './MyAttendance';
import { useMyOnboarding, useMyOnboardingState } from './OnboardingReminder';
import { Checklist } from './employeePanels';
import { PayslipButton } from './payrollKit';
import { EmployeePhoto } from './EmployeePhoto';

const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

export function MyProfilePage() {
  const { user } = useAuth();
  const { org, branchName } = useWorkspace();
  // The person's own record and what is still missing come from the shell's one shared read (OnboardingProvider),
  // already loaded when this page opens; `changed` makes everything that shows them read again once.
  const me = useMyOnboardingState();
  const onboarding = useMyOnboarding();
  const e = me.data?.employee ?? null;
  const changed = onboardingChanged;
  const summary = useAsync(async () => {
    if (!org || !user || !e) return null;
    const year = todayIST().slice(0, 4);
    const own = { ownUid: user.uid };
    // Each part fails on its own (e.g. a page opened before payroll exists) without hiding the rest.
    const [days, types, balance, requests, slips] = await Promise.all([
      employeeMonth(org.id, e.id, monthIST(), own).catch(() => null),
      listLeaveTypes(org.id).catch(() => []),
      leaveBalance(org.id, e.id, year).catch(() => null),
      employeeRequests(org.id, e.id, year, own).catch(() => []),
      employeePayslips(org.id, e.id, own).catch(() => []),
    ]);
    const count = (s: string) => days?.filter((d) => d.status === s).length ?? 0;
    return {
      attendance: !days ? null : !days.length ? ht.noDaysYet : ht.myAttendanceSummary(count('PRESENT'), count('HALF_DAY'), count('ON_LEAVE'), count('ABSENT')),
      leave: types
        .filter((ty) => ty.status === 'ACTIVE' && !ty.unlimited && (ty.accrual !== 'MANUAL' || balance?.types[ty.id]))
        .map((ty) => `${ty.code} ${available(balance?.types[ty.id])}`)
        .join(' · '),
      waiting: requests.filter((r) => r.status === 'PENDING').length,
      latest: slips[0] ?? null,
    };
  }, [org?.id, e?.id]);

  if (!org) return <NoOrgState />;
  if (me.loading) return <SkeletonRows rows={5} />;
  // A background re-read that fails keeps the page; the next one tries again.
  if (me.error && !me.data) return <ErrorState message={me.error} onRetry={me.reload} />;
  if (!e) return <EmptyState page icon="person" title={ht.navMyProfile} message={ht.noEmployeeRecord} />;
  const s = summary.data;
  // While joining or leaving, the open checklist shows what is still to do.
  const checklist = e.status === 'ONBOARDING' && e.onboarding?.length ? 'onboarding' : e.status === 'OFFBOARDING' && e.offboarding?.length ? 'offboarding' : null;
  const facts: [string, string][] = [
    [ht.designation, e.designationName ?? '—'],
    [ht.department, e.departmentName ?? '—'],
    [ht.branch, e.branchId ? branchName(e.branchId) : ht.headOffice],
    [ht.manager, e.managerName ?? '—'],
    [ht.employmentTypeLabel, ht.employmentType[e.employmentType] ?? e.employmentType],
    [ht.joiningDate, e.joiningDate ?? '—'],
    [ht.workEmail, e.email ?? '—'],
    [ht.phone, e.phone || '—'],
  ];

  return (
    <>
      <header className="page-header page-header-row">
        <div className="profile-head">
          <EmployeePhoto orgId={org.id} employee={e} canEdit={e.status !== 'OFFBOARDED'} onChanged={changed} />
          <div>
          <h1>{e.fullName}</h1>
          <p className="muted">
            {e.code} · {e.designationName ?? ht.navMyProfile} <Badge tone="info">{ht.status[e.status] ?? e.status}</Badge>
          </p>
          </div>
        </div>
      </header>
      {!!onboarding.data?.missing.length && (
        <section className="card ob-profile-card" aria-labelledby="hub-ob">
          <h2 id="hub-ob">{ht.obTitle}</h2>
          <p>
            {ht.obProgress(onboarding.data.done, onboarding.data.total)} · {ht.obBanner(onboarding.data.missing.length)}
          </p>
          <Link className="btn btn-filled" to={paths.adminMyOnboarding}>
            {ht.obReminderNow}
          </Link>
        </section>
      )}
      {WORKING.includes(e.status) && <CheckInCard me={e} onPunched={summary.reload} />}

      <div className="hub-grid">
        <section className="card hub-card" aria-labelledby="hub-att">
          <h2 id="hub-att">{ht.myAttendanceCard}</h2>
          <span className="hub-value">{s ? (s.attendance ?? '—') : '…'}</span>
          <Link className="btn btn-text hub-link" to={paths.adminMyAttendance}>
            {ht.openPage(ht.navMyAttendance)}
          </Link>
        </section>
        <section className="card hub-card" aria-labelledby="hub-leave">
          <h2 id="hub-leave">{ht.myLeaveCard}</h2>
          <span className="hub-value">{s ? s.leave || '—' : '…'}</span>
          {!!s?.waiting && <span className="muted small">{ht.myLeaveWaiting(s.waiting)}</span>}
          <Link className="btn btn-text hub-link" to={paths.adminMyLeave}>
            {ht.openPage(ht.navMyLeave)}
          </Link>
        </section>
        <section className="card hub-card" aria-labelledby="hub-pay">
          <h2 id="hub-pay">{ht.myPayslipCard}</h2>
          {s?.latest ? (
            <>
              <span className="hub-value">
                {monthName(s.latest.month)} · {rupees(s.latest.net)}
              </span>
              <PayslipButton orgId={org.id} slip={s.latest} />
            </>
          ) : (
            <span className="muted">{s ? ht.noPayslipYet : '…'}</span>
          )}
          <Link className="btn btn-text hub-link" to={paths.adminMyPayslips}>
            {ht.openPage(ht.navMyPayslips)}
          </Link>
        </section>
      </div>

      <section className="section" aria-labelledby="hub-details">
        <h2 id="hub-details">{ht.myDetails}</h2>
        <dl className="facts">
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="section" aria-labelledby="hub-docs">
        <h2 id="hub-docs">{ht.myDocuments}</h2>
        <EmployeeDocumentsPanel orgId={org.id} employee={e} canManage={false} canVerify={false} onChanged={changed} />
      </section>

      {checklist && (
        <div className="section">
          <Checklist orgId={org.id} employee={e} list={checklist} editable={false} onChanged={changed} />
        </div>
      )}
    </>
  );
}
