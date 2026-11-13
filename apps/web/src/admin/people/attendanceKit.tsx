// Pieces shared by the attendance pages: status badge, dialogs and the month table.
import { useState } from 'react';

import { ApiError, command, errorText } from '../../data/api';
import { type AttendanceRecord, type Correction, hhmm, hours, type Shift, timeOf, type Weekday, WEEKDAYS } from '../../data/attendance';
import type { Employee } from '../../data/hr';
import { todayIST } from '../../shared/dates';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { makeStatusBadge, TableWrap } from '../../shared/ui';
import { AT_ONCE, runEach, useDecisions } from './decisions';

export const DayBadge = makeStatusBadge<string>(
  { PRESENT: 'ok', HALF_DAY: 'warn', ABSENT: 'danger', WEEKLY_OFF: 'muted', HOLIDAY: 'info', ON_LEAVE: 'info', IN_PROGRESS: 'info', NOT_IN: 'muted' },
  ht.dayStatus,
);

/** Late, left early, missing check-out. */
export function DayFlags({ r }: { r: Pick<AttendanceRecord, 'late' | 'lateMinutes' | 'earlyExit' | 'missedCheckout' | 'status'> }) {
  const flags = [r.late && ht.lateBy(r.lateMinutes), r.earlyExit && r.status !== 'IN_PROGRESS' && ht.leftEarly, r.missedCheckout && ht.missedCheckout].filter(Boolean);
  return flags.length ? <div className="small warn-text">{flags.join(' · ')}</div> : null;
}

const timeOk = (v: string) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** A shift's hours as the dialogs need them. */
export type ShiftHours = Pick<Shift, 'start' | 'end'>;

/** The reason last used to adjust a day, offered again in the next dialog (this visit to the page only). */
let lastReason = '';

const dayBefore = (date: string) => new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);

/**
 * The times to start from for a day with a punch missing: the shift's own, for a day that is over. Never for
 * today (a check-out that has not happened would be recorded), nor for the last night of an overnight shift,
 * nor over a full day of leave. No check-out either when a day shift ends at or before the check-in already
 * recorded: the server takes a check-out that is not later than the check-in as the next morning.
 */
export function shiftDefault(
  date: string,
  shift: ShiftHours | null | undefined,
  record: (Pick<AttendanceRecord, 'leave'> & Partial<Pick<AttendanceRecord, 'checkIn'>>) | null | undefined,
  today = todayIST(),
): { checkIn: string; checkOut: string } | null {
  if (!shift || date >= today || (record?.leave && !record.leave.half)) return null;
  const overnight = shift.end <= shift.start;
  const cameAt = hhmm(record?.checkIn ?? null);
  const noCheckOut = overnight ? date >= dayBefore(today) : !!cameAt && shift.end <= cameAt;
  return { checkIn: shift.start, checkOut: noCheckOut ? '' : shift.end };
}

/**
 * Sets a day's times, with a reason. `shift` is the person's current shift (the server works the day out
 * from it): a time missing on a past day starts from it, and Clear times empties both (the day was not worked).
 */
