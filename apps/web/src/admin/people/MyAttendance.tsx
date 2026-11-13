// A staff member's own attendance: today's check-in card (also on the dashboard) and their month.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { type Correction, dayAfterPunch, myCorrections, myDay, myMonth, punch, type PunchedDay, timeOf } from '../../data/attendance';
import { monthIST, todayIST } from '../../shared/dates';
import { type Employee, myEmployee } from '../../data/hr';
import { paths } from '../../paths';
import { EmptyState, ErrorState, Icon, makeStatusBadge, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { ht } from '../../strings/hr';
import { FormError, useAction } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { CorrectionRequestDialog, DayFlags, MonthRecords } from './attendanceKit';

const WORKING = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];
const CorrectionBadge = makeStatusBadge<Correction['status']>({ PENDING: 'info', APPROVED: 'ok', REJECTED: 'danger' }, ht.correctionStatus);

/**
 * Check in / check out for today. Renders nothing for people without an employee record. A page that has
 * already read the person's record passes it as `me`; `onPunched` tells it a punch went through.
 */
export function CheckInCard({ compact, me, onPunched }: { compact?: boolean; me?: Employee; onPunched?: () => void }) {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const data = useAsync(async () => {
    if (!org || !user) return null;
    const [emp, today] = await Promise.all([me ?? myEmployee(org.id, user.uid), myDay(org.id, user.uid, todayIST())]);
    if (!emp || !WORKING.includes(emp.status)) return null;
    return { me: emp, today: today as PunchedDay | null };
  }, [org?.id, user?.uid, me?.id]);
  // Today as the last punch left it, shown over what was loaded (`over`): a new read, another person or another organization drops it.
  const [punched, setPunched] = useState<{ over: unknown; day: PunchedDay | null } | null>(null);
  const { busy, error, run } = useAction();
  if (!data.data) return null;
  const loaded = data.data;
  const today = punched?.over === loaded ? punched.day : loaded.today;
  const act = (action: 'IN' | 'OUT') =>
    run(async () => {
      const day = dayAfterPunch(await punch(org!.id, action), todayIST());
      // The answer says what the day is now, so nothing is read again (an older backend sends no times: read then).
      if (day === undefined) data.reload();
      else setPunched({ over: loaded, day });
      onPunched?.();
    });
  const status = today?.checkOut ? ht.checkedOutAt(timeOf(today.checkOut)) : today?.checkIn ? ht.checkedInAt(timeOf(today.checkIn)) : ht.notCheckedIn;
  return (
    <section className={compact ? 'card checkin-card' : 'card checkin-card checkin-card-lg'} aria-labelledby="checkin-title">
      <div>
        <h2 id="checkin-title">
          <Icon name="clock" /> {ht.todayCard}
        </h2>
        <p className="muted small">{loaded.me.shiftName ?? ht.noShift}</p>
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
  // Own records are found by the account, so neither read waits for the employee record.
  const records = useAsync(() => (org && user ? myMonth(org.id, user.uid, month) : Promise.resolve([])), [org?.id, user?.uid, month]);
  const corrections = useAsync(() => (org && user ? myCorrections(org.id, user.uid) : Promise.resolve([])), [org?.id, user?.uid]);
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
          <CheckInCard me={me.data} onPunched={records.reload} />
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
                    <CorrectionBadge status={c.status} />
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

