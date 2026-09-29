// HR settings: PF, ESI and professional tax, as versions from a month.
import { useState } from 'react';

import { command } from '../../data/api';
import { monthIST } from '../../data/attendance';
import { DEFAULT_SETTINGS, listSettings, type StatutorySettings } from '../../data/payroll';
import { ErrorState, Icon, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';

const num = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());
const whole = (v: string) => /^\d+$/.test(v.trim());
type Str<T> = { [K in keyof T]: T[K] extends number ? string : T[K] extends boolean ? boolean : T[K] };

function SettingsDialog({ orgId, current, onClose, onSaved }: { orgId: string; current: StatutorySettings; onClose: () => void; onSaved: () => void }) {
  const str = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])) as Str<T>;
  const [from, setFrom] = useState(monthIST());
  const [pf, setPf] = useState(str(current.pf));
  const [esi, setEsi] = useState(str(current.esi));
  const [slabs, setSlabs] = useState(current.pt.slabs.map((s) => ({ from: String(s.from), amount: String(s.amount) })));
  const [ptOn, setPtOn] = useState(current.pt.enabled);
  const [feb, setFeb] = useState(current.pt.februaryAmount === null ? '' : String(current.pt.februaryAmount));
  const [touched, setTouched] = useState(false);
  const err = (ok: boolean) => (touched && !ok ? 'Enter a number.' : undefined);
  const valid =
    /^\d{4}-\d{2}$/.test(from) &&
    [pf.employeeRate, pf.employerRate, pf.epsRate, esi.employeeRate, esi.employerRate].every(num) &&
    [pf.wageCeiling, esi.grossLimit].every(whole) &&
    slabs.length > 0 &&
    slabs.every((s) => whole(s.from) && whole(s.amount)) &&
    (feb === '' || whole(feb));
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (!valid) return;
    await command('payrollSettings-save', {
      orgId,
      effectiveFrom: from,
      pf: { enabled: pf.enabled, employeeRate: Number(pf.employeeRate), employerRate: Number(pf.employerRate), epsRate: Number(pf.epsRate), wageCeiling: Number(pf.wageCeiling), capAtCeiling: pf.capAtCeiling },
      esi: { enabled: esi.enabled, employeeRate: Number(esi.employeeRate), employerRate: Number(esi.employerRate), grossLimit: Number(esi.grossLimit) },
      pt: { enabled: ptOn, slabs: slabs.map((s) => ({ from: Number(s.from), amount: Number(s.amount) })), februaryAmount: feb === '' ? null : Number(feb) },
    });
    onSaved();
    onClose();
  });
  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
  return (
    <Dialog title={ht.settingsTitle} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.salaryFrom} type="month" value={from} onChange={setFrom} error={touched && !/^\d{4}-\d{2}$/.test(from) ? t.required : undefined} />
        <fieldset className="choices">
          <legend>{ht.pfSection}</legend>
          {check(ht.enabled, pf.enabled, (v) => setPf({ ...pf, enabled: v }))}
          <div className="form-grid">
            <TextField label={ht.employeeRate} value={pf.employeeRate} onChange={(v) => setPf({ ...pf, employeeRate: v })} error={err(num(pf.employeeRate))} />
            <TextField label={ht.employerRate} value={pf.employerRate} onChange={(v) => setPf({ ...pf, employerRate: v })} error={err(num(pf.employerRate))} />
            <TextField label={ht.epsRate} value={pf.epsRate} onChange={(v) => setPf({ ...pf, epsRate: v })} error={err(num(pf.epsRate))} />
            <TextField label={ht.wageCeiling} value={pf.wageCeiling} onChange={(v) => setPf({ ...pf, wageCeiling: v })} error={err(whole(pf.wageCeiling))} />
          </div>
          {check(ht.capAtCeiling, pf.capAtCeiling, (v) => setPf({ ...pf, capAtCeiling: v }))}
        </fieldset>
        <fieldset className="choices">
          <legend>{ht.esiSection}</legend>
          {check(ht.enabled, esi.enabled, (v) => setEsi({ ...esi, enabled: v }))}
          <div className="form-grid">
            <TextField label={ht.employeeRate} value={esi.employeeRate} onChange={(v) => setEsi({ ...esi, employeeRate: v })} error={err(num(esi.employeeRate))} />
            <TextField label={ht.employerRate} value={esi.employerRate} onChange={(v) => setEsi({ ...esi, employerRate: v })} error={err(num(esi.employerRate))} />
            <TextField label={ht.grossLimit} value={esi.grossLimit} onChange={(v) => setEsi({ ...esi, grossLimit: v })} error={err(whole(esi.grossLimit))} />
          </div>
        </fieldset>
        <fieldset className="choices">
          <legend>{ht.ptSection}</legend>
          {check(ht.enabled, ptOn, setPtOn)}
          {slabs.map((s, i) => (
            <div key={i} className="line-row">
              <TextField label={ht.ptSlabFrom} value={s.from} onChange={(v) => setSlabs(slabs.map((x, j) => (j === i ? { ...x, from: v } : x)))} error={err(whole(s.from))} />
              <TextField label={ht.ptSlabAmount} value={s.amount} onChange={(v) => setSlabs(slabs.map((x, j) => (j === i ? { ...x, amount: v } : x)))} error={err(whole(s.amount))} />
              <button type="button" className="btn btn-text" disabled={slabs.length === 1} onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} aria-label={`${ht.removeLine} ${ht.ptSlabFrom} ${s.from}`}>
                {ht.removeLine}
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-text" onClick={() => setSlabs([...slabs, { from: '', amount: '' }])}>
            {ht.addSlab}
          </button>
          <TextField label={ht.februaryAmount} value={feb} onChange={setFeb} error={touched && feb !== '' && !whole(feb) ? 'Enter a number.' : undefined} />
        </fieldset>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function PayrollSettingsSection({ orgId }: { orgId: string }) {
  const versions = useAsync(() => listSettings(orgId), [orgId]);
  const [editing, setEditing] = useState(false);
  const list = versions.data?.length ? versions.data : [DEFAULT_SETTINGS];
  return (
    <section className="section" aria-labelledby="payroll-settings">
      <div className="page-header-row">
        <h2 className="sr-only" id="payroll-settings">{ht.payrollSettings}</h2>
        <button type="button" className="btn btn-outlined" onClick={() => setEditing(true)}>
          <Icon name="plus" /> {ht.settingsNew}
        </button>
      </div>
      <p className="muted">{ht.payrollSettingsIntro}</p>
      {versions.loading ? (
        <SkeletonRows rows={2} />
      ) : versions.error ? (
        <ErrorState message={versions.error} onRetry={versions.reload} />
      ) : (
        <ul className="plain-list">
          {list.map((v) => (
            <li key={v.effectiveFrom}>
              <span>
                <strong>{ht.settingsInForce(v.effectiveFrom)}</strong>
                <div className="muted small">{ht.settingsSummary(v)}</div>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <SettingsDialog orgId={orgId} current={list[0]} onClose={() => setEditing(false)} onSaved={versions.reload} />}
    </section>
  );
}
