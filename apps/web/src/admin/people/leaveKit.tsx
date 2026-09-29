// Pieces shared by the leave pages: balances, the apply dialog, request lists and decisions.
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';

import { command } from '../../data/api';
import { todayIST } from '../../data/attendance';
import { applyLeave, available, daysLabel, type HalfDay, type LeaveBalance, type LeaveRequest, type LeaveType, type LedgerEntry } from '../../data/leave';
import { paths } from '../../paths';
import { day as dayFmt } from '../../shared/format';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';

const TONE: Record<string, string> = { PENDING: 'info', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'muted' };

export function LeaveBadge({ status }: { status: string }) {
  return <span className={`badge badge-${TONE[status] ?? 'muted'}`}>{ht.leaveStatus[status] ?? status}</span>;
}

/** One card per active type: days left, and what makes it up. */
export function BalanceCards({ types, balance }: { types: LeaveType[]; balance: LeaveBalance | null }) {
  // Types granted by hand only show once someone has been granted days.
  const shown = types.filter((ty) => (ty.status === 'ACTIVE' && ty.accrual !== 'MANUAL') || balance?.types[ty.id]);
  return (
    <ul className="balance-cards" aria-label={ht.balance}>
      {shown.map((ty) => {
        const b = balance?.types[ty.id];
        return (
          <li key={ty.id} className="card balance-card">
            <span className="muted small">
              {ty.name} ({ty.code})
            </span>
            <strong className="balance-value">{ty.unlimited ? ht.unlimited : ht.balanceLeft(String(available(b)))}</strong>
            <span className="muted small">{ty.unlimited ? `${ht.unpaid} · ${daysLabel(b?.used ?? 0)}` : ht.balanceDetail((b?.credited ?? 0) + (b?.adjusted ?? 0), b?.used ?? 0, b?.pending ?? 0)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Apply for leave: your own, or with `employee` on their behalf. */
export function ApplyLeaveDialog({
  orgId,
  types,
  balance,
  employee,
  onClose,
  onDone,
}: {
  orgId: string;
  types: LeaveType[];
  balance: LeaveBalance | null;
  employee?: { id: string; fullName: string };
  onClose: () => void;
  onDone: (days: number) => void;
}) {
  const active = types.filter((ty) => ty.status === 'ACTIVE');
  const [typeId, setTypeId] = useState(active[0]?.id ?? '');
  const [from, setFrom] = useState(todayIST());
  const [to, setTo] = useState(todayIST());
  const [halfDay, setHalfDay] = useState<HalfDay>('NONE');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const type = active.find((ty) => ty.id === typeId);
  const errors = {
    from: isDate(from) ? undefined : t.required,
    to: !isDate(to) ? t.required : to < from ? 'Must not be before the start.' : to.slice(0, 4) !== from.slice(0, 4) ? 'Apply separately for each year.' : undefined,
    halfDay: halfDay !== 'NONE' && from !== to ? ht.halfDayHint : undefined,
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const res = await applyLeave({ orgId, ...(employee ? { employeeId: employee.id } : {}), typeId, from, to, halfDay, reason: reason.trim() });
    onDone(res.days);
    onClose();
  });
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const left = type && !type.unlimited && balance?.year === from.slice(0, 4) ? available(balance.types[type.id]) : null;
  return (
    <Dialog title={employee ? ht.applyLeaveFor(employee.fullName) : ht.applyLeave} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <SelectField
          label={ht.leaveType}
          value={typeId}
          onChange={setTypeId}
          options={active.map((ty) => ({ value: ty.id, label: ty.unlimited ? `${ty.name} · ${ht.unpaid}` : ty.name }))}
        />
        {left !== null && <p className="muted small">{ht.balanceLeft(String(left))}</p>}
        <div className="form-grid">
          <TextField
            label={ht.leaveFrom}
            type="date"
            value={from}
            onChange={(v) => {
              setFrom(v);
              if (!to || to < v) setTo(v);
            }}
            error={e('from')}
          />
          <TextField label={ht.leaveTo} type="date" value={to} onChange={setTo} error={e('to')} />
        </div>
        {type?.allowHalfDay && (
          <SelectField
            label={ht.leaveHalfDay}
            value={halfDay}
            onChange={(v) => setHalfDay(v as HalfDay)}
            options={(['NONE', 'FIRST', 'SECOND'] as const).map((h) => ({ value: h, label: ht.halfDays[h] }))}
            hint={ht.halfDayHint}
            error={e('halfDay')}
          />
        )}
        <TextField label={ht.leaveReason} value={reason} onChange={setReason} error={e('reason')} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={employee ? ht.applyOnBehalf : ht.applyLeave} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Cancel a request; a note is required when it isn't your own. */
export function CancelLeaveDialog({ orgId, request, own, onClose, onDone }: { orgId: string; request: LeaveRequest; own: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = !own && note.trim().length < 3;
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (invalid) return;
    await command('leave-cancel', { orgId, leaveId: request.id, note: note.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.cancelLeaveTitle} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p>
          {request.typeName} · {ht.leaveDates(request.from, request.to)} · {daysLabel(request.days)}
        </p>
        <p className="muted">{ht.cancelLeaveBody}</p>
        <TextField label={own ? t.reasonLabel : ht.cancelNote} value={note} onChange={setNote} error={touched && invalid ? t.required : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.cancelLeave} onCancel={onClose} danger />
      </form>
    </Dialog>
  );
}

/** Approve or reject leave (a reason is required to reject). */
export function useLeaveDecision(orgId: string, onDone: () => void) {
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approve = async (r: LeaveRequest) => {
    setError(null);
    try {
      await command('leave-decide', { orgId, leaveId: r.id, decision: 'APPROVE' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorGeneric);
    }
  };
  const dialog = rejecting && (
    <ConfirmWithReason
      title={ht.rejectLeaveTitle(rejecting.employeeName)}
      body={ht.rejectLeaveBody}
      confirmLabel={ht.reject}
      onClose={() => setRejecting(null)}
      onConfirm={async (note) => {
        await command('leave-decide', { orgId, leaveId: rejecting.id, decision: 'REJECT', note });
        setRejecting(null);
        onDone();
      }}
    />
  );
  return { approve, reject: setRejecting, dialog, error };
}

/** A table of requests. `who` shows the employee column; `actions` renders row buttons. */
export function RequestTable({ requests, who, actions, empty }: { requests: LeaveRequest[]; who?: (r: LeaveRequest) => string; actions?: (r: LeaveRequest) => ReactNode; empty: string }) {
  if (!requests.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">{ht.colName}</th>}
            <th scope="col">{ht.leaveType}</th>
            <th scope="col">{ht.leaveDatesCol}</th>
            <th scope="col">{ht.leaveReason}</th>
            <th scope="col">{ht.colStatus}</th>
            {actions && (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              {who && (
                <td>
                  <Link to={paths.adminEmployee(r.employeeId)}>{r.employeeName}</Link>
                  <div className="muted small">{who(r)}</div>
                </td>
              )}
              <td>
                {r.typeName}
                {!r.paid && <div className="muted small">{ht.unpaid}</div>}
              </td>
              <td className="nowrap">
                {ht.leaveDates(r.from, r.to)}
                <div className="muted small">
                  {daysLabel(r.days)}
                  {r.halfDay !== 'NONE' && ` · ${ht.halfDays[r.halfDay]}`}
                </div>
              </td>
              <td>
                {r.reason}
                {(r.decisionNote || r.cancelNote) && <div className="muted small">{r.cancelNote ?? r.decisionNote}</div>}
              </td>
              <td>
                <LeaveBadge status={r.status} />
              </td>
              {actions && <td className="cell-actions">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Adds or removes days by hand (HR). */
export function AdjustBalanceDialog({ orgId, employee, types, year, onClose, onDone }: { orgId: string; employee: { id: string; fullName: string }; types: LeaveType[]; year: string; onClose: () => void; onDone: () => void }) {
  const kept = types.filter((ty) => !ty.unlimited);
  const [typeId, setTypeId] = useState(kept[0]?.id ?? '');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const n = Number(days);
  const errors = {
    days: days.trim() && Number.isFinite(n) && n !== 0 && Math.abs(n) <= 365 ? undefined : 'Enter a number of days, e.g. 3 or -1.5.',
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.days || errors.reason) return;
    await command('leave-adjust', { orgId, employeeId: employee.id, typeId, year, days: n, reason: reason.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.adjustBalanceTitle(employee.fullName)} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p className="muted small">{ht.adjustDaysHint}</p>
        <div className="form-grid">
          <SelectField label={ht.leaveType} value={typeId} onChange={setTypeId} options={kept.map((ty) => ({ value: ty.id, label: ty.name }))} />
          <TextField label={ht.adjustDays} type="number" value={days} onChange={setDays} error={touched ? errors.days : undefined} />
        </div>
        <p className="muted small">
          {ht.yearLabel} {year}
        </p>
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function LedgerList({ entries, types }: { entries: LedgerEntry[]; types: LeaveType[] }) {
  if (!entries.length) return <p className="muted">{ht.ledgerEmpty}</p>;
  const name = (id: string) => types.find((ty) => ty.id === id)?.name ?? id;
  return (
    <ul className="plain-list">
      {entries
        .filter((e) => e.days !== 0)
        .map((e) => (
          <li key={e.id}>
            <span>
              <strong>
                {e.days > 0 ? '+' : ''}
                {e.days}
              </strong>{' '}
              {name(e.typeId)} · {ht.ledgerKinds[e.kind] ?? e.kind}
              {e.period && ` · ${e.period}`}
              {e.note && <span className="muted small"> · {e.note}</span>}
            </span>
            <span className="muted small">{e.at ? dayFmt(e.at) : ''}</span>
          </li>
        ))}
    </ul>
  );
}
