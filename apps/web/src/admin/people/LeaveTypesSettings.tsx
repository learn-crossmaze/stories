// HR settings: leave types.
import { useState } from 'react';

import { command } from '../../data/api';
import { type LeaveType, listLeaveTypes } from '../../data/leave';
import { ErrorState, Icon, SkeletonRows, StatusBadge } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';

const isDays = (v: string) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 365;

function LeaveTypeDialog({ orgId, type, onClose, onSaved }: { orgId: string; type?: LeaveType; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: type?.name ?? '',
    code: type?.code ?? '',
    annualQuota: String(type?.annualQuota ?? 12),
    accrual: type?.accrual ?? ('MONTHLY' as LeaveType['accrual']),
    carryForwardMax: String(type?.carryForwardMax ?? 0),
    paid: type?.paid ?? true,
    allowHalfDay: type?.allowHalfDay ?? true,
    unlimited: type?.unlimited ?? false,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [touched, setTouched] = useState(false);
  const errors = {
    name: f.name.trim().length >= 2 ? undefined : t.required,
    code: /^[A-Z0-9]{1,5}$/.test(f.code.trim().toUpperCase()) ? undefined : '1–5 letters or digits.',
    annualQuota: f.unlimited || f.accrual === 'MANUAL' || (isDays(f.annualQuota) && Number(f.annualQuota) > 0) ? undefined : 'Enter days, e.g. 12.',
    carryForwardMax: isDays(f.carryForwardMax) ? undefined : 'Enter days, or 0.',
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    await command('leaveTypes-save', {
      orgId,
      ...(type ? { typeId: type.id } : {}),
      name: f.name.trim(),
      code: f.code.trim().toUpperCase(),
      paid: f.paid,
      annualQuota: f.unlimited || f.accrual === 'MANUAL' ? 0 : Number(f.annualQuota),
      accrual: f.accrual,
      carryForwardMax: f.unlimited ? 0 : Number(f.carryForwardMax),
      allowHalfDay: f.allowHalfDay,
      unlimited: f.unlimited,
    });
    onSaved();
    onClose();
  });
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  return (
    <Dialog title={type ? ht.leaveTypeEdit : ht.leaveTypeNew} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={ht.leaveTypeName} value={f.name} onChange={set('name')} error={e('name')} />
          <TextField label={ht.leaveTypeCode} hint={ht.leaveTypeCodeHint} value={f.code} onChange={set('code')} error={e('code')} />
          {!f.unlimited && (
            <>
              <SelectField label={ht.leaveAccrual} value={f.accrual} onChange={set('accrual')} options={(['MONTHLY', 'YEARLY', 'MANUAL'] as const).map((a) => ({ value: a, label: ht.accruals[a] }))} />
              {f.accrual !== 'MANUAL' && <TextField label={ht.leaveQuota} type="number" value={f.annualQuota} onChange={set('annualQuota')} error={e('annualQuota')} />}
              <TextField label={ht.leaveCarry} type="number" value={f.carryForwardMax} onChange={set('carryForwardMax')} error={e('carryForwardMax')} />
            </>
          )}
        </div>
        <fieldset className="choices">
          <legend className="sr-only">{ht.leaveTypes}</legend>
          <label className="check">
            <input type="checkbox" checked={f.paid} onChange={(ev) => set('paid')(ev.target.checked)} /> {ht.leavePaid}
          </label>
          <label className="check">
            <input type="checkbox" checked={f.allowHalfDay} onChange={(ev) => set('allowHalfDay')(ev.target.checked)} /> {ht.leaveAllowHalf}
          </label>
          <label className="check">
            <input type="checkbox" checked={f.unlimited} onChange={(ev) => set('unlimited')(ev.target.checked)} /> {ht.leaveUnlimited}
          </label>
        </fieldset>
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function LeaveTypesSection({ orgId }: { orgId: string }) {
  const types = useAsync(() => listLeaveTypes(orgId), [orgId]);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [archiving, setArchiving] = useState<LeaveType | null>(null);
  return (
    <section className="section" aria-labelledby="leave-types">
      <div className="page-header-row">
        <h2 className="sr-only" id="leave-types">{ht.leaveTypes}</h2>
        <button type="button" className="btn btn-outlined" onClick={() => setEditing('new')}>
          <Icon name="plus" /> {ht.leaveTypeNew}
        </button>
      </div>
      <p className="muted">{ht.leaveTypesIntro}</p>
      {types.loading ? (
        <SkeletonRows rows={3} />
      ) : types.error ? (
        <ErrorState message={types.error} onRetry={types.reload} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.leaveTypeName}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(types.data ?? []).map((ty) => (
                <tr key={ty.id}>
                  <td>
                    {ty.name} ({ty.code})
                    <div className="muted small">{ht.leaveFlags(ty)}</div>
                  </td>
                  <td>
                    <StatusBadge status={ty.status} />
                  </td>
                  <td className="cell-actions">
                    {ty.status === 'ACTIVE' && (
                      <>
                        <button type="button" className="btn btn-text" onClick={() => setEditing(ty)} aria-label={`${t.edit} ${ty.name}`}>
                          {t.edit}
                        </button>
                        <button type="button" className="btn btn-text" onClick={() => setArchiving(ty)} aria-label={`${t.archive} ${ty.name}`}>
                          {t.archive}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <LeaveTypeDialog orgId={orgId} type={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={types.reload} />}
      {archiving && (
        <ConfirmWithReason
          title={ht.leaveTypeArchiveTitle(archiving.name)}
          body={ht.leaveTypeArchiveBody}
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command('leaveTypes-archive', { orgId, typeId: archiving.id, reason });
            setArchiving(null);
            types.reload();
          }}
        />
      )}
    </section>
  );
}
