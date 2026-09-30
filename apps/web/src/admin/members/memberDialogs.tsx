import { useState } from 'react';

import { command } from '../../data/api';
import { listPlans, type Plan, pricesFor, startUpgrade, type Subscription, upgradeQuote } from '../../data/billing';
import { toApiError } from '../../data/api';
import { PendingUpgrade, UpgradeChooser } from '../../shared/Upgrade';
import { type Book } from '../../data/catalogue';
import { DURATION_LABELS, type Duration, planWithOption } from '../../data/common';
import { type Member } from '../../data/members';
import { useAsync } from '../../shared/useAsync';
import { money, toMinor } from '../../shared/format';
import { t } from '../../strings';
import { SkeletonRows } from '../../shared/ui';
import { Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../components/Dialog';
import { lt } from '../../strings/library';
import { BookPicker } from '../catalogue/BookPicker';

// Dialogs on the member page: payments, subscriptions, deposit adjustments, refunds, reservations.

const METHODS = [
  { value: 'OFFLINE_CASH', label: 'Cash' },
  { value: 'OFFLINE_UPI', label: 'UPI' },
  { value: 'OFFLINE_CARD', label: 'Card' },
  { value: 'OFFLINE_BANK_TRANSFER', label: 'Bank transfer' },
] as const;
type Method = (typeof METHODS)[number]['value'];

export function PaymentDialog({ orgId, sub, onClose, onDone }: { orgId: string; sub: Subscription; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<Method>('OFFLINE_UPI');
  const [reference, setReference] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await command('payments-recordOffline', { orgId, subscriptionId: sub.id, method, amountMinor: sub.amountDue.totalMinor, reference: reference.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={lt.recordPayment} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {sub.kind === 'UPGRADE' && sub.upgrade ? (
          <PendingUpgrade upgrade={sub.upgrade} planName={planWithOption(sub.planSnapshot)} amountDue={sub.amountDue} />
        ) : (
          <dl className="facts">
            <dt>{lt.planFee}</dt>
            <dd>
              {money(sub.amountDue.subscriptionMinor)} · {planWithOption(sub.planSnapshot)}
            </dd>
            <dt>{lt.depositTopUp}</dt>
            <dd>{money(sub.amountDue.depositMinor)}</dd>
            <dt>{lt.total}</dt>
            <dd>
              <strong>{money(sub.amountDue.totalMinor)}</strong>
            </dd>
          </dl>
        )}
        <SelectField label={lt.paymentMethod} value={method} onChange={setMethod} options={[...METHODS]} />
        {method !== 'OFFLINE_CASH' && <TextField label={lt.reference} value={reference} onChange={setReference} />}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={`${lt.recordPayment} · ${money(sub.amountDue.totalMinor)}`} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Upgrade mid-term: the quote with the pro-rata credit, then an upgrade waiting for payment. */
export function UpgradeDialog({ orgId, member, onClose, onCreated }: { orgId: string; member: Member; onClose: () => void; onCreated: () => void }) {
  const quote = useAsync(() => upgradeQuote(orgId, member.id), [orgId, member.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={lt.upgradeTitle(member.fullName)} onClose={onClose}>
      <p className="muted">{t.upIntro}</p>
      {quote.loading ? (
        <SkeletonRows rows={3} />
      ) : quote.error || !quote.data ? (
        <p className="form-error" role="alert">
          {quote.error}
        </p>
      ) : (
        <UpgradeChooser
          quote={quote.data}
          busy={busy}
          error={error}
          onUpgrade={async (o) => {
            setBusy(true);
            setError(null);
            try {
              await startUpgrade(orgId, member.id, o);
              onCreated();
              onClose();
            } catch (e) {
              setError(toApiError(e).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </Dialog>
  );
}

export function SubscribeDialog({
  orgId,
  member,
  renewing,
  onClose,
  onCreated,
}: {
  orgId: string;
  member: Member;
  renewing: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const plans = useAsync(() => listPlans(orgId), [orgId]);
  const eligible = (plans.data ?? []).filter((p) => p.status === 'ACTIVE' && p.audiences.includes(member.audience));
  const [planId, setPlanId] = useState('');
  const [duration, setDuration] = useState<Duration | ''>('');
  const chosen = eligible.find((p) => p.id === planId) ?? eligible[0];
  const prices = chosen ? pricesFor(chosen) : [];
  const option = prices.find((p) => p.duration === duration) ?? prices[0];
  const { busy, error, submit } = useSubmit(async () => {
    if (!chosen || !option) return;
    await command('subscriptions-create', { orgId, memberId: member.id, planId: chosen.id, duration: option.duration });
    onCreated();
    onClose();
  });
  return (
    <Dialog title={renewing ? lt.renew : lt.subscribe} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {plans.loading ? (
          <SkeletonRows rows={2} />
        ) : !eligible.length ? (
          <p className="muted">{lt.plansEmpty}</p>
        ) : (
          <fieldset className="choices plan-choices">
            <legend>{lt.choosePlan}</legend>
            {eligible.map((p: Plan) => (
              <label key={p.id} className="plan-choice">
                <input
                  type="radio"
                  name="plan"
                  checked={chosen?.id === p.id}
                  onChange={() => {
                    setPlanId(p.id);
                    setDuration('');
                  }}
                />
                <span>
                  <strong>{p.name}</strong> · {p.maxSimultaneousBooks} {lt.maxBooks.toLowerCase()}
                  <span className="muted small">
                    {' '}
                    {lt.depositAmount.replace(' (₹)', '').toLowerCase()} {money(p.depositMinor)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {chosen && prices.length > 0 && (
          <fieldset className="choices plan-choices">
            <legend>{lt.chooseOption}</legend>
            {prices.map((o) => (
              <label key={o.duration} className="plan-choice">
                <input type="radio" name="option" checked={option?.duration === o.duration} onChange={() => setDuration(o.duration)} />
                <span>
                  <strong>{DURATION_LABELS[o.duration]}</strong> · {money(o.priceMinor)}
                  {o.discountMinor > 0 && (
                    <span className="muted small">
                      {' '}
                      <s>{money(o.listPriceMinor)}</s> {o.discountLabel}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.create} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function AdjustmentDialog({ orgId, memberId, onClose, onDone }: { orgId: string; memberId: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'DEDUCTION' | 'ADJUSTMENT'>('DEDUCTION');
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await command('deposits-proposeAdjustment', { orgId, memberId, kind, direction, amountMinor: toMinor(amount), reason: reason.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={lt.proposeAdjustment} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <SelectField
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'DEDUCTION', label: lt.deduction },
            { value: 'ADJUSTMENT', label: lt.adjustment },
          ]}
        />
        {kind === 'ADJUSTMENT' && (
          <SelectField
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'DEBIT', label: lt.debit },
              { value: 'CREDIT', label: lt.credit },
            ]}
          />
        )}
        <TextField label={lt.amount} value={amount} onChange={setAmount} />
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} hint={t.reasonHint} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={lt.proposeAdjustment} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function RefundDialog({
  orgId,
  memberId,
  balance,
  onClose,
  onDone,
}: {
  orgId: string;
  memberId: string;
  balance: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<'OFFLINE_CASH' | 'OFFLINE_UPI' | 'OFFLINE_BANK_TRANSFER'>('OFFLINE_UPI');
  const [reference, setReference] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await command('deposits-refund', { orgId, memberId, method, reference: reference.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={lt.refund} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>{lt.refundBody(money(balance))}</p>
        <SelectField
          label={lt.paymentMethod}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'OFFLINE_CASH', label: 'Cash' },
            { value: 'OFFLINE_UPI', label: 'UPI' },
            { value: 'OFFLINE_BANK_TRANSFER', label: 'Bank transfer' },
          ]}
        />
        {method !== 'OFFLINE_CASH' && <TextField label={lt.reference} value={reference} onChange={setReference} />}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={lt.refund} onCancel={onClose} danger />
      </form>
    </Dialog>
  );
}

export function ReserveDialog({
  orgId,
  memberId,
  branchId,
  onClose,
  onDone,
}: {
  orgId: string;
  memberId: string;
  branchId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [book, setBook] = useState<Book | null>(null);
  const { busy, error, submit } = useSubmit(async () => {
    if (!book) return;
    const r = await command<{ status: string; copyCode: string | null }>('reservations-place', { orgId, memberId, bookId: book.id, branchId });
    onDone(r.status === 'ALLOCATED' ? `${book.title}: copy ${r.copyCode} is held for pickup.` : `${book.title}: added to the waiting list.`);
    onClose();
  });
  return (
    <Dialog title={lt.placeReservation} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {book ? (
          <p>
            <strong>{book.title}</strong>{' '}
            <button type="button" className="btn btn-text" onClick={() => setBook(null)}>
              {t.edit}
            </button>
          </p>
        ) : (
          <BookPicker label={lt.reserveBook} onPick={setBook} />
        )}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={lt.placeReservation} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
