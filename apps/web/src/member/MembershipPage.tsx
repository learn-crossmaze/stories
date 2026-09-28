import { useEffect, useState } from 'react';

import { toApiError } from '../data/api';
import { label } from '../data/common';
import {
  cancelUnpaid,
  checkOnlinePayment,
  currentTerm,
  type Membership,
  type MyPlan,
  pendingSubscription,
  startOnlinePayment,
  subscribeToPlan,
} from '../data/me';
import { day, money } from '../shared/format';
import { t } from '../strings';
import { useMemberData } from './memberData';
import { Page, WithMembership, PlanBadge } from './common';

// Plan, renewal, online payment and payment history.
const METHOD_LABELS: Record<string, string> = {
  OFFLINE_CASH: 'Cash at the branch',
  OFFLINE_UPI: 'UPI at the branch',
  OFFLINE_CARD: 'Card at the branch',
  OFFLINE_BANK_TRANSFER: 'Bank transfer',
  ONLINE_LINK: 'Online (payment link)',
  ONLINE_UPI_QR: 'Online (UPI QR)',
};

export function MembershipPage() {
  return (
    <Page title={t.navMembership}>
      <WithMembership>{(m) => <MembershipBody m={m} />}</WithMembership>
    </Page>
  );
}

function MembershipBody({ m }: { m: Membership }) {
  const { overview } = useMemberData();
  const term = currentTerm(m);
  const pending = pendingSubscription(m);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'ok', text: ok });
      overview.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  const pay = (subscriptionId: string) =>
    act(
      'pay',
      async () => {
        const r = await startOnlinePayment(m, subscriptionId);
        if (r.url) window.open(r.url, '_blank', 'noopener');
      },
      t.mePayOpened,
    );
  const check = async (subscriptionId: string) => {
    setBusy('check');
    setMsg(null);
    try {
      const r = await checkOnlinePayment(m, subscriptionId);
      setMsg(r.paid ? { tone: 'ok', text: t.mePaid } : { tone: 'error', text: t.meNotPaidYet });
      if (r.paid) overview.reload();
    } catch (e) {
      setMsg({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  // Coming back to the tab after paying: check once automatically.
  useEffect(() => {
    if (!pending || !m.paymentRequests.length) return;
    const onFocus = () =>
      void checkOnlinePayment(m, pending.id).then(
        (r) => r.paid && overview.reload(),
        () => undefined,
      );
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, m.paymentRequests.length]);

  return (
    <>
      {msg && (
        <p className={msg.tone === 'ok' ? 'notice notice-ok' : 'notice notice-error'} role={msg.tone === 'ok' ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}

      <section className="card member-card">
        <div className="member-card-head">
          <div>
            <h2>{term?.planSnapshot.name ?? t.meNoPlan}</h2>
            <p className="muted">
              {term
                ? t.meTerm(day(term.startAt), day(term.endAt))
                : m.member.renewalDueAt
                  ? t.meEndedOn + ' ' + day(m.member.renewalDueAt)
                  : t.meNeverSubscribed}
            </p>
          </div>
          <PlanBadge m={m} />
        </div>
        {term && <p className="muted small">{t.meTermDetail(term.planSnapshot.maxSimultaneousBooks)}</p>}
      </section>

      {pending && (
        <section className="card pay-card">
          <h2>{t.meCompletePayment}</h2>
          <p>{t.mePendingFor(pending.planSnapshot.name)}</p>
          <dl className="facts">
            <dt>{t.meFee}</dt>
            <dd>{money(pending.amountDue.subscriptionMinor)}</dd>
            {pending.amountDue.depositMinor > 0 && (
              <>
                <dt>{t.meDepositTopUp}</dt>
                <dd>{money(pending.amountDue.depositMinor)}</dd>
              </>
            )}
            <dt>{t.meTotal}</dt>
            <dd>
              <strong>{money(pending.amountDue.totalMinor)}</strong>
            </dd>
          </dl>
          <div className="row">
            {m.branch.onlinePayments ? (
              <>
                <button type="button" className="btn btn-filled" disabled={busy !== null} onClick={() => void pay(pending.id)}>
                  {busy === 'pay' ? t.saving : t.mePayOnline}
                </button>
                {!!m.paymentRequests.length && (
                  <button type="button" className="btn btn-outlined" disabled={busy !== null} onClick={() => void check(pending.id)}>
                    {busy === 'check' ? t.saving : t.meIHavePaid}
                  </button>
                )}
              </>
            ) : (
              <p className="muted">{t.mePayAtCounter(m.branch.name)}</p>
            )}
            <button type="button" className="btn btn-text" disabled={busy !== null} onClick={() => void act('cancel', () => cancelUnpaid(m, pending.id))}>
              {t.meChooseAnother}
            </button>
          </div>
        </section>
      )}

      {!pending && (
        <section className="section">
          <h2>{term ? t.meRenewOrChange : t.meChoosePlan}</h2>
          {!m.plans.length ? (
            <p className="muted">{t.meNoPlans}</p>
          ) : (
            <ul className="plan-grid">
              {m.plans.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  busy={busy === p.id}
                  disabled={busy !== null || m.member.status !== 'ACTIVE'}
                  onChoose={() => void act(p.id, () => subscribeToPlan(m, p.id))}
                />
              ))}
            </ul>
          )}
          {term && <p className="muted small">{t.meRenewWindow}</p>}
        </section>
      )}

      <section className="section">
        <h2>{t.mePayments}</h2>
        {!m.payments.length ? (
          <p className="muted">{t.meNoPayments}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.meDate}</th>
                  <th scope="col">{t.meFor}</th>
                  <th scope="col">{t.meMethod}</th>
                  <th scope="col">{t.meAmount}</th>
                </tr>
              </thead>
              <tbody>
                {m.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{day(p.at)}</td>
                    <td>{p.lines.map((l) => label(l.type)).join(' + ')}</td>
                    <td>{METHOD_LABELS[p.method] ?? label(p.method)}</td>
                    <td className="nowrap">
                      {p.direction === 'OUT' ? '−' : ''}
                      {money(p.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2>{t.meSubscriptionHistory}</h2>
        {!m.subscriptions.length ? (
          <p className="muted">{t.meNeverSubscribed}</p>
        ) : (
          <ul className="plain-list">
            {m.subscriptions.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.planSnapshot.name}</strong> <span className="muted small">{label(s.kind)}</span>
                </span>
                <span className="muted small">
                  {label(s.status === 'PENDING_PAYMENT' ? 'AWAITING_PAYMENT' : s.status)}
                  {s.startAt && s.endAt ? ` · ${day(s.startAt)} – ${day(s.endAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2>{t.meDeposit}</h2>
        <p>{m.deposit ? t.meDepositHeld(money(m.deposit.balanceMinor)) : t.meNoDeposit}</p>
        {!!m.ledger.length && (
          <ul className="plain-list">
            {m.ledger.map((e) => (
              <li key={e.id}>
                <span>
                  {label(e.type.replace(/^DEPOSIT_/, ''))} <span className="muted small">{e.reason}</span>
                </span>
                <span className="muted small nowrap">
                  {day(e.at)} · {e.deltaMinor < 0 ? '−' : '+'}
                  {money(Math.abs(e.deltaMinor))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PlanCard({ plan, busy, disabled, onChoose }: { plan: MyPlan; busy: boolean; disabled: boolean; onChoose: () => void }) {
  return (
    <li className="plan-card">
      <strong>{plan.name}</strong>
      <span className="plan-price">
        {money(plan.priceMinor)} <span className="muted small">/ {label(plan.duration).toLowerCase()}</span>
      </span>
      {plan.priceMinor < plan.listPriceMinor && <span className="muted small">{t.meWasPrice(money(plan.listPriceMinor))}</span>}
      <span className="small">{t.meBooksAtATime(plan.maxSimultaneousBooks)}</span>
      <span className="muted small">{t.meRefundableDeposit(money(plan.depositMinor))}</span>
      {plan.description && <span className="muted small">{plan.description}</span>}
      <button type="button" className="btn btn-filled" disabled={disabled} onClick={onChoose}>
        {busy ? t.saving : t.meChoose}
      </button>
    </li>
  );
}