export function AdjustDialog({
  orgId,
  employee,
  date,
  record,
  shift,
  onClose,
  onDone,
}: {
  orgId: string;
  employee: { id: string; fullName: string };
  date: string;
  record?: AttendanceRecord | null;
  shift?: ShiftHours | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const fill = shiftDefault(date, shift, record);
  const [checkIn, setIn] = useState(hhmm(record?.checkIn ?? null) || (fill?.checkIn ?? ''));
  const [checkOut, setOut] = useState(hhmm(record?.checkOut ?? null) || (fill?.checkOut ?? ''));
  const [reason, setReason] = useState(lastReason);
  const [touched, setTouched] = useState(false);
  // Said only while a filled-in time is still there.
  const filled = !!fill && ((!record?.checkIn && checkIn === fill.checkIn && !!checkIn) || (!record?.checkOut && checkOut === fill.checkOut && !!checkOut));
  const errors = {
    checkIn: timeOk(checkIn) ? undefined : 'Use HH:MM.',
    checkOut: !timeOk(checkOut) ? 'Use HH:MM.' : checkOut && !checkIn ? 'Enter the check-in time too.' : undefined,
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.checkIn || errors.checkOut || errors.reason) return;
    await command('attendance-adjust', { orgId, employeeId: employee.id, date, checkIn: checkIn || null, checkOut: checkOut || null, reason: reason.trim() });
    lastReason = reason.trim();
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.adjustTitle(employee.fullName, date)} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p className="muted small">{ht.adjustHint}</p>
        <div className="form-grid">
          <TextField label={ht.checkInTime} type="time" value={checkIn} onChange={setIn} error={touched ? errors.checkIn : undefined} />
          <TextField label={ht.checkOutTime} type="time" value={checkOut} onChange={setOut} error={touched ? errors.checkOut : undefined} />
        </div>
        {filled && shift && <p className="field-hint">{ht.adjustShiftFilled(shift.start, shift.end)}</p>}
        {(checkIn || checkOut) && (
          <button
            type="button"
            className="btn btn-text"
            onClick={() => {
              setIn('');
              setOut('');
            }}
          >
            {ht.clearTimes}
          </button>
        )}
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** The month is closed: every other person of the same branch would be refused for the same reason. */
const monthClosed = (e: unknown) => e instanceof ApiError && e.reason === 'MONTH_FINALIZED';
/** Not sent: the month of this person's branch turned out to be closed. */
const NOT_TRIED = new Error('not tried');

/**
 * One past day for several people (a day the punches were missed): each person gets their own shift's times,
 * or the times set here, with one reason. Every person is their own command, a few at a time, so one refusal
 * does not stop the others. Only a closed month ends it early, and only for the people of that branch (months
 * are closed branch by branch, head office on its own). `onSettled` hears who was adjusted and why the others
 * were not (shown on their rows, here and on the board, which keeps them ticked).
 */
export function AdjustManyDialog({
  orgId,
  date,
  people,
  problems,
  onClose,
  onSettled,
}: {
  orgId: string;
  date: string;
  people: { employee: { id: string; fullName: string; branchId: string | null }; shift: ShiftHours | null }[];
  problems: Readonly<Record<string, string>>;
  onClose: () => void;
  onSettled: (done: string[], problems: Record<string, string>) => void;
}) {
  const [ownShift, setOwnShift] = useState(true);
  const [checkIn, setIn] = useState('');
  const [checkOut, setOut] = useState('');
  const [reason, setReason] = useState(lastReason);
  const [touched, setTouched] = useState(false);
  const errors = {
    checkIn: ownShift ? undefined : !checkIn ? t.required : timeOk(checkIn) ? undefined : 'Use HH:MM.',
    checkOut: ownShift || timeOk(checkOut) ? undefined : 'Use HH:MM.',
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  /** The times a person would get, or null when there are none to use (no shift, or its last night is not over). */
  const timesFor = (shift: ShiftHours | null) => {
    if (!ownShift) return { checkIn, checkOut };
    const own = shiftDefault(date, shift, null);
    return own?.checkOut ? own : null;
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.checkIn || errors.checkOut || errors.reason) return;
    const done: string[] = [];
    const failed: Record<string, string> = {};
    const ready = people.filter((p) => {
      if (timesFor(p.shift)) return true;
      failed[p.employee.id] = ht.adjustManyNoShift;
      return false;
    });
    // Branches (null is head office) whose month was refused as closed: a branch is only ever added.
    const closed = new Set<string | null>();
    await runEach(
      ready,
      AT_ONCE,
      async (p) => {
        if (closed.has(p.employee.branchId)) throw NOT_TRIED;
        const times = timesFor(p.shift)!;
        try {
          await command('attendance-adjust', { orgId, employeeId: p.employee.id, date, checkIn: times.checkIn, checkOut: times.checkOut || null, reason: reason.trim() });
        } catch (e) {
          if (monthClosed(e)) closed.add(p.employee.branchId);
          throw e;
        }
      },
      (p, failure) => {
        if (failure === NOT_TRIED) failed[p.employee.id] = ht.adjustManyStopped;
        else if (failure) failed[p.employee.id] = errorText(failure);
        else done.push(p.employee.id);
      },
    );
    lastReason = reason.trim();
    onSettled(done, failed);
    if (!Object.keys(failed).length) onClose();
  });
  return (
    <Dialog title={ht.adjustManyTitle(people.length, date)} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted small">{ht.adjustManyHint}</p>
        <ul className="plain-list">
          {people.map(({ employee, shift }) => (
            <li key={employee.id}>
              <span>
                {employee.fullName}
                {problems[employee.id] && (
                  <span className="field-error" role="alert">
                    {' '}
                    {problems[employee.id]}
                  </span>
                )}
              </span>
              <span className="muted small">{ownShift ? (shift ? `${shift.start}–${shift.end}` : ht.noShift) : checkIn ? `${checkIn}–${checkOut || '—'}` : ''}</span>
            </li>
          ))}
        </ul>
        <label className="check">
          <input type="checkbox" checked={ownShift} onChange={(e) => setOwnShift(e.target.checked)} /> {ht.useShiftTimes}
        </label>
        {!ownShift && (
          <div className="form-grid">
            <TextField label={ht.checkInTime} type="time" value={checkIn} onChange={setIn} error={touched ? errors.checkIn : undefined} />
            <TextField label={ht.checkOutTime} type="time" value={checkOut} onChange={setOut} error={touched ? errors.checkOut : undefined} />
          </div>
        )}
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.adjustSelected(people.length)} onCancel={onClose} disabled={!people.length} />
      </form>
    </Dialog>
  );
}

