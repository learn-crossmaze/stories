// A staff member's own attendance: today's check-in card (also on the dashboard) and their month.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { employeeMonth, myCorrections, punch, timeOf } from '../../data/attendance';
import { monthIST, todayIST } from '../../shared/dates';
import { myEmployee } from '../../data/hr';
import { paths } from '../../paths';
import { EmptyState, ErrorState, Icon, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { FormError } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { CorrectionRequestDialog, DayFlags, MonthRecords } from './attendanceKit';

const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

/** Check in / check out for today. Renders nothing for people without an employee record. */
export function CheckInCard({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const data = useAsync(async () => {
    if (!org || !user) return null;
    const me = await myEmployee(org.id, user.uid);
    if (!me || !WORKING.includes(me.status)) return null;
    const today = (await employeeMonth(org.id, me.id, monthIST(), { ownUid: user.uid })).find((r) => r.date === todayIST()) ?? null;
    return { me, today };
  }, [org?.id, user?.uid]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data.data) return null;
  const { me, today } = data.data;
  const act = async (action: 'IN' | 'OUT') => {
    setBusy(true);
    setError(null);
    try {
      await punch(org!.id, action);
      data.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };
  const status = today?.checkOut ? ht.checkedOutAt(timeOf(today.checkOut)) : today?.checkIn ? ht.checkedInAt(timeOf(today.checkIn)) : ht.notCheckedIn;
  return (
    <section className={compact ? 'card checkin-card' : 'card checkin-card checkin-card-lg'} aria-labelledby="checkin-title">
      <div>
        <h2 id="checkin-title">
          <Icon name="clock" /> {ht.todayCard}
        </h2>
        <p className="muted small">{me.shiftName ?? ht.noShift}</p>
        <p aria-live="polite">{status}</p>
        {today && <DayFlags r={today} />}
      </div>
      <div className="row">
        {!today?.checkIn && (
          <button type="button" className="btn btn-filled" disabled={busy} onClick={() => void act('IN')}>
            {ht.checkIn}
          </button>
        )}
        {today?.checkIn && !today.checkOut && (
          <button type="button" className="btn btn-filled" disabled={busy} onClick={() => void act('OUT')}>
            {ht.checkOut}
          </button>
        )}
        {compact && (
          <Link className="btn btn-text" to={paths.adminMyAttendance}>
            {ht.navMyAttendance}
          </Link>
        )}
      </div>
      <FormError error={error} />
    </section>
  );
}

export function MyAttendancePage() {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const [month, setMonth] = useState(monthIST());
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const me = useAsync(() => (org && user ? myEmployee(org.id, user.uid) : Promise.resolve(null)), [org?.id, user?.uid]);
  const records = useAsync(
    () => (org && user && me.data ? employeeMonth(org.id, me.data.id, month, { ownUid: user.uid }) : Promise.resolve([])),
    [org?.id, me.data?.id, month],
  );
  const corrections = useAsync(() => (org && user && me.data ? myCorrections(org.id, user.uid) : Promise.resolve([])), [org?.id, me.data?.id]);
  if (!org) return <NoOrgState />;

  return (
    <>
      <header className="page-header page-header-row">
        <h1>{ht.navMyAttendance}</h1>
        {me.data && (
          <button type="button" className="btn btn-outlined" onClick={() => setAsking(true)}>
            {ht.requestCorrection}
          </button>
        )}
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {me.loading ? (
        <SkeletonRows />
      ) : !me.data ? (
        <EmptyState icon="clock" title={ht.noEmployeeRecord} message="" />
      ) : (
        <>
          <CheckInCard />
          <section className="section" aria-labelledby="my-month">
            <div className="page-header-row">
              <h2 id="my-month">{ht.tabMonth}</h2>
              <label className="field-inline">
                {ht.monthLabel}
                <input type="month" value={month} max={monthIST()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
              </label>
            </div>
            {records.loading ? <SkeletonRows /> : records.error ? <ErrorState message={records.error} onRetry={records.reload} /> : <MonthRecords records={records.data ?? []} />}
          </section>
          {!!corrections.data?.length && (
            <section className="section" aria-labelledby="my-corrections">
              <h2 id="my-corrections">{ht.myCorrections}</h2>
              <ul className="plain-list">
                {corrections.data.map((c) => (
                  <li key={c.id}>
                    <span>
                      <strong>{c.date}</strong> · {ht.requested(c.checkIn ?? '', c.checkOut ?? '')}
                      {c.decisionNote && <span className="muted small"> · {c.decisionNote}</span>}
                    </span>
                    <span className={`badge badge-${c.status === 'APPROVED' ? 'ok' : c.status === 'REJECTED' ? 'danger' : 'info'}`}>{ht.correctionStatus[c.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {asking && (
        <CorrectionRequestDialog
          orgId={org.id}
          defaultDate={todayIST()}
          onClose={() => setAsking(false)}
          onDone={() => {
            setNotice(ht.correctionStatus.PENDING);
            corrections.reload();
          }}
        />
      )}
    </>
  );
}

