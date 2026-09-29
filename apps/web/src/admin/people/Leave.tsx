// People → Leave: requests to decide, who is away, and balances with accrual.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { monthIST, todayIST } from '../../shared/dates';
import { type Employee, listEmployees } from '../../data/hr';
import { accrueLeave, approvedLeaveIn, available, balancesFor, daysLabel, listLeaveTypes, type LeaveRequest, type LeaveType, pendingLeave } from '../../data/leave';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { Notice, Tabs } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { AdjustBalanceDialog, ApplyLeaveDialog, CancelLeaveDialog, RequestTable, useLeaveDecision } from './leaveKit';

type Tab = 'requests' | 'away' | 'balances';
type Scope = string[] | 'ALL';
const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

/** A permission for an employee's branch (head-office staff need it org-wide). */
function usePermFor(orgId: string, scope: Scope) {
  const { claims } = useAuth();
  return (p: Permission, branchId: string | null) => (branchId ? can(claims, p, orgId, branchId) : can(claims, p, orgId) && scope === 'ALL');
}

function RequestsView({ orgId, scope, onChanged }: { orgId: string; scope: Scope; onChanged: () => void }) {
  const { user } = useAuth();
  const { branchName } = useWorkspace();
  const permFor = usePermFor(orgId, scope);
  const list = useAsync(() => pendingLeave(orgId, scope), [orgId, JSON.stringify(scope)]);
  const decision = useLeaveDecision(orgId, () => {
    list.reload();
    onChanged();
  });
  if (list.loading) return <SkeletonRows />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data?.length) return <EmptyState icon="check" title={ht.pendingLeaveEmpty} message="" />;
  return (
    <>
      <FormError error={decision.error} />
      <RequestTable
        requests={list.data}
        empty={ht.pendingLeaveEmpty}
        who={(r) => (r.branchId ? branchName(r.branchId) : ht.headOffice)}
        actions={(r) =>
          r.employeeUid !== user?.uid &&
          permFor('leave.approve', r.branchId) && (
            <>
              <button type="button" className="btn btn-text" onClick={() => void decision.approve(r)} aria-label={ht.approveLeave(r.employeeName)}>
                {ht.approve}
              </button>
              <button type="button" className="btn btn-text" onClick={() => decision.reject(r)} aria-label={ht.rejectLeave(r.employeeName)}>
                {ht.reject}
              </button>
            </>
          )
        }
      />
      {decision.dialog}
    </>
  );
}

function AwayView({ orgId, scope }: { orgId: string; scope: Scope }) {
  const { user } = useAuth();
  const { branchName } = useWorkspace();
  const permFor = usePermFor(orgId, scope);
  const [month, setMonth] = useState(monthIST());
  const list = useAsync(() => approvedLeaveIn(orgId, month, scope), [orgId, month, JSON.stringify(scope)]);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const today = todayIST();
  const away = list.data?.filter((r) => r.dates.includes(today)) ?? [];
  return (
    <>
      <div className="toolbar">
        <label className="field-inline">
          {ht.monthLabel}
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
      </div>
      {month === monthIST() && away.length > 0 && (
        <p>
          <strong>{ht.onLeaveToday}:</strong> {away.map((r) => r.employeeName).join(', ')}
        </p>
      )}
      {list.loading ? (
        <SkeletonRows />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <RequestTable
          requests={list.data ?? []}
          empty={ht.awayEmpty}
          who={(r) => (r.branchId ? branchName(r.branchId) : ht.headOffice)}
          actions={(r) =>
            r.employeeUid !== user?.uid &&
            permFor('leave.adjust', r.branchId) && (
              <button type="button" className="btn btn-text" onClick={() => setCancelling(r)} aria-label={`${ht.cancelLeaveFor(r.from)} · ${r.employeeName}`}>
                {ht.cancelLeave}
              </button>
            )
          }
        />
      )}
      {cancelling && <CancelLeaveDialog orgId={orgId} request={cancelling} own={false} onClose={() => setCancelling(null)} onDone={list.reload} />}
    </>
  );
}

