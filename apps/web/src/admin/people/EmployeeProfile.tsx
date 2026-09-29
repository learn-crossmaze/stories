import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { getEmployee, getPrivateProfile, listHistory, NEXT_STEPS, type PrivateProfile, type Transition } from '../../data/hr';
import { useAsync } from '../../shared/useAsync';
import { day, when } from '../../shared/format';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui';
import { ht } from '../../strings/hr';
import { Notice, Tabs } from '../components/kit';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';
import { EmployeeAttendancePanel } from './EmployeeAttendance';
import { EmployeeLeavePanel } from './EmployeeLeave';
import { EmployeeSalaryPanel } from './EmployeeSalary';
import { EmployeeDocumentsPanel } from './EmployeeDocuments';
import { EmployeeOffersPanel } from './OfferLetters';
import { EmployeeDialog, EmployeeStatusBadge } from './People';
import { PersonalDialog, TransitionDialog } from './employeeDialogs';
import { AccessPanel, BankPanel, Checklist, Fact } from './employeePanels';

type Tab = 'overview' | 'personal' | 'documents' | 'offers' | 'attendance' | 'leave' | 'salary' | 'bank' | 'lifecycle' | 'history' | 'access';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : (ht.status[String(v)] ?? ht.employmentType[String(v)] ?? String(v)));

