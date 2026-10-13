import { useState } from 'react';

import { deliverySettings, saveDeliverySettings, type SettingsView } from '../../data/delivery';
import { services } from '../../data/services';
import { MapPinField } from '../../shared/DeliveryAddressFields';
import { toMinor } from '../../shared/format';
import { ErrorState, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { dt } from '../../strings/delivery';
import { FormError, SelectField, TextArea, TextField, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';

// Admin → Settings → Delivery, per branch (docs/DELIVERY.md §1): fee, PIN
// codes, slots, map location, and the ways books go out — own staff, other
// couriers by hand, and courier apps booked by API (Porter).

function functionUrl(path: string) {
  const { fns } = services();
  return `https://${fns.region}-${fns.app.options.projectId ?? 'PROJECT'}.cloudfunctions.net/${path}`;
}

function Form({ orgId, branchId, view, onSaved }: { orgId: string; branchId: string; view: SettingsView; onSaved: () => void }) {
  const s = view.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [fee, setFee] = useState(String(s.feeMinor / 100));
  const [pincodes, setPincodes] = useState(s.pincodes.join(', '));
  const [slots, setSlots] = useState(s.slots.join('\n'));
  const [location, setLocation] = useState(s.location);
  const [methods, setMethods] = useState(s.methods);
  const [couriers, setCouriers] = useState(
    Object.fromEntries(view.couriers.map((c) => [c.key, { enabled: !!s.couriers[c.key]?.enabled, environment: s.couriers[c.key]?.environment ?? 'LIVE', apiKey: '' }])) as Record<
      string,
      { enabled: boolean; environment: 'LIVE' | 'TEST'; apiKey: string }
    >,
  );
  const [saved, setSaved] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    setSaved(false);
    await saveDeliverySettings(orgId, branchId, {
      enabled,
      feeMinor: toMinor(fee || '0'),
      pincodes: pincodes.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean),
      slots: slots.split('\n').map((x) => x.trim()).filter(Boolean),
      location,
      methods,
      couriers: Object.fromEntries(Object.entries(couriers).map(([k, c]) => [k, { ...c, apiKey: c.apiKey.trim() }])),
    });
    setCouriers((x) => Object.fromEntries(Object.entries(x).map(([k, c]) => [k, { ...c, apiKey: '' }])));
    setSaved(true);
    onSaved();
  });
  return (
    <form onSubmit={submit} noValidate>
      <section className="card">
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {dt.enabled}
        </label>
        <div className="form-grid">
          <TextField label={dt.feeLabel} value={fee} onChange={setFee} hint={dt.feeHint} type="number" />
          <TextField label={dt.pincodes} value={pincodes} onChange={setPincodes} hint={dt.pincodesHint} />
          <TextArea label={dt.slots} value={slots} onChange={setSlots} rows={3} hint={dt.slotsHint} />
          <MapPinField label={dt.location} hint={dt.locationHint} value={location} onChange={setLocation} />
        </div>
      </section>
      <section className="card">
        <h2>{dt.ways}</h2>
        <label className="check">
          <input type="checkbox" checked={methods.OWN} onChange={(e) => setMethods({ ...methods, OWN: e.target.checked })} /> {dt.own}
        </label>
        <label className="check">
          <input type="checkbox" checked={methods.MANUAL} onChange={(e) => setMethods({ ...methods, MANUAL: e.target.checked })} /> {dt.manual}
        </label>
        <h3 className="form-section">{dt.couriers}</h3>
        <p className="muted small">{dt.courierIntro}</p>
        {view.couriers.map((c) => {
          const cur = couriers[c.key];
          const set = (patch: Partial<typeof cur>) => setCouriers({ ...couriers, [c.key]: { ...cur, ...patch } });
          return (
            <fieldset key={c.key} className="checklist">
              <legend>{c.label}</legend>
              <label className="check">
                <input type="checkbox" checked={cur.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {dt.courierOn(c.label)}
              </label>
              <div className="form-grid">
                <TextField
                  label={`${c.label} ${dt.apiKey}`}
                  type="password"
                  value={cur.apiKey}
                  onChange={(apiKey) => set({ apiKey })}
                  hint={s.couriers[c.key]?.hasKey ? dt.apiKeySaved : dt.apiKeyHint}
                  autoComplete="new-password"
                />
                <SelectField
                  label={dt.environment}
                  value={cur.environment}
                  onChange={(environment) => set({ environment: environment as 'LIVE' | 'TEST' })}
                  options={[
                    { value: 'LIVE', label: dt.live },
                    { value: 'TEST', label: dt.test },
                  ]}
                />
              </div>
            </fieldset>
          );
        })}
        {view.webhook && (
          <details className="numbering-help">
            <summary>{dt.webhook}</summary>
            <p className="small muted">{dt.webhookIntro}</p>
            <input readOnly value={functionUrl(view.webhook)} aria-label={dt.webhook} onFocus={(e) => e.target.select()} className="mono small" />
          </details>
        )}
      </section>
      <FormError error={error} />
      {saved && <Notice tone="ok">{dt.saved}</Notice>}
      <button type="submit" className="btn btn-filled" disabled={busy}>
        {busy ? t.saving : t.save}
      </button>
    </form>
  );
}

function BranchDelivery({ orgId, branchId }: { orgId: string; branchId: string }) {
  const view = useAsync(() => deliverySettings(orgId, branchId), [orgId, branchId]);
  if (view.loading && !view.data) return <SkeletonRows rows={5} />;
  if (view.error) return <ErrorState message={view.error} onRetry={view.reload} />;
  return <Form key={branchId} orgId={orgId} branchId={branchId} view={view.data!} onSaved={view.reload} />;
}

export function DeliverySettingsPage() {
  const { org, branch } = useWorkspace();
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{branch ? dt.settingsTitle(branch.name) : dt.navSettings}</h1>
        <p className="muted">{dt.settingsIntro}</p>
        <p>
          <a href="https://github.com/learn-crossmaze/stories/blob/main/docs/DELIVERY.md" target="_blank" rel="noreferrer">
            {dt.guide}
          </a>
        </p>
      </header>
      <NeedBranch>{(branchId) => <BranchDelivery orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
