// Pieces shared by the attendance pages: status badge, dialogs and the month table.
import { useState } from 'react';

import { command } from '../../data/api';
import { type AttendanceRecord, type Correction, hhmm, hours, type Shift, timeOf, type Weekday, WEEKDAYS } from '../../data/attendance';
import type { Employee } from '../../data/hr';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { TableWrap } from '../../shared/ui';

const TONE: Record<string, string> = { PRESENT: 'ok', HALF_DAY: 'warn', ABSENT: 'danger', WEEKLY_OFF: 'muted', HOLIDAY: 'info', ON_LEAVE: 'info', IN_PROGRESS: 'info', NOT_IN: 'muted' };

export function DayBadge({ status }: { status: string }) {
  return <span className={`badge badge-${TONE[status] ?? 'muted'}`}>{ht.dayStatus[status] ?? status}</span>;
}

/** Late, left early, missing check-out. */
export function DayFlags({ r }: { r: Pick<AttendanceRecord, 'late' | 'lateMinutes' | 'earlyExit' | 'missedCheckout' | 'status'> }) {
  const flags = [r.late && ht.lateBy(r.lateMinutes), r.earlyExit && r.status !== 'IN_PROGRESS' && ht.leftEarly, r.missedCheckout && ht.missedCheckout].filter(Boolean);
  return flags.length ? <div className="small warn-text">{flags.join(' · ')}</div> : null;
}

const timeOk = (v: string) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export function AdjustDialog({ orgId, employee, date, record, onClose, onDone }: { orgId: string; employee: { id: string; fullName: string }; date: string; record?: AttendanceRecord | null; onClose: () => void; onDone: () => void }) {
  const [checkIn, setIn] = useState(hhmm(record?.checkIn ?? null));
  const [checkOut, setOut] = useState(hhmm(record?.checkOut ?? null));
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const errors = {
    checkIn: timeOk(checkIn) ? undefined : 'Use HH:MM.',
    checkOut: !timeOk(checkOut) ? 'Use HH:MM.' : checkOut && !checkIn ? 'Enter the check-in time too.' : undefined,
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.checkIn || errors.checkOut || errors.reason) return;
    await command('attendance-adjust', { orgId, employeeId: employee.id, date, checkIn: checkIn || null, checkOut: checkOut || null, reason: reason.trim() });
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
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
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

/** Approve or reject corrections (the reason is required to reject). */
export function useCorrectionDecision(orgId: string, onDone: () => void) {
  const [rejecting, setRejecting] = useState<Correction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approve = async (c: Correction) => {
    setError(null);
    try {
      await command('attendance-decideCorrection', { orgId, correctionId: c.id, decision: 'APPROVE' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    }
  };
  const dialog = rejecting && (
    <ConfirmWithReason
      title={ht.rejectCorrectionTitle(rejecting.employeeName, rejecting.date)}
      body={ht.rejectCorrectionBody}
      confirmLabel={ht.reject}
      onClose={() => setRejecting(null)}
      onConfirm={async (note) => {
        await command('attendance-decideCorrection', { orgId, correctionId: rejecting.id, decision: 'REJECT', note });
        setRejecting(null);
        onDone();
      }}
    />
  );
  return { approve, reject: setRejecting, dialog, error };
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
