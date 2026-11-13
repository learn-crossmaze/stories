// People → Attendance: the day board, month summaries with finalization, and corrections.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command, errorText } from '../../data/api';
import { type AttendanceRecord, type Correction, dayRecords, finalizeMonth, type Holiday, hours, listHolidays, listShifts, monthLock, monthSummaries, pendingCorrections, previousMonth, punch, timeOf } from '../../data/attendance';
import { monthIST, todayIST } from '../../shared/dates';
import { type Employee, listEmployees } from '../../data/hr';
import { pendingLeave } from '../../data/leave';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { day as dayFmt } from '../../shared/format';
import { Badge, EmptyState, ErrorState, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { type AsyncState, useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, useSubmit } from '../components/Dialog';
import { Notice, Tabs } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { AdjustDialog, AdjustManyDialog, DayBadge, DayFlags, ShiftDialog, type ShiftHours, useCorrectionDecision } from './attendanceKit';
import { DecideButtons, DecisionNotices, useHidden, useTicks } from './decisions';

type Tab = 'day' | 'month' | 'corrections';
const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

const WEEKDAY_OF = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const weekdayOf = (date: string) => WEEKDAY_OF[new Date(`${date}T00:00:00Z`).getUTCDay()];

function DayBoard({ orgId, scope }: { orgId: string; scope: string[] | 'ALL' }) {
  const { claims, user } = useAuth();
  const { branchName, myBranches } = useWorkspace();
  const [date, setDate] = useState(todayIST());
  const isToday = date === todayIST();
  const scopeKey = JSON.stringify(scope);
  // Who works here and the shifts change rarely: read once. Only the day's records follow the date.
  const roster = useAsync(async () => {
    const [people, shifts] = await Promise.all([listEmployees(orgId, scope), listShifts(orgId)]);
    return { people: people.filter((p) => WORKING.includes(p.status)), shifts };
  }, [orgId, scopeKey]);
  const records = useAsync(async () => ({ date, list: await dayRecords(orgId, date, scope) }), [orgId, date, scopeKey]);
  // The records on screen belong to the day picked (while another day's are on their way, nobody's day is known).
  const known = !records.loading && records.data?.date === date;
  // Holidays are needed only to keep "select everyone" off people's days off on a past day: read by year, none for today.
  const holidayYear = isToday ? '' : date.slice(0, 4);
  const holidaysRead = useAsync(async () => ({ year: holidayYear, list: holidayYear ? await listHolidays(orgId, holidayYear).catch(() => null) : ([] as Holiday[]) }), [orgId, holidayYear]);
  // Unknown (null) while the year's list is on its way (the one read before stays in `data` until then), or when it could not be read.
  const holidays = !holidaysRead.loading && holidaysRead.data?.year === holidayYear ? holidaysRead.data.list : null;
  const [adjusting, setAdjusting] = useState<{ e: Employee; r: AttendanceRecord | null } | null>(null);
  const [adjustingMany, setAdjustingMany] = useState(false);
  const [shiftFor, setShiftFor] = useState<Employee | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Punches go out row by row: a ref (two clicks in one frame both see the state before the first) and a copy to draw from.
  const flying = useRef(new Set<string>());
  const [punching, setPunching] = useState<ReadonlySet<string>>(new Set());
  const [punchErrors, setPunchErrors] = useState<Readonly<Record<string, string>>>({});
  // Why someone could not be adjusted with the others (they stay ticked).
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  // A row just punched stays off until the day is read again: its button would otherwise turn into the opposite punch under the pointer.
  const settling = useHidden(records.data?.list);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const byEmployee = new Map((known ? records.data!.list : []).map((r) => [r.employeeId, r]));
  const people = roster.data?.people ?? [];
  const shiftOf = (e: Employee): ShiftHours | null => roster.data?.shifts.find((s) => s.id === e.shiftId) ?? null;
  const manage = (e: Employee) => (e.branchId ? can(claims, 'attendance.manage', orgId, e.branchId) : can(claims, 'attendance.manage', orgId) && scope === 'ALL');
  const doPunch = async (e: Employee, action: 'IN' | 'OUT') => {
    if (flying.current.has(e.id)) return;
    flying.current.add(e.id);
    setPunching(new Set(flying.current));
    setPunchErrors(({ [e.id]: _again, ...rest }) => rest);
    let failure: unknown = null;
    try {
      await punch(orgId, action, e.id);
    } catch (err) {
      failure = err ?? new Error('failed');
    }
    flying.current.delete(e.id);
    if (!live.current) return;
    setPunching(new Set(flying.current));
    if (failure) setPunchErrors((errs) => ({ ...errs, [e.id]: ht.punchFailed(e.fullName, errorText(failure)) }));
    else {
      settling.hide(e.id);
      records.reload();
    }
  };

  // Past days only: people with nothing recorded can be marked as having worked, several at once.
  const eligible =
    isToday || !known
      ? []
      : people.filter((e) => {
          const r = byEmployee.get(e.id);
          return manage(e) && e.uid !== user?.uid && !r?.finalized && !r?.checkIn && !(r?.leave && !r.leave.half) && (!e.joiningDate || e.joiningDate <= date) && (!e.exitDate || date <= e.exitDate);
        });
  const ticks = useTicks(eligible);
  // "Select everyone" leaves out people off that day (a weekly off or a holiday), who would be marked present; unknown holidays switch it off.
  const dayOff = (e: Employee) => (e.weeklyOffs ?? myBranches.find((b) => b.id === e.branchId)?.weeklyOffs ?? []).includes(weekdayOf(date));
  const onHoliday = (e: Employee) => !!holidays?.some((h) => h.date === date && (!h.branchIds?.length || (!!e.branchId && h.branchIds.includes(e.branchId))));
  const everyone = holidays ? eligible.filter((e) => !byEmployee.has(e.id) && !dayOff(e) && !onHoliday(e)) : [];
  const allTicked = everyone.length > 0 && everyone.every((e) => ticks.has(e.id));
  const pickDate = (next: string) => {
    setDate(next);
    ticks.set([]);
    setProblems({});
    setNotice(null);
  };

  const errors = Object.values(punchErrors);
  const notAdjusted = ticks.chosen.filter((e) => problems[e.id]).length;
  return (
    <>
      <div className="toolbar">
        <label className="field-inline">
          {ht.day}
          <input type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && pickDate(e.target.value)} />
        </label>
        {eligible.length > 0 && (
          <button type="button" className="btn btn-outlined" disabled={!ticks.chosen.length} onClick={() => setAdjustingMany(true)}>
            {ht.adjustSelected(ticks.chosen.length)}
          </button>
        )}
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {!adjustingMany && notAdjusted > 0 && <Notice tone="error">{ht.adjustManyNotDone(notAdjusted)}</Notice>}
      <FormError error={errors.length ? errors.join(' ') : null} />
      {records.error && !records.loading && (records.data ? <Notice tone="error">{records.error}</Notice> : <ErrorState message={records.error} onRetry={records.reload} />)}
      {roster.loading ? (
        <SkeletonRows />
      ) : roster.error || !roster.data ? (
        <ErrorState message={roster.error ?? t.errorGeneric} onRetry={roster.reload} />
      ) : !people.length ? (
        <EmptyState icon="people" title={ht.noEmployeesHere} message="" />
      ) : (
        <TableWrap>
          <table className="table" aria-busy={(!known && !records.error) || undefined}>
            <thead>
              <tr>
                {eligible.length > 0 && (
                  <th scope="col" className="check-col">
                    <input
                      type="checkbox"
                      aria-label={ht.selectAllNoRecord}
                      title={ht.selectAllNoRecord}
                      disabled={!everyone.length}
                      checked={allTicked}
                      onChange={(ev) => ticks.set(ev.target.checked ? everyone.map((e) => e.id) : [])}
                    />
                  </th>
                )}
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
              {people.map((e) => {
                const r = byEmployee.get(e.id) ?? null;
                const status = r?.status ?? (isToday ? 'NOT_IN' : null);
                const self = e.uid === user?.uid;
                // Off while its punch is on its way, and after it until the day is read again (not when that read failed).
                const off = punching.has(e.id) || (settling.hidden(e.id) && !records.error);
                return (
                  <tr key={e.id}>
                    {eligible.length > 0 && (
                      <td className="check-col">
                        {eligible.includes(e) && <input type="checkbox" aria-label={ht.selectForAdjust(e.fullName)} checked={ticks.has(e.id)} onChange={(ev) => ticks.toggle(e.id, ev.target.checked)} />}
                      </td>
                    )}
                    <td>
                      <Link to={paths.adminEmployee(e.id)}>{e.fullName}</Link>
                      <div className="muted small">
                        {e.shiftName ?? ht.noShift} · {e.branchId ? branchName(e.branchId) : ht.headOffice}
                      </div>
                      {problems[e.id] && ticks.has(e.id) && (
                        <div className="field-error" role="alert">
                          {problems[e.id]}
                        </div>
                      )}
                    </td>
                    <td>
                      {!known ? <span className="muted">…</span> : status ? <DayBadge status={status} /> : '—'}
                      {known && r && <DayFlags r={r} />}
                    </td>
                    <td className="nowrap">{known ? timeOf(r?.checkIn ?? null) : ''}</td>
                    <td className="nowrap">{known ? timeOf(r?.checkOut ?? null) : ''}</td>
                    <td className="nowrap">{known ? (r?.workedMinutes ? hours(r.workedMinutes) : '—') : ''}</td>
                    <td className="cell-actions">
                      {known && manage(e) && isToday && !r?.checkIn && (
                        <button type="button" className="btn btn-text" disabled={off} onClick={() => void doPunch(e, 'IN')} aria-label={ht.checkInFor(e.fullName)}>
                          {punching.has(e.id) ? t.saving : ht.checkIn}
                        </button>
                      )}
                      {known && manage(e) && isToday && r?.checkIn && !r.checkOut && (
                        <button type="button" className="btn btn-text" disabled={off} onClick={() => void doPunch(e, 'OUT')} aria-label={ht.checkOutFor(e.fullName)}>
                          {punching.has(e.id) ? t.saving : ht.checkOut}
                        </button>
                      )}
                      {known && manage(e) && !self && !r?.finalized && (
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
        </TableWrap>
      )}
      {adjusting && <AdjustDialog orgId={orgId} employee={adjusting.e} date={date} record={adjusting.r} shift={shiftOf(adjusting.e)} onClose={() => setAdjusting(null)} onDone={records.reload} />}
      {adjustingMany && (
        <AdjustManyDialog
          orgId={orgId}
          date={date}
          people={ticks.chosen.map((e) => ({ employee: e, shift: shiftOf(e) }))}
          problems={problems}
          onClose={() => setAdjustingMany(false)}
          onSettled={(done, failed) => {
            // Those adjusted are unticked at once (asking again would tell them twice); the others stay, with the reason.
            ticks.set(ticks.chosen.filter((e) => !done.includes(e.id)).map((e) => e.id));
            setProblems(failed);
            setNotice(done.length ? ht.adjustManyDone(done.length) : null);
            if (done.length) records.reload();
          }}
        />
      )}
      {/* The shift's name is kept on the employee, so the people are read again. */}
      {shiftFor && roster.data && <ShiftDialog orgId={orgId} employee={shiftFor} shifts={roster.data.shifts} onClose={() => setShiftFor(null)} onDone={roster.reload} />}
    </>
  );
}

/**
 * Summaries, finalize and reopen. `corrections` is the page's list of corrections still waiting (undefined
 * when it could not be read): what waits for this month and branch is said before Finalize is pressed. It is a
 * hint only (the lists can be out of date or cut short); the server decides.
 */
function MonthView({ orgId, scope, corrections, onLook, goToCorrections }: { orgId: string; scope: string[] | 'ALL'; corrections: Correction[] | undefined; onLook: () => void; goToCorrections: () => void }) {
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
  // Leave still waiting at this branch; a read that fails (or is not allowed) just says nothing.
  const leave = useAsync(() => pendingLeave(orgId, branchId ? [branchId] : scope).catch(() => null), [orgId, month, where]);
  // The corrections were read when the page opened: look again for the month and branch now on screen.
  useEffect(onLook, [onLook, month, where]);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const whereLabel = choices.find((c) => c.value === where)?.label ?? '';
  const fin = useSubmit(async () => {
    try {
      const res = await finalizeMonth(orgId, month, branchId);
      setNotice(ht.finalizeDone(res.employees));
      setConfirming(false);
      data.reload();
    } catch (e) {
      // Usually something is still waiting: show what, as it is now.
      onLook();
      leave.reload();
      throw e;
    }
  });
  const waitingCorrections = corrections?.filter((c) => c.branchId === branchId && c.date.startsWith(month)).length ?? 0;
  const waitingLeave = leave.data?.filter((r) => r.branchId === branchId && r.dates.some((d) => d.startsWith(month))).length ?? 0;
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
      {canFinalize && !finalized && waitingCorrections + waitingLeave > 0 && (
        <Notice tone="warn">
          {ht.finalizeWaiting(waitingCorrections, waitingLeave)}{' '}
          {waitingCorrections > 0 && (
            <button type="button" className="btn btn-text" onClick={goToCorrections}>
              {ht.openCorrections}
            </button>
          )}
          {waitingLeave > 0 && (
            <Link className="btn btn-text" to={paths.adminLeave}>
              {ht.openLeaveRequests}
            </Link>
          )}
        </Notice>
      )}
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
            <TableWrap>
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
                        {s.stale && <Badge tone="warn"> {ht.staleSummary}</Badge>}
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
            </TableWrap>
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

/**
 * What a tick on a correction stands for. Its id is the person and the day, so it comes back when the day is
 * asked for again after a rejection: that is another request, and must not arrive ticked.
 */
const asked = (c: Correction) => [c.requestedAt?.getTime() ?? '', c.checkIn ?? '', c.checkOut ?? '', c.reason].join('|');

/** Corrections waiting for a decision. The page owns the list (it also counts it for the tab) and the decisions. */
function CorrectionsView({ orgId, scope, list, rows, decision }: { orgId: string; scope: string[] | 'ALL'; list: AsyncState<Correction[]>; rows: Correction[]; decision: ReturnType<typeof useCorrectionDecision> }) {
  const { claims, user } = useAuth();
  const { branchName } = useWorkspace();
  // A convenience only: the server decides who may approve what (never your own correction).
  const mayDecide = (c: Correction) => c.employeeUid !== user?.uid && (c.branchId ? can(claims, 'corrections.approve', orgId, c.branchId) : can(claims, 'corrections.approve', orgId) && scope === 'ALL');
  const ticks = useTicks(rows.filter(mayDecide), asked);
  if (list.loading) return <SkeletonRows />;
  if (list.error && !list.data) return <ErrorState message={list.error} onRetry={list.reload} />;
  const selectable = rows.some(mayDecide);
  const sending = ticks.chosen.length > 0 && ticks.chosen.every((c) => decision.busy(c.id));
  return (
    <>
      {list.error && <Notice tone="error">{list.error}</Notice>}
      <DecisionNotices decision={decision} rows={rows} name={(c) => `${c.employeeName}, ${c.date}`} />
      {!rows.length ? (
        <EmptyState icon="check" title={ht.correctionsEmpty} message="" />
      ) : (
        <>
          {selectable && (
            <div className="toolbar">
              <button type="button" className="btn btn-filled" disabled={!ticks.chosen.length || sending} onClick={() => void decision.approveMany(ticks.chosen)}>
                {sending ? t.saving : ht.approveSelected(ticks.chosen.length)}
              </button>
            </div>
          )}
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  {selectable && (
                    <th scope="col" className="check-col">
                      <input type="checkbox" aria-label={ht.selectAllDecidable} title={ht.selectAllDecidable} checked={ticks.all} onChange={(e) => ticks.toggleAll(e.target.checked)} />
                    </th>
                  )}
                  <th scope="col">{ht.colName}</th>
                  <th scope="col">{ht.day}</th>
                  <th scope="col">{ht.correctionReason}</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const busy = decision.busy(c.id);
                  return (
                    <tr key={c.id} aria-busy={busy || undefined}>
                      {selectable && (
                        <td className="check-col">
                          {mayDecide(c) && (
                            <input type="checkbox" aria-label={ht.selectCorrection(c.employeeName, c.date)} disabled={busy} checked={ticks.has(c.id)} onChange={(e) => ticks.toggle(c.id, e.target.checked)} />
                          )}
                        </td>
                      )}
                      <td>
                        <Link to={paths.adminEmployee(c.employeeId)}>{c.employeeName}</Link>
                        <div className="muted small">{c.branchId ? branchName(c.branchId) : ht.headOffice}</div>
                      </td>
                      <td className="nowrap">
                        {c.date}
                        <div className="small">{ht.requested(c.checkIn ?? '', c.checkOut ?? '')}</div>
                      </td>
                      <td>
                        {c.reason}
                        {decision.failed[c.id] && (
                          <div className="field-error" role="alert">
                            {decision.failed[c.id]}
                          </div>
                        )}
                      </td>
                      <td className="cell-actions">
                        {mayDecide(c) && (
                          <DecideButtons
                            busy={busy}
                            onApprove={() => void decision.approve(c)}
                            onReject={() => decision.reject(c)}
                            approveLabel={`${ht.approve} ${c.employeeName} ${c.date}`}
                            rejectLabel={`${ht.reject} ${c.employeeName} ${c.date}`}
                          />
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
      {decision.dialog}
    </>
  );
}

export function AttendancePage() {
  const { claims, user } = useAuth();
  const { org } = useWorkspace();
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const [tab, setTab] = useState<Tab>('day');
  // One read of the corrections that wait: for the tab's count, the Corrections tab and the Month tab's reminder.
  const list = useAsync(() => (org ? pendingCorrections(org.id, scope) : Promise.resolve([])), [org?.id, JSON.stringify(scope)]);
  // A decided correction leaves the list at once; the list is read again once nothing is on its way.
  const { shown, hide } = useHidden(list.data);
  const decision = useCorrectionDecision(org?.id ?? '', (c) => hide(c.id), list.reload);
  if (!org) return <NoOrgState />;
  const pick = (next: Tab) => {
    // Coming back to the corrections: someone may have asked meanwhile.
    if (next === 'corrections' && tab !== 'corrections' && !decision.working) list.reload();
    setTab(next);
  };
  return (
    <>
      <header className="page-header">
        <h1>{ht.navAttendance}</h1>
        <p className="muted">{ht.attendanceIntro}</p>
      </header>
      <Tabs
        value={tab}
        onChange={pick}
        tabs={[
          { value: 'day' as const, label: ht.tabToday },
          { value: 'month' as const, label: ht.tabMonth },
          // Your own request is not yours to decide, so it is not counted (as in the menu).
          { value: 'corrections' as const, label: ht.tabCorrections, count: list.loading ? undefined : shown?.filter((c) => c.employeeUid !== user?.uid).length },
        ]}
      />
      {tab === 'day' && <DayBoard orgId={org.id} scope={scope} />}
      {tab === 'month' && <MonthView orgId={org.id} scope={scope} corrections={list.error ? undefined : shown} onLook={list.reload} goToCorrections={() => pick('corrections')} />}
      {tab === 'corrections' && <CorrectionsView orgId={org.id} scope={scope} list={list} rows={shown ?? []} decision={decision} />}
    </>
  );
}