function AccrualDialog({ orgId, onClose, onDone }: { orgId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [month, setMonth] = useState(monthIST());
  const { busy, error, submit } = useSubmit(async () => {
    const res = await accrueLeave(orgId, month);
    onDone(ht.accrualDone(res.employees, res.days));
    onClose();
  });
  return (
    <Dialog title={ht.accrualTitle} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p className="muted">{ht.accrualBody}</p>
        <TextField label={ht.monthLabel} type="month" value={month} onChange={setMonth} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.runAccrual} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function BalancesView({ orgId, scope }: { orgId: string; scope: Scope }) {
  const { claims, user } = useAuth();
  const permFor = usePermFor(orgId, scope);
  const [year, setYear] = useState(todayIST().slice(0, 4));
  const data = useAsync(async () => {
    const [people, balances, types] = await Promise.all([listEmployees(orgId, scope), balancesFor(orgId, year, scope), listLeaveTypes(orgId)]);
    return { people: people.filter((p) => WORKING.includes(p.status)), balances: new Map(balances.map((b) => [b.employeeId, b])), types };
  }, [orgId, year, JSON.stringify(scope)]);
  const [accruing, setAccruing] = useState(false);
  const [adjusting, setAdjusting] = useState<Employee | null>(null);
  const [recording, setRecording] = useState<Employee | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canAccrue = can(claims, 'leave.adjust', orgId) && scope === 'ALL';
  const now = Number(todayIST().slice(0, 4));
  const columns: LeaveType[] = data.data?.types.filter((ty) => ty.status === 'ACTIVE' && !ty.unlimited) ?? [];

  return (
    <>
      <div className="toolbar">
        <label className="field-inline">
          {ht.yearLabel}
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {[now + 1, now, now - 1].map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {canAccrue && (
          <button type="button" className="btn btn-outlined" onClick={() => setAccruing(true)}>
            {ht.runAccrual}
          </button>
        )}
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {data.loading && !data.data ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />
      ) : !data.data.people.length ? (
        <EmptyState icon="people" title={ht.noEmployeesHere} message="" />
      ) : (
        <>
          {data.data.balances.size === 0 && <p className="muted">{ht.noBalances(year)}</p>}
          <TableWrap>
            <table className="table compact">
              <thead>
                <tr>
                  <th scope="col">{ht.colName}</th>
                  {columns.map((ty) => (
                    <th key={ty.id} scope="col" className="num">
                      <abbr title={ty.name}>{ty.code}</abbr>
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.people.map((e) => {
                  const b = data.data!.balances.get(e.id);
                  const self = e.uid === user?.uid;
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link to={paths.adminEmployee(e.id)}>{e.fullName}</Link>
                      </td>
                      {columns.map((ty) => (
                        <td key={ty.id} className="num">
                          {available(b?.types[ty.id])}
                          {!!b?.types[ty.id]?.pending && <div className="muted small">{daysLabel(b.types[ty.id].pending!)} waiting</div>}
                        </td>
                      ))}
                      <td className="cell-actions">
                        {!self && permFor('leave.approve', e.branchId) && (
                          <button type="button" className="btn btn-text" onClick={() => setRecording(e)} aria-label={ht.applyLeaveFor(e.fullName)}>
                            {ht.applyOnBehalf}
                          </button>
                        )}
                        {!self && permFor('leave.adjust', e.branchId) && (
                          <button type="button" className="btn btn-text" onClick={() => setAdjusting(e)} aria-label={ht.adjustBalanceTitle(e.fullName)}>
                            {ht.adjustBalance}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
      {accruing && <AccrualDialog orgId={orgId} onClose={() => setAccruing(false)} onDone={(m) => (setNotice(m), data.reload())} />}
      {adjusting && data.data && (
        <AdjustBalanceDialog orgId={orgId} employee={adjusting} types={data.data.types.filter((ty) => ty.status === 'ACTIVE')} year={year} onClose={() => setAdjusting(null)} onDone={data.reload} />
      )}
      {recording && data.data && (
        <ApplyLeaveDialog
          orgId={orgId}
          types={data.data.types}
          balance={data.data.balances.get(recording.id) ?? null}
          employee={recording}
          onClose={() => setRecording(null)}
          onDone={(days) => {
            setNotice(ht.leaveApplied(daysLabel(days)));
            data.reload();
          }}
        />
      )}
    </>
  );
}

export function LeavePage() {
  const { claims, user } = useAuth();
  const { org } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const [tab, setTab] = useState<Tab>('requests');
  const counts = useAsync(() => (org ? pendingLeave(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{ht.navLeave}</h1>
        <p className="muted">{ht.leaveIntro}</p>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'requests' as const, label: ht.tabRequests, count: counts.data?.filter((r) => r.employeeUid !== user?.uid).length },
          { value: 'away' as const, label: ht.tabAway },
          { value: 'balances' as const, label: ht.tabBalances },
        ]}
      />
      {tab === 'requests' && <RequestsView orgId={org.id} scope={scope} onChanged={counts.reload} />}
      {tab === 'away' && <AwayView orgId={org.id} scope={scope} />}
      {tab === 'balances' && <BalancesView orgId={org.id} scope={scope} />}
    </>
  );
}
