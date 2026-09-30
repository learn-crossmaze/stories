// Payments & refunds (Operations → Members): payments received at the branch, refunds through Razorpay or at the counter.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { ApiError } from '../../data/api';
import { branchPayments, checkRefund, depositAccount, depositLeft, type Payment, type PaymentView, refundable, type RefundInput, refundPayment } from '../../data/billing';
import { label } from '../../data/common';
import { paths } from '../../paths';
import { money, toMinor, when } from '../../shared/format';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { Dialog, DialogActions, FormError, SelectField, TextField } from '../components/Dialog';
import { NeedBranch, Notice, Tabs } from '../components/kit';
import { useWorkspace } from '../Workspace';

/** "UPI", "Razorpay link"… */
export const methodLabel = (m: string) => lt.paymentMethods[m] ?? label(m.replace(/^(OFFLINE|ONLINE)_/, ''));
const REFUND_TONE: Record<string, string> = { SUCCESS: 'ok', PENDING: 'info', PROCESSING: 'info', FAILED: 'danger' };

/** Refund status in words: always text, never colour alone. */
export function RefundBadge({ status }: { status: string }) {
  return <span className={`badge badge-${REFUND_TONE[status] ?? 'muted'}`}>{lt.refundStatus[status] ?? label(status)}</span>;
}

/**
 * Refunds (part of) a payment. A Razorpay payment goes back through Razorpay
 * (to the member's card, UPI or bank, from the branch's Razorpay balance); a
 * counter payment is refunded at the counter and recorded with how.
 */