export function EmployeeProfilePage() {
  const { employeeId = '' } = useParams();
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const orgId = org?.id ?? '';
  const employee = useAsync(() => (orgId ? getEmployee(orgId, employeeId) : Promise.resolve(null)), [orgId, employeeId]);
  const e = employee.data;
  // Records without a branch (head office) need the permission across all branches.
  const perm = (p: Permission) => !!e && (e.branchId ? can(claims, p, orgId, e.branchId) : can(claims, p, orgId) && branchScope(claims, orgId) === 'ALL');
  const canPrivate = !!e && perm('employees.privateData');
  const canBank = !!e && perm('employees.bank');
  const profile = useAsync(
    () => (e && (canPrivate || canBank) ? getPrivateProfile(orgId, e.id) : Promise.resolve({} as PrivateProfile)),
    [orgId, e?.id, canPrivate, canBank],
  );
  const history = useAsync(() => (e ? listHistory(orgId, e.id) : Promise.resolve([])), [orgId, e?.id, employee.data]);
  // ?tab=access (from Roles & access) opens a tab directly.
  const [search] = useSearchParams();
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab | null) ?? 'overview');
  const [dialog, setDialog] = useState<'edit' | 'personal' | Transition | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  if (employee.loading && !employee.data) return <SkeletonRows rows={5} />;
  if (employee.error) return <ErrorState message={employee.error} onRetry={employee.reload} />;
  if (!e) return <EmptyState icon="person" title={t.notFoundTitle} message="" />;

  const canEdit = perm('employees.edit') && e.status !== 'OFFBOARDED';
  const canLifecycle = perm('employees.lifecycle');
  const canVerifyDocs = perm('documents.verify');
  const canManageDocs = canVerifyDocs || perm('employees.edit');
  const self = !!e.uid && e.uid === user?.uid;
  const canViewAttendance = perm('attendance.view');
  const canManageAttendance = perm('attendance.manage');
  const refresh = () => {
    employee.reload();
    profile.reload();
  };
  const p = profile.data ?? {};
  const openList = e.status === 'ONBOARDING' ? 'onboarding' : e.status === 'OFFBOARDING' ? 'offboarding' : null;

  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminPeople}>{ht.employeesTitle}</Link> / <span className="mono">{e.code}</span>
      </p>
      <header className="page-header page-header-row">
        <div>
          <h1>{e.fullName}</h1>
          <p className="muted">
            <span className="mono">{e.code}</span> · {e.designationName ?? ht.notSet} · {e.branchId ? branchName(e.branchId) : ht.headOffice}
          </p>
          {e.status === 'NOTICE_PERIOD' && e.noticeEndDate && <p>{ht.noticeUntil(e.noticeEndDate)}</p>}
          {(e.status === 'OFFBOARDING' || e.status === 'OFFBOARDED') && e.exitDate && <p>{ht.exitOn(e.exitDate)}</p>}
        </div>
        <div className="row">
          <EmployeeStatusBadge status={e.status} />
          {canEdit && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('edit')}>
              {ht.editDetails}
            </button>
          )}
        </div>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview' as const, label: ht.tabOverview },
          ...(canPrivate || e.uid === user?.uid ? [{ value: 'personal' as const, label: ht.tabPersonal }] : []),
          ...(canManageDocs || self ? [{ value: 'documents' as const, label: ht.tabDocuments }] : []),
          ...(perm('offers.release') ? [{ value: 'offers' as const, label: ht.tabOffers }] : []),
          ...(canViewAttendance || self ? [{ value: 'attendance' as const, label: ht.tabAttendance }] : []),
          ...(canViewAttendance || self ? [{ value: 'leave' as const, label: ht.tabLeave }] : []),
          ...(perm('salary.view') || self ? [{ value: 'salary' as const, label: ht.tabSalary }] : []),
          ...(canBank ? [{ value: 'bank' as const, label: ht.tabBank }] : []),
          { value: 'lifecycle' as const, label: ht.tabLifecycle },
          { value: 'history' as const, label: ht.tabHistory, count: history.data?.length },
          { value: 'access' as const, label: ht.tabAccess },
        ]}
      />

      {tab === 'overview' && (
        <div className="panels">
          <section className="card">
            <h2>{ht.job}</h2>
            <dl className="facts">
              <Fact label={ht.designation} value={e.designationName} />
              <Fact label={ht.department} value={e.departmentName} />
              <Fact label={ht.branch} value={e.branchId ? branchName(e.branchId) : ht.headOffice} />
              <Fact label={ht.manager} value={e.managerId ? <Link to={paths.adminEmployee(e.managerId)}>{e.managerName}</Link> : null} />
              <Fact label={ht.employmentTypeLabel} value={ht.employmentType[e.employmentType]} />
              <Fact label={ht.joiningDate} value={e.joiningDate} />
            </dl>
          </section>
          <section className="card">
            <h2>{ht.contact}</h2>
            <dl className="facts">
              <Fact label={ht.workEmail} value={e.email} />
              <Fact label={ht.phone} value={e.phone} />
              <Fact label={lt.employeeId} value={<span className="mono">{e.code}</span>} />
            </dl>
          </section>
        </div>
      )}

      {tab === 'personal' && (
        <section className="card">
          <h2>{ht.personalTitle}</h2>
          {profile.loading ? (
            <SkeletonRows rows={3} />
          ) : profile.error ? (
            <ErrorState message={profile.error} onRetry={profile.reload} />
          ) : (
            <dl className="facts">
              <Fact label={ht.dob} value={p.dob ? day(new Date(p.dob)) : null} />
              <Fact label={ht.gender} value={p.gender ? ht.genders[p.gender] : null} />
              <Fact label={ht.bloodGroup} value={p.bloodGroup} />
              <Fact label={ht.personalEmail} value={p.personalEmail} />
              <Fact label={ht.personalPhone} value={p.personalPhone} />
              <Fact label={ht.currentAddress} value={p.currentAddress} />
              <Fact label={ht.permanentAddress} value={p.permanentAddress} />
              <Fact
                label={ht.emergency}
                value={p.emergencyName ? `${p.emergencyName}${p.emergencyRelation ? ` (${p.emergencyRelation})` : ''} · ${p.emergencyPhone ?? ''}` : null}
              />
              <Fact label={ht.pan} value={p.pan && <span className="mono">{p.pan}</span>} />
              <Fact label={ht.uan} value={p.uan && <span className="mono">{p.uan}</span>} />
              <Fact label={ht.esiNumber} value={p.esiNumber && <span className="mono">{p.esiNumber}</span>} />
            </dl>
          )}
          {canPrivate && e.status !== 'OFFBOARDED' && (
            <div className="row">
              <button type="button" className="btn btn-outlined" onClick={() => setDialog('personal')}>
                {ht.editPersonal}
              </button>
            </div>
          )}
        </section>
      )}

      {tab === 'offers' && <EmployeeOffersPanel orgId={orgId} employee={e} />}

      {tab === 'documents' && <EmployeeDocumentsPanel orgId={orgId} employee={e} canManage={canManageDocs} canVerify={canVerifyDocs} onChanged={employee.reload} />}

      {tab === 'attendance' && <EmployeeAttendancePanel orgId={orgId} employee={e} canManage={canManageAttendance} onChanged={employee.reload} />}

      {tab === 'leave' && <EmployeeLeavePanel orgId={orgId} employee={e} canApprove={perm('leave.approve')} canAdjust={perm('leave.adjust')} />}

      {tab === 'salary' && (
        <EmployeeSalaryPanel orgId={orgId} employee={e} canView={perm('salary.view')} canEdit={perm('salary.edit')} canSeePayslips={perm('payslips.viewAll')} />
      )}

      {tab === 'bank' && canBank && <BankPanel orgId={orgId} employee={e} profile={p} canEdit={e.status !== 'OFFBOARDED'} onSaved={refresh} />}

      {tab === 'lifecycle' && (
        <>
          <section className="card">
            <h2>
              {ht.colStatus}: <EmployeeStatusBadge status={e.status} />
            </h2>
            {canLifecycle ? (
              <div className="row">
                {NEXT_STEPS[e.status].map((step, i) => (
                  <button
                    key={step}
                    type="button"
                    className={`btn ${i === 0 ? 'btn-filled' : 'btn-outlined'}`}
                    onClick={() => setDialog(step)}
                    disabled={e.uid === user?.uid && !claims.sa}
                  >
                    {ht.steps[step]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{ht.noLifecycleAccess}</p>
            )}
          </section>
          {openList ? (
            <Checklist orgId={orgId} employee={e} list={openList} editable={canLifecycle} onChanged={employee.reload} />
          ) : (
            <>
              <p className="muted">{ht.checklistClosed}</p>
              {e.onboarding && e.status !== 'DRAFT' && <Checklist orgId={orgId} employee={e} list="onboarding" editable={false} onChanged={employee.reload} />}
              {e.offboarding && <Checklist orgId={orgId} employee={e} list="offboarding" editable={false} onChanged={employee.reload} />}
            </>
          )}
        </>
      )}

      {tab === 'history' &&
        (history.loading ? (
          <SkeletonRows />
        ) : history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : !history.data?.length ? (
          <EmptyState icon="history" title={ht.historyEmpty} message="" />
        ) : (
          <ol className="timeline">
            {history.data.map((h) => (
              <li key={h.id}>
                <strong>{ht.historyType[h.type] ?? h.type}</strong> <span className="muted small">{ht.effective(h.effectiveDate)}</span>
                <div className="small">
                  {Object.entries(h.changes).map(([k, v]) => (
                    <div key={k}>
                      {ht.field[k] ?? k}: {k === 'branchId' ? (v.from ? branchName(String(v.from)) : ht.headOffice) : show(v.from)} →{' '}
                      {k === 'branchId' ? (v.to ? branchName(String(v.to)) : ht.headOffice) : show(v.to)}
                    </div>
                  ))}
                </div>
                {h.note && <p className="small">{h.note}</p>}
                <p className="muted small">
                  {h.byEmail ?? ''} · {h.at ? when(h.at) : ''}
                </p>
              </li>
            ))}
          </ol>
        ))}

      {tab === 'access' && <AccessPanel org={org} employee={e} onChanged={employee.reload} />}

      {dialog === 'edit' && (
        <EmployeeDialog
          org={org}
          employee={e}
          onClose={() => setDialog(null)}
          onSaved={() => {
            employee.reload();
            history.reload();
          }}
        />
      )}
      {dialog === 'personal' && <PersonalDialog orgId={orgId} employee={e} profile={p} onClose={() => setDialog(null)} onSaved={profile.reload} />}
      {dialog && dialog !== 'edit' && dialog !== 'personal' && (
        <TransitionDialog
          orgId={orgId}
          employee={e}
          step={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setNotice(`${ht.steps[dialog]} ✓`);
            employee.reload();
          }}
        />
      )}
    </>
  );
}
