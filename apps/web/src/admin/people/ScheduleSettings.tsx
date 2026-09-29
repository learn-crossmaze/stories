// HR settings: shifts and holidays.
import { useState } from 'react';

import { command } from '../../data/api';
import { type Holiday, listHolidays, listShifts, type Shift } from '../../data/attendance';
import { ErrorState, Icon, SkeletonRows, StatusBadge, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { useWorkspace } from '../Workspace';

const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isCount = (v: string, max: number) => /^\d+$/.test(v) && Number(v) <= max;

function ShiftDialog({ orgId, shift, onClose, onSaved }: { orgId: string; shift?: Shift; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: shift?.name ?? '',
    start: shift?.start ?? '09:30',
    end: shift?.end ?? '18:00',
    breakMinutes: String(shift?.breakMinutes ?? 30),
    graceMinutes: String(shift?.graceMinutes ?? 10),
    halfDayMinutes: String(shift?.halfDayMinutes ?? 240),
    fullDayMinutes: String(shift?.fullDayMinutes ?? 480),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const [touched, setTouched] = useState(false);
  const errors = {
    name: f.name.trim().length >= 2 ? undefined : t.required,
    start: isTime(f.start) ? undefined : 'Use HH:MM.',
    end: !isTime(f.end) ? 'Use HH:MM.' : f.end === f.start ? 'Must differ from the start.' : undefined,
    breakMinutes: isCount(f.breakMinutes, 240) ? undefined : '0 to 240.',
    graceMinutes: isCount(f.graceMinutes, 120) ? undefined : '0 to 120.',
    halfDayMinutes: isCount(f.halfDayMinutes, 1440) ? undefined : 'Enter minutes.',
    fullDayMinutes: !isCount(f.fullDayMinutes, 1440) ? 'Enter minutes.' : Number(f.fullDayMinutes) < Number(f.halfDayMinutes) ? 'At least the half-day minutes.' : undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    await command('shifts-save', {
      orgId,
      ...(shift ? { shiftId: shift.id } : {}),
      name: f.name.trim(),
      start: f.start,
      end: f.end,
      breakMinutes: Number(f.breakMinutes),
      graceMinutes: Number(f.graceMinutes),
      halfDayMinutes: Number(f.halfDayMinutes),
      fullDayMinutes: Number(f.fullDayMinutes),
    });
    onSaved();
    onClose();
  });
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  return (
    <Dialog title={shift ? ht.shiftEdit : ht.shiftNew} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={ht.shiftName} value={f.name} onChange={set('name')} error={e('name')} />
          <TextField label={ht.shiftBreak} type="number" value={f.breakMinutes} onChange={set('breakMinutes')} error={e('breakMinutes')} />
          <TextField label={ht.shiftStart} type="time" value={f.start} onChange={set('start')} error={e('start')} />
          <TextField label={ht.shiftEnd} type="time" value={f.end} onChange={set('end')} error={e('end')} />
          <TextField label={ht.shiftGrace} type="number" value={f.graceMinutes} onChange={set('graceMinutes')} error={e('graceMinutes')} />
          <TextField label={ht.shiftHalf} type="number" value={f.halfDayMinutes} onChange={set('halfDayMinutes')} error={e('halfDayMinutes')} />
          <TextField label={ht.shiftFull} type="number" value={f.fullDayMinutes} onChange={set('fullDayMinutes')} error={e('fullDayMinutes')} />
        </div>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function ShiftsSection({ orgId }: { orgId: string }) {
  const shifts = useAsync(() => listShifts(orgId), [orgId]);
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Shift | null>(null);
  return (
    <section className="section" aria-labelledby="shifts">
      <div className="page-header-row">
        <h2 id="shifts">{ht.shifts}</h2>
        <button type="button" className="btn btn-outlined" onClick={() => setEditing('new')}>
          <Icon name="plus" /> {ht.shiftNew}
        </button>
      </div>
      <p className="muted">{ht.shiftsIntro}</p>
      {shifts.loading ? (
        <SkeletonRows rows={2} />
      ) : shifts.error ? (
        <ErrorState message={shifts.error} onRetry={shifts.reload} />
      ) : !shifts.data?.length ? (
        <p className="muted">{ht.shiftsEmpty}</p>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.shiftName}</th>
                <th scope="col">{ht.shiftStart}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shifts.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    {s.start}–{s.end}
                    <div className="muted small">
                      {ht.shiftBreak.replace(' (minutes)', '')} {s.breakMinutes} min · {ht.shiftGrace.split(' (')[0]} {s.graceMinutes} min
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="cell-actions">
                    {s.status === 'ACTIVE' && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => setEditing(s)} aria-label={`${t.edit} ${s.name}`}>
                          {t.edit}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => setArchiving(s)} aria-label={`${t.archive} ${s.name}`}>
                          {t.archive}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing && <ShiftDialog orgId={orgId} shift={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={shifts.reload} />}
      {archiving && (
        <ConfirmWithReason
          title={ht.shiftArchiveTitle(archiving.name)}
          body={ht.shiftArchiveBody}
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command('shifts-archive', { orgId, shiftId: archiving.id, reason });
            setArchiving(null);
            shifts.reload();
          }}
        />
      )}
    </section>
  );
}

function HolidayDialog({ orgId, onClose, onSaved }: { orgId: string; onClose: () => void; onSaved: () => void }) {
  const { branches } = useWorkspace();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const errors = { date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? undefined : t.required, name: name.trim().length >= 2 ? undefined : t.required };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.date || errors.name) return;
    await command('holidays-save', { orgId, date, name: name.trim(), branchIds: picked });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={ht.holidayNew} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.holidayDate} type="date" value={date} onChange={setDate} error={touched ? errors.date : undefined} />
        <TextField label={ht.holidayName} value={name} onChange={setName} error={touched ? errors.name : undefined} />
        <fieldset className="choices">
          <legend>{ht.holidayBranches}</legend>
          <p className="muted small">{ht.holidayBranchesHint}</p>
          {branches
            .filter((b) => b.status === 'ACTIVE')
            .map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={picked.includes(b.id)} onChange={() => setPicked(picked.includes(b.id) ? picked.filter((x) => x !== b.id) : [...picked, b.id])} />{' '}
                {b.name}
              </label>
            ))}
        </fieldset>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function HolidaysSection({ orgId }: { orgId: string }) {
  const { branchName } = useWorkspace();
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const holidays = useAsync(() => listHolidays(orgId, year), [orgId, year]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async (h: Holiday) => {
    setError(null);
    try {
      await command('holidays-remove', { orgId, date: h.date });
      holidays.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    }
  };
  return (
    <section className="section" aria-labelledby="holidays">
      <div className="page-header-row">
        <h2 id="holidays">{ht.holidays}</h2>
        <div className="row">
          <label className="field-inline">
            <span className="sr-only">Year</span>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {[-1, 0, 1].map((d) => {
                const y = String(new Date().getFullYear() + d);
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </label>
          <button type="button" className="btn btn-outlined" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {ht.holidayNew}
          </button>
        </div>
      </div>
      <p className="muted">{ht.holidaysIntro}</p>
      <FormError error={error} />
      {holidays.loading ? (
        <SkeletonRows rows={2} />
      ) : holidays.error ? (
        <ErrorState message={holidays.error} onRetry={holidays.reload} />
      ) : !holidays.data?.length ? (
        <p className="muted">{ht.holidaysEmpty(year)}</p>
      ) : (
        <ul className="plain-list holiday-list">
          {holidays.data.map((h) => (
            <li key={h.id}>
              <span className="mono">{h.date}</span>
              <span>
                {h.name}
                <span className="muted small"> · {h.branchIds.length ? h.branchIds.map(branchName).join(', ') : ht.holidayAllBranches}</span>
              </span>
              <button type="button" className="btn btn-text" onClick={() => void remove(h)} aria-label={`${ht.holidayRemove} ${h.name}`}>
                {ht.holidayRemove}
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <HolidayDialog orgId={orgId} onClose={() => setAdding(false)} onSaved={holidays.reload} />}
    </section>
  );
}
