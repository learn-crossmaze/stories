import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import type { Branch, Weekday } from '../../data/org';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, TextField, useSubmit } from '../Dialog';
import { useWorkspace } from '../Workspace';

const DAYS: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
type Hours = Record<Weekday, { open: string; close: string; closed: boolean }>;

function initialHours(b?: Branch): Hours {
  return Object.fromEntries(
    DAYS.map((d) => {
      const h = b?.operatingHours.find((x) => x.day === d);
      return [d, h ? { open: h.open, close: h.close, closed: false } : { open: '10:00', close: '20:00', closed: !!b || d === 'MON' }];
    }),
  ) as Hours;
}

/** Client-side checks mirror the server schema so most mistakes show inline. */
function validate(f: Record<string, string>, creating: boolean) {
  const e: Record<string, string> = {};
  if (creating && !/^[A-Za-z0-9]{2,8}$/.test(f.code)) e.code = t.branchCodeHint;
  if (f.name.trim().length < 2) e.name = t.required;
  if (f.line1.trim().length < 3) e.line1 = t.required;
  if (f.city.trim().length < 2) e.city = t.required;
  if (f.state.trim().length < 2) e.state = t.required;
  if (!/^\d{6}$/.test(f.postalCode.trim())) e.postalCode = 'Enter a 6-digit PIN code.';
  if (!/^\+?[0-9 ]{8,16}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number.';
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
  return e;
}

function BranchDialog({ orgId, branch, onClose, onSaved }: { orgId: string; branch?: Branch; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    line1: branch?.address.line1 ?? '',
    line2: branch?.address.line2 ?? '',
    city: branch?.address.city ?? '',
    state: branch?.address.state ?? '',
    postalCode: branch?.address.postalCode ?? '',
    phone: branch?.contact.phone ?? '',
    email: branch?.contact.email ?? '',
  });
  const [hours, setHours] = useState(initialHours(branch));
  const [touched, setTouched] = useState(false);
  const errors = validate(f, !branch);
  const hoursInvalid = DAYS.some((d) => !hours[d].closed && hours[d].open >= hours[d].close);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const err = (k: string) => (touched ? errors[k] : undefined);

  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.keys(errors).length || hoursInvalid) return;
    const body = {
      name: f.name.trim(),
      address: { line1: f.line1.trim(), line2: f.line2.trim(), city: f.city.trim(), state: f.state.trim(), postalCode: f.postalCode.trim() },
      contact: { phone: f.phone.trim(), email: f.email.trim() },
      operatingHours: DAYS.filter((d) => !hours[d].closed).map((d) => ({ day: d, open: hours[d].open, close: hours[d].close })),
      weeklyOffs: DAYS.filter((d) => hours[d].closed),
    };
    if (branch) await command('branches-update', { orgId, branchId: branch.id, ...body });
    else await command('branches-create', { orgId, code: f.code.trim().toUpperCase(), ...body });
    onSaved();
    onClose();
  });

  return (
    <Dialog title={branch ? t.branchEdit : t.branchNew} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <TextField label={t.branchCode} value={f.code} onChange={set('code')} hint={branch ? undefined : t.branchCodeHint} error={err('code')} disabled={!!branch} />
        <TextField label={t.branchName} value={f.name} onChange={set('name')} error={err('name')} />
        <TextField label={t.addressLine1} value={f.line1} onChange={set('line1')} error={err('line1')} autoComplete="address-line1" />
        <TextField label={t.addressLine2} value={f.line2} onChange={set('line2')} autoComplete="address-line2" />
        <TextField label={t.city} value={f.city} onChange={set('city')} error={err('city')} />
        <TextField label={t.state} value={f.state} onChange={set('state')} error={err('state')} />
        <TextField label={t.postalCode} value={f.postalCode} onChange={set('postalCode')} error={err('postalCode')} />
        <TextField label={t.phone} type="tel" value={f.phone} onChange={set('phone')} error={err('phone')} />
        <TextField label={t.contactEmail} type="email" value={f.email} onChange={set('email')} error={err('email')} />
        <fieldset className="hours span-2">
          <legend>{t.hoursTitle}</legend>
          {DAYS.map((d) => (
            <div key={d} className="hours-row">
              <span className="hours-day">{d}</span>
              <label className="check">
                <input type="checkbox" checked={hours[d].closed} onChange={(e) => setHours((h) => ({ ...h, [d]: { ...h[d], closed: e.target.checked } }))} />
                {t.closedDay}
              </label>
              {!hours[d].closed && (
                <>
                  <input type="time" aria-label={`${d} opens`} value={hours[d].open} onChange={(e) => setHours((h) => ({ ...h, [d]: { ...h[d], open: e.target.value } }))} />
                  <input type="time" aria-label={`${d} closes`} value={hours[d].close} onChange={(e) => setHours((h) => ({ ...h, [d]: { ...h[d], close: e.target.value } }))} />
                </>
              )}
            </div>
          ))}
          {touched && hoursInvalid && <span className="field-error">Opening time must be before closing time.</span>}
        </fieldset>
        <div className="span-2">
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={branch ? t.save : t.create} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

export function BranchesPage() {
  const { claims } = useAuth();
  const { org, branches, branchesLoading, branchesError, reloadBranches } = useWorkspace();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Branch | null>(null);
  if (!org) return <EmptyState icon="building" title={t.noOrgTitle} message={t.noOrgMessage} />;
  const manage = can(claims, 'branches.manage', org.id);

  return (
    <>
      <header className="page-header page-header-row">
        <h1>{t.branchesTitle}</h1>
        {manage && (
          <button type="button" className="btn btn-filled" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {t.branchNew}
          </button>
        )}
      </header>
      {branchesLoading ? (
        <SkeletonRows />
      ) : branchesError ? (
        <ErrorState message={branchesError} onRetry={reloadBranches} />
      ) : branches.length === 0 ? (
        <EmptyState icon="store" title={t.branchesEmpty} message={manage ? t.todoCreateBranch : ''} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.branchCode}</th>
                <th scope="col">{t.branchName}</th>
                <th scope="col">{t.city}</th>
                <th scope="col">{t.phone}</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                {manage && (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.code}</td>
                  <td>{b.name}</td>
                  <td>{b.address.city}</td>
                  <td className="nowrap">{b.contact.phone}</td>
                  <td>{b.type === 'FRANCHISE' ? t.franchise : t.companyOwned}</td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  {manage && (
                    <td className="cell-actions">
                      {b.status === 'ACTIVE' && (
                        <>
                          <button type="button" className="btn btn-text" onClick={() => setEditing(b)}>
                            {t.edit}
                          </button>
                          <button type="button" className="btn btn-text" onClick={() => setArchiving(b)}>
                            {t.archive}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <BranchDialog orgId={org.id} branch={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={reloadBranches} />}
      {archiving && (
        <ConfirmWithReason
          title={t.branchArchiveTitle(archiving.name)}
          body={t.branchArchiveBody}
          confirmLabel={t.archive}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            await command('branches-archive', { orgId: org.id, branchId: archiving.id, reason });
            reloadBranches();
            setArchiving(null);
          }}
        />
      )}
    </>
  );
}