export function ShiftDialog({ orgId, employee, shifts, onClose, onDone }: { orgId: string; employee: Employee; shifts: Shift[]; onClose: () => void; onDone: () => void }) {
  const current = employee;
  const [shiftId, setShiftId] = useState(current.shiftId ?? '');
  const [useBranch, setUseBranch] = useState(!current.weeklyOffs);
  const [offs, setOffs] = useState<Weekday[]>(current.weeklyOffs ?? ['SUN']);
  const { busy, error, submit } = useSubmit(async () => {
    await command('attendance-assignShift', { orgId, employeeId: employee.id, shiftId: shiftId || null, weeklyOffs: useBranch ? null : offs });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.setShiftTitle(employee.fullName)} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <SelectField
          label={ht.setShift}
          value={shiftId}
          onChange={setShiftId}
          options={[
            { value: '', label: ht.noShift },
            ...shifts.filter((s) => s.status === 'ACTIVE' || s.id === shiftId).map((s) => ({ value: s.id, label: ht.shiftTimes(s.name, s.start, s.end) })),
          ]}
        />
        <fieldset className="choices">
          <legend>{ht.weeklyOffs}</legend>
          <label className="check">
            <input type="checkbox" checked={useBranch} onChange={(e) => setUseBranch(e.target.checked)} /> {ht.branchDefault}
          </label>
          {!useBranch && (
            <div className="weekday-picks">
              {WEEKDAYS.map((d) => (
                <label key={d} className="check">
                  <input type="checkbox" checked={offs.includes(d)} onChange={() => setOffs(offs.includes(d) ? offs.filter((x) => x !== d) : [...offs, d])} /> {ht.weekdays[d]}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function CorrectionRequestDialog({ orgId, defaultDate, onClose, onDone }: { orgId: string; defaultDate: string; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(defaultDate);
  const [checkIn, setIn] = useState('');
  const [checkOut, setOut] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const errors = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? undefined : t.required,
    checkIn: !checkIn ? t.required : timeOk(checkIn) ? undefined : 'Use HH:MM.',
    checkOut: timeOk(checkOut) ? undefined : 'Use HH:MM.',
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    await command('attendance-requestCorrection', { orgId, date, checkIn, checkOut: checkOut || null, reason: reason.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.correctionTitle} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.correctionDate} type="date" value={date} onChange={setDate} error={touched ? errors.date : undefined} />
        <div className="form-grid">
          <TextField label={ht.checkInTime} type="time" value={checkIn} onChange={setIn} error={touched ? errors.checkIn : undefined} />
          <TextField label={ht.checkOutTime} type="time" value={checkOut} onChange={setOut} error={touched ? errors.checkOut : undefined} />
        </div>
        <TextField label={ht.correctionReason} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.requestCorrection} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/**
 * Approve or reject corrections (the reason is required to reject), each with its own command. Several can be
 * on their way at once: `busy(id)` marks a row, `failed[id]` is why it was refused. `onDone` hears about each
 * correction decided, `onIdle` once nothing is on its way any more.
 */
export function useCorrectionDecision(orgId: string, onDone: (c: Correction) => void, onIdle?: () => void) {
  const decision = useDecisions<Correction>((c, how, note) => command('attendance-decideCorrection', { orgId, correctionId: c.id, decision: how, ...(how === 'REJECT' ? { note } : {}) }), onDone, onIdle);
  const { rejecting } = decision;
  const dialog = rejecting && (
    <ConfirmWithReason
      title={ht.rejectCorrectionTitle(rejecting.employeeName, rejecting.date)}
      body={ht.rejectCorrectionBody}
      confirmLabel={ht.reject}
      onClose={() => decision.reject(null)}
      onConfirm={decision.confirmReject}
    />
  );
  return { ...decision, dialog };
}

/** A month of one person's days. `onAdjust` adds an Adjust button per row. */
export function MonthRecords({ records, onAdjust }: { records: AttendanceRecord[]; onAdjust?: (r: AttendanceRecord) => void }) {
  if (!records.length) return <p className="muted">{ht.noRecords}</p>;
  return (
    <TableWrap>
      <table className="table compact">
        <thead>
          <tr>
            <th scope="col">{ht.day}</th>
            <th scope="col">{ht.colStatus}</th>
            <th scope="col">{ht.inCol}</th>
            <th scope="col">{ht.outCol}</th>
            <th scope="col">{ht.workedCol}</th>
            {onAdjust && (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">
                {r.date}
                <div className="muted small">{ht.sources[r.source] ?? r.source}</div>
              </td>
              <td>
                <DayBadge status={r.status} />
                <DayFlags r={r} />
              </td>
              <td className="nowrap">{timeOf(r.checkIn)}</td>
              <td className="nowrap">{timeOf(r.checkOut)}</td>
              <td className="nowrap">{r.workedMinutes ? hours(r.workedMinutes) : '—'}</td>
              {onAdjust && (
                <td className="cell-actions">
                  {!r.finalized && (
                    <button type="button" className="btn btn-text" onClick={() => onAdjust(r)} aria-label={`${ht.adjust} ${r.date}`}>
                      {ht.adjust}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