export function RefundDialog({ orgId, payment, memberName, onClose, onDone }: { orgId: string; payment: Payment; memberName?: string; onClose: () => void; onDone: (msg: string) => void }) {
  const online = !!payment.gateway?.paymentId;
  const left = refundable(payment);
  const depositPart = depositLeft(payment);
  const account = useAsync(() => (depositPart > 0 ? depositAccount(orgId, payment.memberId) : Promise.resolve(null)), [orgId, payment.memberId, depositPart]);
  const maxDeposit = Math.min(depositPart, account.data?.balanceMinor ?? 0);
  const [amount, setAmount] = useState(String(left / 100));
  const [fromDeposit, setFromDeposit] = useState('0');
  const [method, setMethod] = useState<RefundInput['method']>(online ? 'RAZORPAY' : 'OFFLINE_CASH');
  const [reference, setReference] = useState('');
  const [speed, setSpeed] = useState<RefundInput['speed']>('normal');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per dialog: a retry after a network error can't refund twice.
  const [requestId] = useState(() => crypto.randomUUID());

  const amountMinor = toMinor(amount);
  const depositMinor = fromDeposit.trim() ? toMinor(fromDeposit) : 0;
  const errors = {
    amount: !Number.isFinite(amountMinor) || amountMinor < 100 ? lt.refundMin : amountMinor > left ? lt.refundMax(money(left)) : undefined,
    deposit:
      !Number.isFinite(depositMinor) || depositMinor < 0 ? lt.refundMin : depositMinor > Math.min(maxDeposit, amountMinor || 0) ? lt.refundDepositMax(money(Math.min(maxDeposit, amountMinor || 0))) : undefined,
    reference: method !== 'RAZORPAY' && method !== 'OFFLINE_CASH' && reference.trim().length < 4 ? lt.refundReferenceNeeded : undefined,
    reason: reason.trim().length < 3 ? t.required : undefined,
  };
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await refundPayment({ orgId, paymentId: payment.id, amountMinor, depositMinor, method, reference: reference.trim(), speed, reason: reason.trim() }, requestId);
      const who = memberName ?? payment.memberCode ?? '';
      onDone(r.status === 'PENDING' ? lt.refundPending(money(r.amountMinor), who) : lt.refundDone(money(r.amountMinor), who, r.gatewayRefundId));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={lt.refundTitle} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <dl className="facts">
          <dt>{lt.memberCol}</dt>
          <dd>{memberName ? `${memberName} · ${payment.memberCode ?? ''}` : payment.memberCode}</dd>
          <dt>{lt.refundPaid}</dt>
          <dd>
            {money(payment.amountMinor)} · {when(payment.at)} · {methodLabel(payment.method)}
          </dd>
          {(payment.refundedMinor ?? 0) > 0 && (
            <>
              <dt>{lt.refundedSoFar}</dt>
              <dd>{money(payment.refundedMinor ?? 0)}</dd>
            </>
          )}
        </dl>
        <p className="muted small">{online ? lt.refundOnlineHint : lt.refundCounterHint}</p>
        <div className="form-grid">
          <TextField label={lt.refundAmount} value={amount} onChange={setAmount} hint={lt.refundLeft(money(left))} error={e('amount')} />
          {depositPart > 0 && (
            <TextField
              label={lt.refundFromDeposit}
              value={fromDeposit}
              onChange={setFromDeposit}
             
              hint={account.loading ? t.loading : lt.refundDepositHint(money(maxDeposit))}
              error={e('deposit')}
            />
          )}
          {online ? (
            <SelectField
              label={lt.refundSpeed}
              value={speed}
              onChange={setSpeed}
              options={[
                { value: 'normal', label: lt.refundSpeedNormal },
                { value: 'optimum', label: lt.refundSpeedInstant },
              ]}
            />
          ) : (
            <>
              <SelectField
                label={lt.method}
                value={method}
                onChange={setMethod}
                options={(['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER'] as const).map((m) => ({ value: m, label: methodLabel(m) }))}
              />
              {method !== 'OFFLINE_CASH' && <TextField label={lt.reference} value={reference} onChange={setReference} error={e('reference')} />}
            </>
          )}
        </div>
        <TextField label={lt.refundReason} value={reason} onChange={setReason} error={e('reason')} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={Number.isFinite(amountMinor) && amountMinor > 0 ? lt.refundSubmit(money(amountMinor)) : lt.refundTitle} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function BranchPayments({ orgId, branchId }: { orgId: string; branchId: string }) {
  const { claims } = useAuth();
  const canRefund = can(claims, 'payments.refund', orgId, branchId);
  const [view, setView] = useState<PaymentView>('RECEIVED');
  const list = useAsync(() => branchPayments(orgId, branchId, view), [orgId, branchId, view]);
  const attention = useAsync(() => branchPayments(orgId, branchId, 'ATTENTION'), [orgId, branchId]);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    list.reload();
    attention.reload();
  };
  const openAttention = (attention.data ?? []).filter((p) => refundable(p) > 0).length;

  const check = async (p: Payment) => {
    setChecking(p.id);
    setError(null);
    try {
      const r = await checkRefund(orgId, p.id);
      setNotice(lt.refundChecked(lt.refundStatus[r.status] ?? r.status));
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setChecking(null);
    }
  };

  const rows = list.data ?? [];
  return (
    <>
      <Tabs
        value={view}
        onChange={(v) => {
          setView(v);
          setError(null);
        }}
        tabs={[
          { value: 'RECEIVED', label: lt.paymentsReceived },
          { value: 'ATTENTION', label: lt.paymentsAttention, count: openAttention || undefined },
          { value: 'REFUNDS', label: lt.paymentsRefunds },
        ]}
      />
      {notice && <Notice tone="ok">{notice}</Notice>}
      <FormError error={error} />
      {view === 'ATTENTION' && <p className="muted small">{lt.paymentsAttentionHint}</p>}
      {list.loading ? (
        <SkeletonRows rows={5} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        <EmptyState icon="payments" title={view === 'REFUNDS' ? lt.refundsEmpty : view === 'ATTENTION' ? lt.attentionEmpty : lt.paymentsEmpty} message="" />
      ) : view === 'REFUNDS' ? (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{lt.date}</th>
                <th scope="col">{lt.memberCol}</th>
                <th scope="col">{lt.amountCol}</th>
                <th scope="col">{lt.method}</th>
                <th scope="col">{lt.status}</th>
                <th scope="col">{lt.refundReason}</th>
                <th scope="col">
                  <span className="sr-only">{lt.actionsCol}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{when(p.at)}</td>
                  <td>
                    <Link to={paths.adminMember(p.memberId)}>{p.memberName ?? p.memberCode}</Link>
                    <div className="muted small mono">{p.memberCode}</div>
                  </td>
                  <td className="nowrap">
                    {money(p.amountMinor)}
                    {(p.depositMinor ?? 0) > 0 && <div className="muted small">{lt.refundInclDeposit(money(p.depositMinor ?? 0))}</div>}
                  </td>
                  <td>
                    {methodLabel(p.method)}
                    {p.reference && <div className="muted small mono">{p.reference}</div>}
                  </td>
                  <td>
                    <RefundBadge status={p.status} />
                    {p.failure && <div className="muted small">{p.failure}</div>}
                  </td>
                  <td>
                    {p.reason}
                    {p.recordedByEmail && <div className="muted small">{p.recordedByEmail}</div>}
                  </td>
                  <td className="cell-actions">
                    {p.method === 'RAZORPAY' && ['PROCESSING', 'PENDING'].includes(p.status) && (
                      <button type="button" className="btn btn-text" disabled={checking === p.id} onClick={() => void check(p)}>
                        {checking === p.id ? t.loading : lt.refundCheck}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{lt.date}</th>
                <th scope="col">{lt.memberCol}</th>
                <th scope="col">{lt.paidFor}</th>
                <th scope="col">{lt.method}</th>
                <th scope="col">{lt.amountCol}</th>
                <th scope="col">
                  <span className="sr-only">{lt.actionsCol}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const left = refundable(p);
                const refunded = p.refundedMinor ?? 0;
                return (
                  <tr key={p.id}>
                    <td className="nowrap">{when(p.at)}</td>
                    <td>
                      <Link to={paths.adminMember(p.memberId)} className="mono">
                        {p.memberCode}
                      </Link>
                    </td>
                    <td>
                      {p.lines.map((l) => label(l.type)).join(' + ')}
                      {p.status === 'NEEDS_ATTENTION' && <div className="muted small">{p.note}</div>}
                    </td>
                    <td>
                      {methodLabel(p.method)}
                      {p.reference && <div className="muted small mono">{p.reference}</div>}
                    </td>
                    <td className="nowrap">
                      {money(p.amountMinor)}
                      {refunded > 0 && <div className="muted small">{left > 0 ? lt.refundedPart(money(refunded)) : lt.refundedAll}</div>}
                    </td>
                    <td className="cell-actions">
                      {canRefund && left > 0 && (
                        <button type="button" className="btn btn-outlined" onClick={() => setRefunding(p)}>
                          {lt.refundAction}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {refunding && (
        <RefundDialog
          orgId={orgId}
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={(msg) => {
            setNotice(msg);
            reload();
          }}
        />
      )}
    </>
  );
}

export function PaymentsPage() {
  const { org, branch } = useWorkspace();
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{lt.paymentsTitle}</h1>
        <p className="muted">{lt.paymentsIntro(branch?.name ?? '')}</p>
      </header>
      <NeedBranch>{(branchId) => <BranchPayments orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
