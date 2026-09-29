// Pieces shared by the payroll pages: status badge, line editors, salary and inputs dialogs, payslip lists.
import { useId, useState } from 'react';

import { command } from '../../data/api';
import { monthIST } from '../../data/attendance';
import { type Adjustment, type Component, downloadPayslip, getInputs, money, monthName, type Payslip, type Salary } from '../../data/payroll';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';

const TONE: Record<string, string> = { NONE: 'muted', DRAFT: 'info', SUBMITTED: 'warn', APPROVED: 'ok' };

export function RunBadge({ status }: { status: string }) {
  return <span className={`badge badge-${TONE[status] ?? 'muted'}`}>{ht.runStatus[status] ?? status}</span>;
}

const whole = (v: string) => /^\d+$/.test(v.trim());

/** An editable line: amounts stay text until saved. */
type Row = { code?: string; name: string; amount: string };

/** Rows of name + amount (and a code for salary components), with add and remove. */
function LineRows({
  legend,
  hint,
  rows,
  onChange,
  withCode,
  addLabel,
  touched,
}: {
  legend: string;
  hint?: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  withCode?: boolean;
  addLabel: string;
  touched: boolean;
}) {
  const hintId = useId();
  const set = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <fieldset className="choices line-rows" aria-describedby={hint ? hintId : undefined}>
      <legend>{legend}</legend>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {rows.map((r, i) => (
        <div key={i} className={withCode ? 'line-row line-row-code' : 'line-row'}>
          {withCode && <TextField label={ht.componentCode} value={r.code ?? ''} onChange={(v) => set(i, 'code', v.toUpperCase())} error={touched && !/^[A-Z][A-Z0-9_]{0,15}$/.test(r.code ?? '') ? 'Letters, e.g. HRA.' : undefined} />}
          <TextField label={withCode ? ht.componentName : ht.lineName} value={r.name} onChange={(v) => set(i, 'name', v)} error={touched && r.name.trim().length < 2 ? t.required : undefined} />
          <TextField label={withCode ? ht.componentAmount : ht.lineAmount} type="number" value={r.amount} onChange={(v) => set(i, 'amount', v)} error={touched && !whole(r.amount) ? 'Whole rupees.' : undefined} />
          <button type="button" className="btn btn-text" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`${ht.removeLine} ${r.name || i + 1}`}>
            {ht.removeLine}
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-text" onClick={() => onChange([...rows, { name: '', amount: '', ...(withCode ? { code: '' } : {}) }])}>
        {addLabel}
      </button>
    </fieldset>
  );
}

const toRows = (xs: { code?: string; name: string; amount: number }[]): Row[] => xs.map((x) => ({ ...x, amount: String(x.amount) }));
const rowsOk = (rows: Row[], withCode = false) =>
  rows.every((r) => r.name.trim().length >= 2 && whole(r.amount) && (!withCode || /^[A-Z][A-Z0-9_]{0,15}$/.test(r.code ?? '')));
const fromRows = (rows: Row[]) => rows.map((r) => ({ ...r, name: r.name.trim(), amount: Number(r.amount) }));

const STARTER: Component[] = [
  { code: 'BASIC', name: 'Basic', amount: 0 },
  { code: 'HRA', name: 'House rent allowance', amount: 0 },
  { code: 'SPECIAL', name: 'Special allowance', amount: 0 },
];

/** A new salary version from a month (starts from the latest one). */
export function SalaryDialog({ orgId, employee, latest, onClose, onDone }: { orgId: string; employee: { id: string; fullName: string }; latest: Salary | null; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(monthIST());
  const [rows, setRows] = useState(toRows(latest?.earnings ?? STARTER));
  const [flags, setFlags] = useState({ pf: latest?.pf ?? true, esi: latest?.esi ?? true, pt: latest?.pt ?? true });
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const gross = rows.reduce((n, r) => n + (whole(r.amount) ? Number(r.amount) : 0), 0);
  const errors = {
    from: /^\d{4}-\d{2}$/.test(from) ? undefined : t.required,
    rows: !rows.length ? 'Add at least one component.' : !rows.some((r) => r.code === 'BASIC') ? 'Include a BASIC component.' : new Set(rows.map((r) => r.code)).size !== rows.length ? 'Each code once.' : undefined,
    reason: reason.trim().length >= 3 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.from || errors.rows || errors.reason || !rowsOk(rows, true)) return;
    await command('salary-save', { orgId, employeeId: employee.id, effectiveFrom: from, earnings: fromRows(rows), ...flags, reason: reason.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.salaryTitle(employee.fullName)} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.salaryFrom} hint={ht.salaryFromHint} type="month" value={from} onChange={setFrom} error={touched ? errors.from : undefined} />
        <LineRows legend={ht.salaryComponents} hint={ht.salaryComponentsHint} rows={rows} onChange={setRows} withCode addLabel={ht.addComponent} touched={touched} />
        {touched && errors.rows && <p className="field-error">{errors.rows}</p>}
        <p>
          <strong>{ht.monthlyGross(money(gross))}</strong>
        </p>
        <fieldset className="choices">
          <legend className="sr-only">{ht.salary}</legend>
          {(
            [
              ['pf', ht.salaryPf],
              ['esi', ht.salaryEsi],
              ['pt', ht.salaryPt],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} /> {label}
            </label>
          ))}
        </fieldset>
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** TDS and one-off earnings or deductions for a month. */
export function InputsDialog({ orgId, employee, month, onClose, onDone }: { orgId: string; employee: { id: string; fullName: string }; month: string; onClose: () => void; onDone: () => void }) {
  const current = useAsync(() => getInputs(orgId, employee.id, month), [orgId, employee.id, month]);
  if (current.loading) return null;
  return <InputsForm orgId={orgId} employee={employee} month={month} initial={current.data ?? null} onClose={onClose} onDone={onDone} />;
}

function InputsForm({ orgId, employee, month, initial, onClose, onDone }: { orgId: string; employee: { id: string; fullName: string }; month: string; initial: { tds: number; otherEarnings: Adjustment[]; otherDeductions: Adjustment[] } | null; onClose: () => void; onDone: () => void }) {
  const [tds, setTds] = useState(String(initial?.tds ?? 0));
  const [earn, setEarn] = useState(toRows(initial?.otherEarnings ?? []));
  const [ded, setDed] = useState(toRows(initial?.otherDeductions ?? []));
  const [touched, setTouched] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (!whole(tds) || !rowsOk(earn) || !rowsOk(ded)) return;
    await command('payroll-setInputs', { orgId, employeeId: employee.id, month, tds: Number(tds), otherEarnings: fromRows(earn), otherDeductions: fromRows(ded) });
    onDone();
    onClose();
  });
  return (
    <Dialog title={ht.inputsTitle(employee.fullName, monthName(month))} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted small">{ht.inputsHint}</p>
        <TextField label={ht.tds} type="number" value={tds} onChange={setTds} error={touched && !whole(tds) ? 'Whole rupees.' : undefined} />
        <LineRows legend={ht.otherEarnings} rows={earn} onChange={setEarn} addLabel={ht.addLine} touched={touched} />
        <LineRows legend={ht.otherDeductions} rows={ded} onChange={setDed} addLabel={ht.addLine} touched={touched} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** A PDF download button with its own error message. */
export function PayslipButton({ orgId, slip, label }: { orgId: string; slip: Pick<Payslip, 'employeeId' | 'employeeName' | 'month'>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-text"
        disabled={busy}
        aria-label={ht.downloadPayslipFor(slip.employeeName, monthName(slip.month))}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await downloadPayslip(orgId, slip.employeeId, slip.month);
          } catch (e) {
            setError(e instanceof Error ? e.message : t.errorGeneric);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t.saving : (label ?? ht.downloadPayslip)}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** One person's payslips by month. */
export function PayslipList({ orgId, slips }: { orgId: string; slips: Payslip[] }) {
  if (!slips.length) return <p className="muted">{ht.noPayslips}</p>;
  return (
    <ul className="plain-list">
      {slips.map((s) => (
        <li key={s.id}>
          <span>
            <strong>{monthName(s.month)}</strong> · {ht.colNet} {money(s.net)}
            <span className="muted small">
              {' '}
              · {ht.colGross} {money(s.gross)} · {ht.colPayable} {s.days.payable}/{s.days.inMonth}
            </span>
            {!s.published && <span className="badge badge-info"> {ht.draftSlip}</span>}
          </span>
          <PayslipButton orgId={orgId} slip={s} />
        </li>
      ))}
    </ul>
  );
}
