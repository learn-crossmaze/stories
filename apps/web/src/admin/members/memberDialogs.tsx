import { useEffect, useRef, useState } from 'react';

import { ApiError, call, command } from '../../data/api';
import { depositAccount, listPlans, type Plan, pricesFor, startUpgrade, type Subscription, upgradeQuote } from '../../data/billing';
import { PendingUpgrade, UpgradeChooser } from '../../shared/Upgrade';
import { type Book } from '../../data/catalogue';
import { DURATION_LABELS, type Duration, planWithOption } from '../../data/common';
import { type Member } from '../../data/members';
import { useAsync } from '../../shared/useAsync';
import { money, toMinor } from '../../shared/format';
import { oneOf, remember } from '../../shared/remember';
import { t } from '../../strings';
import { SkeletonRows } from '../../shared/ui';
import { Dialog, DialogActions, FormError, SelectField, TextField, useAction, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { lt } from '../../strings/library';
import { BookPicker } from '../catalogue/BookPicker';
import { MemberPicker } from './Members';

// Dialogs on the member page: payments, subscriptions, deposit adjustments, refunds, reservations.

const METHODS = ['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_CARD', 'OFFLINE_BANK_TRANSFER'] as const;
type Method = (typeof METHODS)[number];
const methodOptions = <M extends string>(methods: readonly M[]) => methods.map((value) => ({ value, label: lt.paymentMethods[value] }));

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
        <SelectField label={lt.paymentMethod} value={method} onChange={setMethod} options={methodOptions(METHODS)} />
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
  const action = useAction();
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
          busy={action.busy}
          error={action.error}
          onUpgrade={(o) =>
            action.run(async () => {
              await startUpgrade(orgId, member.id, o);
              onCreated();
              onClose();
            })
          }
        />
      )}
    </Dialog>
  );
}

/**
 * Sells or renews a plan. Staff who may take payments and see deposits (`canTakePayment`) see the total
 * and take the counter payment in the same step; "Save unpaid" keeps the plan waiting for payment
 * (to collect online or pay later). Everyone else only saves it unpaid, as before.
 */
