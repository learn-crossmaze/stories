// People → Attendance: the day board, month summaries with finalization, and corrections.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import {
  type AttendanceRecord,
  dayRecords,
  finalizeMonth,
  hours,
  listShifts,
  monthIST,
  monthLock,
  monthSummaries,
  pendingCorrections,
  previousMonth,
  punch,
  timeOf,
  todayIST,
} from '../../data/attendance';
import { type Employee, listEmployees } from '../../data/hr';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { day as dayFmt } from '../../shared/format';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, useSubmit } from '../components/Dialog';
import { Notice, Tabs } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { AdjustDialog, DayBadge, DayFlags, ShiftDialog, useCorrectionDecision } from './attendanceKit';

type Tab = 'day' | 'month' | 'corrections';
const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

function DayBoard({ orgId, scope }: { orgId: string; scope: string[] | 'ALL' }) {
  const { claims, user } = useAuth();
  const { branchName } = useWorkspace();
  const [date, setDate] = useState(todayIST());
  const data = useAsync(async () => {
    const [people, records, shifts] = await Promise.all([listEmployees(orgId, scope), dayRecords(orgId, date, scope), listShifts(orgId)]);
    return { people: people.filter((p) => WORKING.includes(p.status)), records: new Map(records.map((r) => [r.employeeId, r])), shifts };
  }, [orgId, date, JSON.stringify(scope)]);
  const [adjusting, setAdjusting] = useState<{ e: Employee; r: AttendanceRecord | null } | null>(null);
  const [shiftFor, setShiftFor] = useState<Employee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isToday = date === todayIST();
  const manage = (e: Employee) => (e.branchId ? can(claims, 'attendance.manage', orgId, e.branchId) : can(claims, 'attendance.manage', orgId) && scope === 'ALL');
  const doPunch = async (e: Employee, action: 'IN' | 'OUT') => {
    setError(null);
    try {
      await punch(orgId, action, e.id);
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    }
  };

  return (
    <>
      <div className="toolbar">
        <label className="field-inline">
          {ht.day}
          <input type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>
      <FormError error={error} />
      {data.loading ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />
      ) : !data.data.people.length ? (
        <EmptyState icon="people" title={ht.noEmployeesHere} message="" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.colName}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">{ht.inCol}</th>
                <th scope="col">{ht.outCol}</th>
                <th scope="col">{ht.workedCol}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.people.map((e) => {
                const r = data.data!.records.get(e.id) ?? null;
                const status = r?.status ?? (isToday ? 'NOT_IN' : null);
                const self = e.uid === user?.uid;
                return (
                  <tr key={e.id}>
                    <td>
                      <Link to={paths.adminEmployee(e.id)}>{e.fullName}</Link>
                      <div className="muted small">
                        {e.shiftName ?? ht.noShift} · {e.branchId ? branchName(e.branchId) : ht.headOffice}
                      </div>
                    </td>
                    <td>
                      {status ? <DayBadge status={status} /> : '—'}
                      {r && <DayFlags r={r} />}
                    </td>
                    <td className="nowrap">{timeOf(r?.checkIn ?? null)}</td>
                    <td className="nowrap">{timeOf(r?.checkOut ?? null)}</td>
                    <td className="nowrap">{r?.workedMinutes ? hours(r.workedMinutes) : '—'}</td>
                    <td className="cell-actions">
                      {manage(e) && isToday && !r?.checkIn && (
                        <button type="button" className="btn btn-text" onClick={() => void doPunch(e, 'IN')} aria-label={ht.checkInFor(e.fullName)}>
                          {ht.checkIn}
                        </button>
                      )}
                      {manage(e) && isToday && r?.checkIn && !r.checkOut && (
                        <button type="button" className="btn btn-text" onClick={() => void doPunch(e, 'OUT')} aria-label={ht.checkOutFor(e.fullName)}>
                          {ht.checkOut}
                        </button>
                      )}
                      {manage(e) && !self && !r?.finalized && (
                        <button type="button" className="btn btn-text" onClick={() => setAdjusting({ e, r })} aria-label={`${ht.adjust} ${e.fullName}`}>
                          {ht.adjust}
                        </button>
                      )}
                      {manage(e) && (
                        <button type="button" className="btn btn-text" onClick={() => setShiftFor(e)} aria-label={`${ht.setShift} ${e.fullName}`}>
                          {ht.setShift}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adjusting && <AdjustDialog orgId={orgId} employee={adjusting.e} date={date} record={adjusting.r} onClose={() => setAdjusting(null)} onDone={data.reload} />}
      {shiftFor && data.data && <ShiftDialog orgId={orgId} employee={shiftFor} shifts={data.data.shifts} onClose={() => setShiftFor(null)} onDone={data.reload} />}
    </>
  );
}

function MonthView({ orgId, scope }: { orgId: string; scope: string[] | 'ALL' }) {
  const { claims } = useAuth();
  const { myBranches, branch } = useWorkspace();
  const [month, setMonth] = useState(previousMonth(monthIST()));
  // Head-office staff (no branch) are finalized separately by org-wide HR.
  const choices = [...myBranches.map((b) => ({ value: b.id, label: b.name })), ...(scope === 'ALL' ? [{ value: 'HO', label: ht.headOffice }] : [])];
  const [where, setWhere] = useState(branch?.id ?? choices[0]?.value ?? 'HO');
  const branchId = where === 'HO' ? null : where;
  const perm = (p: Permission) => (branchId ? can(claims, p, orgId, branchId) : can(claims, p, orgId) && scope === 'ALL');
  const data = useAsync(async () => {
    const [lock, summaries] = await Promise.all([monthLock(orgId, month, branchId), monthSummaries(orgId, month, branchId ? [branchId] : scope)]);
    return { lock, summaries: summaries.filter((s) => s.branchId === branchId) };
  }, [orgId, month, where]);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const whereLabel = choices.find((c) => c.value === where)?.label ?? '';
  const fin = useSubmit(async () => {
    const res = await finalizeMonth(orgId, month, branchId);
    setNotice(ht.finalizeDone(res.employees));
    setConfirming(false);
    data.reload();
  });
  const lock = data.data?.lock;
  const finalized = lock?.status === 'FINALIZED';
  const canFinalize = perm('attendance.finalize') && month < monthIST();

  return (
    <>
      <div className="toolbar">
        <label className="field-inline">
          {ht.monthLabel}
          <input type="month" value={month} max={monthIST()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        {choices.length > 1 && (
          <label className="field-inline">
            {ht.finalizeFor}
            <select value={where} onChange={(e) => setWhere(e.target.value)}>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {canFinalize && !finalized && (
          <button type="button" className="btn btn-filled" onClick={() => setConfirming(true)}>
            {ht.finalize}
          </button>
        )}
        {canFinalize && finalized && (
          <button type="button" className="btn btn-outlined" onClick={() => setReopening(true)}>
            {ht.reopen}
          </button>
        )}
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {data.loading ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />
      ) : (
        <>
          <p className="muted">
            {finalized ? ht.monthFinalized(lock?.finalizedByEmail ?? '', lock?.finalizedAt ? dayFmt(lock.finalizedAt) : '') : lock?.status === 'REOPENED' ? ht.monthReopened : ht.monthOpen}
          </p>
          {data.data.summaries.length > 0 && (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th scope="col">{ht.colName}</th>
                    {Object.values(ht.summaryCols).map((label) => (
                      <th key={label} scope="col" className="num">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.summaries.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={paths.adminEmployee(s.employeeId)}>{s.employeeName}</Link>
                        {s.stale && <span className="badge badge-warn"> {ht.staleSummary}</span>}
                      </td>
                      {(Object.keys(ht.summaryCols) as (keyof typeof s)[]).map((k) => (
                        <td key={String(k)} className="num">
                          {String(s[k] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {confirming && (
        <Dialog title={ht.finalizeTitle(month, whereLabel)} onClose={() => setConfirming(false)} narrow>
          <form onSubmit={fin.submit} noValidate>
            <p className="muted">{ht.finalizeBody}</p>
            <FormError error={fin.error} />
            <DialogActions busy={fin.busy} submitLabel={ht.finalize} onCancel={() => setConfirming(false)} />
          </form>
        </Dialog>
      )}
      {reopening && (
        <ConfirmWithReason
          title={ht.reopenTitle(month)}
          body={ht.reopenBody}
          confirmLabel={ht.reopen}
          onClose={() => setReopening(false)}
          onConfirm={async (reason) => {
            await command('attendance-reopen', { orgId, month, branchId, reason });
            setReopening(false);
            data.reload();
          }}
        />
      )}
    </>
  );
}

function CorrectionsView({ orgId, scope, onChanged }: { orgId: string; scope: string[] | 'ALL'; onChanged: () => void }) {
  const { claims, user } = useAuth();
  const { branchName } = useWorkspace();
  const list = useAsync(() => pendingCorrections(orgId, scope), [orgId, JSON.stringify(scope)]);
  const decision = useCorrectionDecision(orgId, () => {
    list.reload();
    onChanged();
  });
  if (list.loading) return <SkeletonRows />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data?.length) return <EmptyState icon="check" title={ht.correctionsEmpty} message="" />;
  return (
    <>
      <FormError error={decision.error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{ht.colName}</th>
              <th scope="col">{ht.day}</th>
              <th scope="col">{ht.correctionReason}</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((c) => {
              const mayDecide = c.employeeUid !== user?.uid && (c.branchId ? can(claims, 'corrections.approve', orgId, c.branchId) : can(claims, 'corrections.approve', orgId) && scope === 'ALL');
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={paths.adminEmployee(c.employeeId)}>{c.employeeName}</Link>
                    <div className="muted small">{c.branchId ? branchName(c.branchId) : ht.headOffice}</div>
                  </td>
                  <td className="nowrap">
                    {c.date}
                    <div className="small">{ht.requested(c.checkIn ?? '', c.checkOut ?? '')}</div>
                  </td>
                  <td>{c.reason}</td>
                  <td className="cell-actions">
                    {mayDecide && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => void decision.approve(c)} aria-label={`${ht.approve} ${c.employeeName} ${c.date}`}>
                          {ht.approve}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => decision.reject(c)} aria-label={`${ht.reject} ${c.employeeName} ${c.date}`}>
                          {ht.reject}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {decision.dialog}
    </>
  );
}

export function AttendancePage() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const [tab, setTab] = useState<Tab>('day');
  const counts = useAsync(() => (org ? pendingCorrections(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  return (
    <>
      <header className="page-header">
        <h1>{ht.navAttendance}</h1>
        <p className="muted">{ht.attendanceIntro}</p>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'day' as const, label: ht.tabToday },
          { value: 'month' as const, label: ht.tabMonth },
          { value: 'corrections' as const, label: ht.tabCorrections, count: counts.data?.length },
        ]}
      />
      {tab === 'day' && <DayBoard orgId={org.id} scope={scope} />}
      {tab === 'month' && <MonthView orgId={org.id} scope={scope} />}
      {tab === 'corrections' && <CorrectionsView orgId={org.id} scope={scope} onChanged={counts.reload} />}
    </>
  );
}
