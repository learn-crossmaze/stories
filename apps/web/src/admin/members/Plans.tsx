import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { listPlans, type Plan } from '../../data/billing';
import { AGE_GROUPS, DURATIONS, type Duration, label } from '../../data/common';
import { useAsync } from '../../shared/useAsync';
import { money, toMinor } from '../../shared/format';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, MultiPick, SelectField, TextField, useSubmit } from '../components/Dialog';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

function PlanDialog({ orgId, plan, onClose, onSaved }: { orgId: string; plan?: Plan; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    duration: plan?.duration ?? ('MONTHLY' as Duration),
    price: plan ? String(plan.priceMinor / 100) : '',
    deposit: plan ? String(plan.depositMinor / 100) : '',
    maxBooks: plan ? String(plan.maxSimultaneousBooks) : '2',
    audiences: plan?.audiences ?? ['CHILDREN', 'TEENS', 'ADULTS'],
    deliveryEligible: plan?.deliveryEligible ?? false,
    promoPrice: plan?.promo ? String(plan.promo.priceMinor / 100) : '',
    promoFrom: plan?.promo?.from ?? '',
    promoTo: plan?.promo?.to ?? '',
    renewalWindowDays: String(plan?.renewalWindowDays ?? 30),
  });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const rupees = (v: string) => v.trim() !== '' && Number.isFinite(toMinor(v)) && toMinor(v) >= 0;
  const promo = f.promoPrice.trim() !== '';
  const errors = {
    name: f.name.trim().length >= 2 ? undefined : t.required,
    price: rupees(f.price) ? undefined : 'Enter the price in rupees.',
    deposit: rupees(f.deposit) ? undefined : 'Enter the deposit in rupees.',
    maxBooks: /^\d+$/.test(f.maxBooks) && +f.maxBooks >= 1 && +f.maxBooks <= 20 ? undefined : 'Between 1 and 20.',
    audiences: f.audiences.length ? undefined : 'Choose at least one.',
    promo: !promo || (rupees(f.promoPrice) && f.promoFrom && f.promoTo && f.promoFrom <= f.promoTo) ? undefined : 'Enter a promo price and a valid date range.',
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const body = {
      orgId, name: f.name.trim(), description: f.description.trim(), duration: f.duration, priceMinor: toMinor(f.price), depositMinor: toMinor(f.deposit),
      maxSimultaneousBooks: Number(f.maxBooks), audiences: f.audiences, deliveryEligible: f.deliveryEligible,
      promo: promo ? { priceMinor: toMinor(f.promoPrice), from: f.promoFrom, to: f.promoTo } : null, renewalWindowDays: Number(f.renewalWindowDays) || 30,
    };
    if (plan) await command('plans-update', { ...body, planId: plan.id });
    else await command('plans-create', body);
    onSaved();
    onClose();
  });
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  return (
    <Dialog title={plan ? lt.editPlan : lt.newPlan} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <TextField label={lt.planName} value={f.name} onChange={set('name')} error={err('name')} />
        <SelectField label={lt.duration} value={f.duration} onChange={set('duration')} options={(Object.keys(DURATIONS) as Duration[]).map((d) => ({ value: d, label: label(d) }))} />
        <TextField label={lt.price} value={f.price} onChange={set('price')} error={err('price')} />
        <TextField label={lt.depositAmount} value={f.deposit} onChange={set('deposit')} error={err('deposit')} />
        <TextField label={lt.maxBooks} type="number" value={f.maxBooks} onChange={set('maxBooks')} error={err('maxBooks')} />
        <TextField label={lt.renewalWindow} type="number" value={f.renewalWindowDays} onChange={set('renewalWindowDays')} />
        <div className="span-2">
          <MultiPick legend={lt.audiences} options={AGE_GROUPS.map((a) => ({ value: a, label: label(a) }))} value={f.audiences} onChange={(v) => set('audiences')(v as typeof f.audiences)} error={err('audiences')} />
          <label className="check">
            <input type="checkbox" checked={f.deliveryEligible} onChange={(e) => set('deliveryEligible')(e.target.checked)} />
            {lt.deliveryEligible}
          </label>
        </div>
        <fieldset className="choices span-2">
          <legend>{lt.promo}</legend>
          <div className="form-grid-3">
            <TextField label={lt.promoPrice} value={f.promoPrice} onChange={set('promoPrice')} />
            <TextField label={lt.promoFrom} type="date" value={f.promoFrom} onChange={set('promoFrom')} />
            <TextField label={lt.promoTo} type="date" value={f.promoTo} onChange={set('promoTo')} />
          </div>
          {err('promo') && <span className="field-error">{errors.promo}</span>}
        </fieldset>
        <div className="span-2">
          <TextField label={lt.description} value={f.description} onChange={set('description')} />
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={plan ? t.save : t.create} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

export function PlansPage() {
  const { claims } = useAuth();
  const { org } = useWorkspace();
  const plans = useAsync(() => (org ? listPlans(org.id) : Promise.resolve([])), [org?.id]);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Plan | null>(null);
  if (!org) return null;
  const manage = can(claims, 'plans.manage', org.id);
  return (
    <>
      <header className="page-header page-header-row">
        <h1>{lt.plansTitle}</h1>
        {manage && (
          <button type="button" className="btn btn-filled" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {lt.newPlan}
          </button>
        )}
      </header>
      {plans.loading ? (
        <SkeletonRows />
      ) : plans.error ? (
        <ErrorState message={plans.error} onRetry={plans.reload} />
      ) : !plans.data?.length ? (
        <EmptyState icon="card" title={lt.plansEmpty} message="" />
      ) : (
        <div className="plan-grid">
          {plans.data.map((p) => (
            <article key={p.id} className={`card plan-card ${p.status !== 'ACTIVE' ? 'muted' : ''}`}>
              <header>
                <h2>{p.name}</h2>
                <span className="muted small">{lt.version(p.version)}</span>
              </header>
              <p className="plan-price">
                {money(p.priceMinor)} <span className="muted small">/ {label(p.duration).toLowerCase()}</span>
              </p>
              {p.promo && <p className="small">Promo {money(p.promo.priceMinor)} · {p.promo.from} → {p.promo.to}</p>}
              <ul className="plan-facts small">
                <li>{p.maxSimultaneousBooks} {lt.maxBooks.toLowerCase()} · unlimited exchanges</li>
                <li>{lt.depositAmount.replace(' (₹)', '')}: {money(p.depositMinor)}</li>
                <li>{p.audiences.map(label).join(', ')}</li>
                {p.deliveryEligible && <li>{lt.deliveryEligible}</li>}
              </ul>
              <div className="row">
                <StatusBadge status={p.status} />
                {manage && p.status === 'ACTIVE' && (
                  <>
                    <button type="button" className="btn btn-text" onClick={() => setEditing(p)}>
                      {t.edit}
                    </button>
                    <button type="button" className="btn btn-text" onClick={() => setArchiving(p)}>
                      {t.archive}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && <PlanDialog orgId={org.id} plan={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={plans.reload} />}
      {archiving && (
        <ConfirmWithReason title={lt.archivePlan(archiving.name)} body={lt.archivePlanBody} confirmLabel={t.archive} onClose={() => setArchiving(null)}
          onConfirm={async (reason) => { await command('plans-archive', { orgId: org.id, planId: archiving.id, reason }); plans.reload(); setArchiving(null); }} />
      )}
    </>
  );
}
