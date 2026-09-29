import { useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { listPlans, type Plan, planOptions, pricesFor } from '../../data/billing';
import { AGE_GROUPS, DURATION_LABELS, DURATIONS, type Duration, label } from '../../data/common';
import { useAsync } from '../../shared/useAsync';
import { money, toMinor } from '../../shared/format';
import { t } from '../../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows, StatusBadge } from '../../shared/ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, MultiPick, SelectField, TextField, useSubmit } from '../components/Dialog';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

type Row = { on: boolean; price: string };
const ALL_DURATIONS = Object.keys(DURATIONS) as Duration[];

/** Plan editor: the plan's terms, its billing options (monthly to yearly, each with a price) and an optional promotional discount. */
function PlanDialog({ orgId, plan, onClose, onSaved }: { orgId: string; plan?: Plan; onClose: () => void; onSaved: () => void }) {
  const existing = plan ? planOptions(plan) : [];
  const d = plan?.discount ?? null;
  const [f, setF] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    deposit: plan ? String(plan.depositMinor / 100) : '',
    maxBooks: plan ? String(plan.maxSimultaneousBooks) : '2',
    audiences: plan?.audiences ?? ['CHILDREN', 'TEENS', 'ADULTS'],
    deliveryEligible: plan?.deliveryEligible ?? false,
    renewalWindowDays: String(plan?.renewalWindowDays ?? 30),
    discountType: (d?.type ?? '') as '' | 'AMOUNT' | 'PERCENT',
    discountValue: d ? String(d.type === 'AMOUNT' ? d.value / 100 : d.value) : '',
    discountFrom: d?.from ?? '',
    discountTo: d?.to ?? '',
    discountOn: (d?.durations ?? []) as Duration[],
    discountLabel: d?.label ?? '',
  });
  const [rows, setRows] = useState<Record<Duration, Row>>(
    () =>
      Object.fromEntries(
        ALL_DURATIONS.map((k) => {
          const o = existing.find((x) => x.duration === k);
          return [k, { on: plan ? !!o : k === 'MONTHLY', price: o ? String(o.priceMinor / 100) : '' }];
        }),
      ) as Record<Duration, Row>,
  );
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const setRow = (k: Duration, r: Partial<Row>) => setRows((s) => ({ ...s, [k]: { ...s[k], ...r } }));
  const rupees = (v: string) => v.trim() !== '' && Number.isFinite(toMinor(v)) && toMinor(v) >= 0;
  const offered = ALL_DURATIONS.filter((k) => rows[k].on);
  const discounted = f.discountType !== '';
  const value = Number(f.discountValue);
  const discountErr = !discounted
    ? undefined
    : !(value > 0) || (f.discountType === 'PERCENT' && (value > 90 || !Number.isInteger(value)))
      ? lt.discountValueInvalid
      : !f.discountFrom || !f.discountTo || f.discountFrom > f.discountTo
        ? lt.discountDatesInvalid
        : f.discountType === 'AMOUNT' && offered.filter((k) => !f.discountOn.length || f.discountOn.includes(k)).some((k) => toMinor(f.discountValue) >= toMinor(rows[k].price))
          ? lt.discountTooBig
          : undefined;
  const errors = {
    name: f.name.trim().length >= 2 ? undefined : t.required,
    options: !offered.length ? lt.optionsNone : offered.some((k) => !rupees(rows[k].price)) ? lt.optionsPrice : undefined,
    deposit: rupees(f.deposit) ? undefined : 'Enter the deposit in rupees.',
    maxBooks: /^\d+$/.test(f.maxBooks) && +f.maxBooks >= 1 && +f.maxBooks <= 20 ? undefined : 'Between 1 and 20.',
    audiences: f.audiences.length ? undefined : 'Choose at least one.',
    discount: discountErr,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const body = {
      orgId, name: f.name.trim(), description: f.description.trim(),
      options: offered.map((k) => ({ duration: k, priceMinor: toMinor(rows[k].price) })),
      depositMinor: toMinor(f.deposit), maxSimultaneousBooks: Number(f.maxBooks), audiences: f.audiences, deliveryEligible: f.deliveryEligible,
      discount: discounted
        ? { type: f.discountType, value: f.discountType === 'AMOUNT' ? toMinor(f.discountValue) : value, from: f.discountFrom, to: f.discountTo, durations: f.discountOn.filter((k) => rows[k].on), label: f.discountLabel.trim() }
        : null,
      renewalWindowDays: Number(f.renewalWindowDays) || 30,
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
        <TextField label={lt.planName} hint={lt.planNameHint} value={f.name} onChange={set('name')} error={err('name')} />
        <TextField label={lt.maxBooks} type="number" value={f.maxBooks} onChange={set('maxBooks')} error={err('maxBooks')} />
        <fieldset className="choices span-2">
          <legend>{lt.billingOptions}</legend>
          <p className="muted small">{lt.billingOptionsHint}</p>
          <div className="option-rows">
            {ALL_DURATIONS.map((k) => (
              <div key={k} className="option-row">
                <label className="check">
                  <input type="checkbox" checked={rows[k].on} onChange={(e) => setRow(k, { on: e.target.checked })} /> {DURATION_LABELS[k]}
                </label>
                <TextField label={lt.optionPrice(DURATION_LABELS[k])} value={rows[k].price} disabled={!rows[k].on} onChange={(v) => setRow(k, { price: v })} />
              </div>
            ))}
          </div>
          {err('options') && <span className="field-error">{errors.options}</span>}
        </fieldset>
        <TextField label={lt.depositAmount} value={f.deposit} onChange={set('deposit')} error={err('deposit')} />
        <TextField label={lt.renewalWindow} type="number" value={f.renewalWindowDays} onChange={set('renewalWindowDays')} />
        <div className="span-2">
          <MultiPick legend={lt.audiences} options={AGE_GROUPS.map((a) => ({ value: a, label: label(a) }))} value={f.audiences} onChange={(v) => set('audiences')(v as typeof f.audiences)} error={err('audiences')} />
          <label className="check">
            <input type="checkbox" checked={f.deliveryEligible} onChange={(e) => set('deliveryEligible')(e.target.checked)} />
            {lt.deliveryEligible}
          </label>
        </div>
        <fieldset className="choices span-2">
          <legend>{lt.discount}</legend>
          <div className="form-grid">
            <SelectField
              label={lt.discountType}
              value={f.discountType}
              onChange={set('discountType')}
              options={[
                { value: '', label: lt.discountNone },
                { value: 'AMOUNT', label: lt.discountAmount },
                { value: 'PERCENT', label: lt.discountPercent },
              ]}
            />
            {discounted && (
              <TextField label={f.discountType === 'AMOUNT' ? lt.discountAmountValue : lt.discountPercentValue} value={f.discountValue} onChange={set('discountValue')} />
            )}
            {discounted && <TextField label={lt.promoFrom} type="date" value={f.discountFrom} onChange={set('discountFrom')} />}
            {discounted && <TextField label={lt.promoTo} type="date" value={f.discountTo} onChange={set('discountTo')} />}
            {discounted && <TextField label={lt.discountLabel} hint={lt.discountLabelHint} value={f.discountLabel} onChange={set('discountLabel')} />}
          </div>
          {discounted && (
            <div role="group" aria-label={lt.discountAppliesTo}>
              <p className="small">{lt.discountAppliesTo}</p>
              {offered.map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={f.discountOn.includes(k)} onChange={(e) => set('discountOn')(e.target.checked ? [...f.discountOn, k] : f.discountOn.filter((x) => x !== k))} /> {DURATION_LABELS[k]}
                </label>
              ))}
              <p className="muted small">{lt.discountAllHint}</p>
            </div>
          )}
          {err('discount') && <span className="field-error">{errors.discount}</span>}
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

/** The plan's options with today's prices, as a small table. */
export function PlanPrices({ plan }: { plan: Plan }) {
  return (
    <ul className="plan-prices">
      {pricesFor(plan).map((p) => (
        <li key={p.duration}>
          <span>{DURATION_LABELS[p.duration]}</span>
          <span>
            {p.discountMinor > 0 && <s className="muted small">{money(p.listPriceMinor)}</s>} <strong>{money(p.priceMinor)}</strong>
            {p.discountLabel && <span className="badge badge-ok">{p.discountLabel}</span>}
          </span>
        </li>
      ))}
    </ul>
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
              <PlanPrices plan={p} />
              {p.discount && (
                <p className="small">
                  {lt.discountSummary(p.discount.type === 'AMOUNT' ? money(p.discount.value) : `${p.discount.value}%`, p.discount.from, p.discount.to, p.discount.durations.map((k) => DURATION_LABELS[k]))}
                </p>
              )}
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