export function SubscribeDialog({
  orgId,
  member,
  renewing,
  previous,
  canTakePayment = false,
  onClose,
  onCreated,
  onPaid,
}: {
  orgId: string;
  member: Member;
  renewing: boolean;
  /** The member's current or last plan: chosen to begin with, while it is still on offer. */
  previous?: Subscription;
  canTakePayment?: boolean;
  onClose: () => void;
  /** Saved unpaid. */
  onCreated: () => void;
  /** Sold and paid for in one step. */
  onPaid?: () => void;
}) {
  // Both read as the dialog opens. Never kept from an earlier sale: a stale price would make the server refuse the amount.
  const plans = useAsync(() => listPlans(orgId), [orgId]);
  const deposit = useAsync(() => (canTakePayment ? depositAccount(orgId, member.id) : Promise.resolve(null)), [orgId, member.id, canTakePayment]);
  const eligible = (plans.data ?? []).filter((p) => p.status === 'ACTIVE' && p.audiences.includes(member.audience));
  const [planId, setPlanId] = useState(previous?.planId ?? '');
  const [duration, setDuration] = useState<Duration | ''>(previous?.planSnapshot.duration ?? '');
  const chosen = eligible.find((p) => p.id === planId) ?? eligible[0];
  const prices = chosen ? pricesFor(chosen) : [];
  // The option picked (or the previous plan's) counts for that plan only; any other plan starts on its first option.
  const option = (chosen?.id === planId ? prices.find((p) => p.duration === duration) : undefined) ?? prices[0];

  const methodKey = remember.key('counterPayment', orgId);
  const [method, setMethod] = useState<Method>(() => remember.get(methodKey, 'OFFLINE_UPI', oneOf(METHODS)));
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  // One paid sale for as long as this dialog is open. If the answer to "Take payment" was lost, pressing it again
  // gets the result of the first try, also after the method or the reference was corrected: a new request would be
  // taken as the member renewing early and a second payment would go on the books.
  const [saleRequestId] = useState(() => crypto.randomUUID());
  const loading = plans.loading || (canTakePayment && deposit.loading);
  // Taking the payment here needs the deposit balance (the total includes the top-up); without it the plan is saved unpaid.
  const paying = canTakePayment && !deposit.error;
  const settling = paying && deposit.data?.status === 'SETTLING';
  const topUp = chosen ? Math.max(0, chosen.depositMinor - (deposit.data?.balanceMinor ?? 0)) : 0;
  const total = (option?.priceMinor ?? 0) + topUp;
  const referenceMissing = method !== 'OFFLINE_CASH' && reference.trim().length < 4;

  const action = useAction();
  const save = (paid: boolean) =>
    action.run(async () => {
      if (!chosen || !option) return;
      const sale = { orgId, memberId: member.id, planId: chosen.id, duration: option.duration };
      if (!paid) {
        await command('subscriptions-create', sale);
        onCreated();
        onClose();
        return;
      }
      setTouched(true);
      if (referenceMissing) return;
      try {
        await command('subscriptions-create', { ...sale, payment: { method, amountMinor: total, reference: method === 'OFFLINE_CASH' ? '' : reference.trim() } }, saleRequestId);
      } catch (e) {
        // The server works out the amount itself. If ours no longer matches (a discount began or ended, the plan or
        // the deposit changed), read both again so the new total shows, and say so.
        if (e instanceof ApiError && e.reason === 'INVALID_INPUT') {
          plans.reload();
          deposit.reload();
          throw new ApiError(`${e.message} ${lt.totalChanged}`, e.reason);
        }
        throw e;
      }
      remember.set(methodKey, method);
      (onPaid ?? onCreated)();
      onClose();
    });

  return (
    <Dialog title={renewing ? lt.renew : lt.subscribe} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading) void save(paying);
        }}
      >
        {loading ? (
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
        {!loading && chosen && prices.length > 0 && (
          <fieldset className="choices plan-choices">
            <legend>{lt.chooseOption}</legend>
            {prices.map((o) => (
              <label key={o.duration} className="plan-choice">
                <input
                  type="radio"
                  name="option"
                  checked={option?.duration === o.duration}
                  onChange={() => {
                    setPlanId(chosen.id);
                    setDuration(o.duration);
                  }}
                />
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
        {canTakePayment && deposit.error && (
          <Notice tone="warn">
            {deposit.error} {lt.depositUnread}
          </Notice>
        )}
        {!loading && paying && option && (
          <>
            <dl className="facts">
              <dt>{lt.planFee}</dt>
              <dd>{money(option.priceMinor)}</dd>
              <dt>{lt.depositTopUp}</dt>
              <dd>{money(topUp)}</dd>
              <dt>{lt.total}</dt>
              <dd>
                <strong>{money(total)}</strong>
              </dd>
            </dl>
            {settling ? (
              <Notice tone="warn">{lt.depositSettling}</Notice>
            ) : (
              <>
                <SelectField label={lt.paymentMethod} value={method} onChange={setMethod} options={methodOptions(METHODS)} />
                {method !== 'OFFLINE_CASH' && (
                  <TextField label={lt.reference} value={reference} onChange={setReference} error={touched && referenceMissing ? lt.referenceNeeded : undefined} />
                )}
              </>
            )}
          </>
        )}
        <FormError error={action.error} />
        {paying ? (
          <>
            <p className="muted small">{lt.saveUnpaidHint}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-text" onClick={onClose} disabled={action.busy}>
                {t.cancel}
              </button>
              <button type="button" className="btn btn-outlined" onClick={() => void save(false)} disabled={action.busy || loading || !option}>
                {lt.saveUnpaid}
              </button>
              <button type="submit" className="btn btn-filled" disabled={action.busy || loading || !option || settling}>
                {action.busy ? t.saving : loading ? t.loading : lt.takePayment(money(total))}
              </button>
            </div>
          </>
        ) : (
          <DialogActions busy={action.busy} submitLabel={t.create} onCancel={onClose} />
        )}
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
          options={methodOptions(['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER'] as const)}
        />
        {method !== 'OFFLINE_CASH' && <TextField label={lt.reference} value={reference} onChange={setReference} />}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={lt.refund} onCancel={onClose} danger />
      </form>
    </Dialog>
  );
}

interface Stock {
  branches: { branchId: string; branchName: string; available: number; total: number }[];
}

/**
 * Reserves titles for a member at their branch. Opened for a member already known (their page, the desk) or
 * without one (a book's page, the Reservations page: the member is found here first; `book` is the title to
 * start with). It stays open after each title, so several can be reserved in one go.
 */
export function ReserveDialog({
  orgId,
  branchId,
  member: known,
  book: first,
  onClose,
  onDone,
}: {
  orgId: string;
  branchId: string;
  member?: Pick<Member, 'id' | 'fullName'>;
  book?: Pick<Book, 'id' | 'title'>;
  onClose: () => void;
  /** After each title reserved; the dialog stays open. */
  onDone: (msg: string) => void;
}) {
  const [member, setMember] = useState(known ?? null);
  const [book, setBook] = useState(first ?? null);
  const [placed, setPlaced] = useState<string[]>([]);
  const form = useRef<HTMLFormElement>(null);
  // Counts only, from the server: says before saving whether a copy will be held or the member will wait.
  const stock = useAsync(() => (book ? call<Stock>('copies-availability', { orgId, bookId: book.id }) : Promise.resolve(null)), [orgId, book?.id]);
  const here = stock.data?.branches.find((b) => b.branchId === branchId)?.available ?? 0;
  const elsewhere = (stock.data?.branches ?? []).filter((b) => b.branchId !== branchId && b.available > 0);
  const { busy, error, submit } = useSubmit(async () => {
    if (!book || !member) return;
    // Each title is its own request.
    const r = await command<{ status: string; copyCode: string | null }>('reservations-place', { orgId, memberId: member.id, bookId: book.id, branchId });
    const msg = r.status === 'ALLOCATED' ? lt.reserveHeld(book.title, r.copyCode) : lt.reserveWaiting(book.title);
    setPlaced((list) => [...list, msg]);
    setBook(null);
    onDone(msg);
  });
  // A step is done (member found, title picked or reserved) and the control used for it has gone: the keyboard
  // moves to the next one. Not on opening, where the dialog places focus itself.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    form.current?.querySelector<HTMLElement>(member && book ? 'button[type="submit"]' : 'input[type="search"]')?.focus();
  }, [member, book, placed.length]);
  return (
    <Dialog title={member ? lt.reserveTitleFor(member.fullName) : lt.placeReservation} onClose={onClose}>
      <form onSubmit={submit} noValidate ref={form}>
        {!member ? (
          <MemberPicker orgId={orgId} branchId={branchId} label={lt.reserveFor} onPick={setMember} />
        ) : (
          !known && (
            <p>
              {lt.reserveFor}: <strong>{member.fullName}</strong>{' '}
              <button type="button" className="btn btn-text" disabled={busy} onClick={() => setMember(null)}>
                {lt.reserveChange}
              </button>
            </p>
          )
        )}
        {placed.map((msg, n) => (
          <Notice key={n} tone="ok">
            {msg}
          </Notice>
        ))}
        {book ? (
          <>
            <p>
              <strong>{book.title}</strong>{' '}
              <button type="button" className="btn btn-text" disabled={busy} onClick={() => setBook(null)}>
                {lt.reserveChange}
              </button>
            </p>
            {stock.data && (
              <p className="muted small">
                {here > 0 ? lt.reserveStockHere(here) : lt.reserveStockNone}
                {elsewhere.length > 0 && ` ${lt.reserveStockElsewhere(elsewhere.map((b) => `${b.branchName} (${b.available})`).join(', '))}`}
              </p>
            )}
          </>
        ) : (
          <>
            {placed.length > 0 && <p className="muted small">{lt.reserveNext}</p>}
            <BookPicker label={lt.reserveBook} onPick={setBook} />
          </>
        )}
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-text" onClick={onClose} disabled={busy}>
            {placed.length ? lt.finished : t.cancel}
          </button>
          <button type="submit" className="btn btn-filled" disabled={busy || !book || !member} data-autofocus={first && known ? true : undefined}>
            {busy ? t.saving : lt.placeReservation}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
