import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import {
  type Book,
  depositAccount,
  getMember,
  label,
  ledger,
  listPlans,
  type Loan,
  type Member,
  memberAdjustments,
  memberLoans,
  memberReservations,
  memberSubscriptions,
  type Plan,
  type Subscription,
  toDate,
  wardsOf,
} from '../../data/library';
import { useAsync } from '../../data/useAsync';
import { day, money, since, toMinor, when } from '../../format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows, StatusBadge } from '../../ui';
import { ConfirmWithReason, Dialog, DialogActions, FormError, SelectField, TextField, useSubmit } from '../Dialog';
import { Notice, Tabs } from '../kit';
import { lt } from '../libraryStrings';
import { useWorkspace } from '../Workspace';
import { BookPicker } from './BookPicker';
import { MemberDialog } from './Members';
import { LoanHistory, MemberAudit, PaymentHistory, SubscriptionHistory } from './MemberHistory';

const METHODS = [
  { value: 'OFFLINE_CASH', label: 'Cash' },
  { value: 'OFFLINE_UPI', label: 'UPI' },
  { value: 'OFFLINE_CARD', label: 'Card' },
  { value: 'OFFLINE_BANK_TRANSFER', label: 'Bank transfer' },
] as const;
type Method = (typeof METHODS)[number]['value'];

function PaymentDialog({ orgId, sub, onClose, onDone }: { orgId: string; sub: Subscription; onClose: () => void; onDone: () => void }) {
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
        <dl className="facts">
          <dt>{lt.planFee}</dt>
          <dd>{money(sub.amountDue.subscriptionMinor)} · {sub.planSnapshot.name}</dd>
          <dt>{lt.depositTopUp}</dt>
          <dd>{money(sub.amountDue.depositMinor)}</dd>
          <dt>{lt.total}</dt>
          <dd>
            <strong>{money(sub.amountDue.totalMinor)}</strong>
          </dd>
        </dl>
        <SelectField label={lt.paymentMethod} value={method} onChange={setMethod} options={[...METHODS]} />
        {method !== 'OFFLINE_CASH' && <TextField label={lt.reference} value={reference} onChange={setReference} />}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={`${lt.recordPayment} · ${money(sub.amountDue.totalMinor)}`} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function SubscribeDialog({ orgId, member, renewing, onClose, onCreated }: { orgId: string; member: Member; renewing: boolean; onClose: () => void; onCreated: () => void }) {
  const plans = useAsync(() => listPlans(orgId), [orgId]);
  const eligible = (plans.data ?? []).filter((p) => p.status === 'ACTIVE' && p.audiences.includes(member.audience));
  const [planId, setPlanId] = useState('');
  const chosen = eligible.find((p) => p.id === planId) ?? eligible[0];
  const { busy, error, submit } = useSubmit(async () => {
    if (!chosen) return;
    await command('subscriptions-create', { orgId, memberId: member.id, planId: chosen.id });
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
                <input type="radio" name="plan" checked={chosen?.id === p.id} onChange={() => setPlanId(p.id)} />
                <span>
                  <strong>{p.name}</strong> · {label(p.duration)} · {p.maxSimultaneousBooks} {lt.maxBooks.toLowerCase()}
                  <span className="muted small">
                    {' '}
                    {money(p.priceMinor)} + {lt.depositAmount.replace(' (₹)', '').toLowerCase()} {money(p.depositMinor)}
                  </span>
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

function AdjustmentDialog({ orgId, memberId, onClose, onDone }: { orgId: string; memberId: string; onClose: () => void; onDone: () => void }) {
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
        <SelectField label="Type" value={kind} onChange={setKind} options={[{ value: 'DEDUCTION', label: lt.deduction }, { value: 'ADJUSTMENT', label: lt.adjustment }]} />
        {kind === 'ADJUSTMENT' && <SelectField label="Direction" value={direction} onChange={setDirection} options={[{ value: 'DEBIT', label: lt.debit }, { value: 'CREDIT', label: lt.credit }]} />}
        <TextField label={lt.amount} value={amount} onChange={setAmount} />
        <TextField label={t.reasonLabel} value={reason} onChange={setReason} hint={t.reasonHint} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={lt.proposeAdjustment} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function RefundDialog({ orgId, memberId, balance, onClose, onDone }: { orgId: string; memberId: string; balance: number; onClose: () => void; onDone: () => void }) {
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
        <SelectField label={lt.paymentMethod} value={method} onChange={setMethod} options={[{ value: 'OFFLINE_CASH', label: 'Cash' }, { value: 'OFFLINE_UPI', label: 'UPI' }, { value: 'OFFLINE_BANK_TRANSFER', label: 'Bank transfer' }]} />
        {method !== 'OFFLINE_CASH' && <TextField label={lt.reference} value={reference} onChange={setReference} />}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={lt.refund} onCancel={onClose} danger />
      </form>
    </Dialog>
  );
}

function ReserveDialog({ orgId, memberId, branchId, onClose, onDone }: { orgId: string; memberId: string; branchId: string; onClose: () => void; onDone: (msg: string) => void }) {
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

type DialogKind = 'edit' | 'subscribe' | 'renew' | 'pay' | 'cancelPending' | 'adjust' | 'settle' | 'refund' | 'reserve' | 'suspend' | 'reactivate' | 'close';

export function MemberDetailPage() {
  const { memberId = '' } = useParams();
  const { claims } = useAuth();
  const { org, branchName } = useWorkspace();
  const orgId = org?.id ?? '';
  const scope = org ? branchScope(claims, org.id) : 'ALL';
  const deps = [orgId, memberId, JSON.stringify(scope)];
  const member = useAsync(() => (orgId ? getMember(orgId, memberId) : Promise.resolve(null)), deps);
  const m = member.data;
  const b = m?.homeBranchId ?? '';
  const canDeposits = !!m && can(claims, 'deposits.view', orgId, b);
  const subs = useAsync(() => (orgId ? memberSubscriptions(orgId, memberId, scope) : Promise.resolve([])), deps);
  const loans = useAsync(() => (orgId ? memberLoans(orgId, memberId, scope, false) : Promise.resolve([])), deps);
  const reservations = useAsync(() => (orgId ? memberReservations(orgId, memberId, scope) : Promise.resolve([])), deps);
  const deposit = useAsync(async () => {
    if (!orgId || !canDeposits) return null;
    const account = await depositAccount(orgId, memberId);
    // The ledger lives under the account; members have none until their first deposit.
    return { account, ledger: account ? await ledger(orgId, memberId) : [], adjustments: await memberAdjustments(orgId, memberId, scope) };
  }, [...deps, canDeposits]);
  const wards = useAsync(() => (orgId && m && !m.isMinor ? wardsOf(orgId, b, memberId) : Promise.resolve([])), [...deps, b]);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [lostLoan, setLostLoan] = useState<Loan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'history' | 'audit'>('overview');
  const [reloadKey, setReloadKey] = useState(0);

  if (member.loading) return <SkeletonRows rows={5} />;
  if (member.error) return <ErrorState message={member.error} onRetry={member.reload} />;
  if (!m) return <EmptyState icon="person" title={t.notFoundTitle} message="" />;

  const refresh = () => {
    member.reload();
    subs.reload();
    loans.reload();
    reservations.reload();
    deposit.reload();
    setReloadKey((k) => k + 1);
  };
  const perm = (p: Parameters<typeof can>[1]) => can(claims, p, orgId, b);
  const allSubs = subs.data ?? [];
  const current = allSubs.find((s) => s.id === m.activeSubscriptionId && s.status === 'ACTIVE' && (toDate(s.endAt)?.getTime() ?? 0) > Date.now());
  const next = allSubs.find((s) => s.id === m.nextSubscriptionId && s.status === 'ACTIVE');
  const pending = allSubs.find((s) => s.status === 'PENDING_PAYMENT');
  const max = current?.planSnapshot.maxSimultaneousBooks ?? 0;
  const activeLoans = (loans.data ?? []).filter((l) => l.status === 'ACTIVE');
  const pastLoans = (loans.data ?? []).filter((l) => l.status !== 'ACTIVE');
  const openRes = (reservations.data ?? []).filter((r) => r.status === 'WAITING' || r.status === 'ALLOCATED');
  const acct = deposit.data?.account;
  const pendingAdj = (deposit.data?.adjustments ?? []).filter((a) => a.status === 'PENDING');

  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminMembers}>{lt.membersTitle}</Link> / <span className="mono">{m.code}</span>
      </p>
      <header className="page-header page-header-row">
        <div>
          <h1>{m.fullName}</h1>
          <p className="muted">
            <span className="mono">{m.code}</span> · {label(m.audience)} · {m.phone ?? '—'} · {branchName(m.homeBranchId)}
          </p>
          {m.guardian && (
            <p>
              {lt.guardian}: <Link to={paths.adminMember(m.guardian.memberId)}>{m.guardian.name}</Link> ({m.guardian.relationship})
            </p>
          )}
          {!!wards.data?.length && (
            <p>
              {lt.wards}:{' '}
              {wards.data.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ', '}
                  <Link to={paths.adminMember(w.id)}>{w.fullName}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="row">
          <StatusBadge status={m.status} />
          {perm('members.manage') && m.status !== 'CLOSED' && (
            <>
              <button type="button" className="btn btn-outlined" onClick={() => setDialog('edit')}>
                {t.edit}
              </button>
              {m.status === 'ACTIVE' ? (
                <button type="button" className="btn btn-text" onClick={() => setDialog('suspend')}>
                  {lt.suspend}
                </button>
              ) : (
                <button type="button" className="btn btn-text" onClick={() => setDialog('reactivate')}>
                  {lt.reactivate}
                </button>
              )}
              <button type="button" className="btn btn-text" onClick={() => setDialog('close')}>
                {lt.closeMembership}
              </button>
            </>
          )}
        </div>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview' as const, label: lt.tabOverview },
          { value: 'history' as const, label: lt.tabHistory },
          ...(perm('audit.view') ? [{ value: 'audit' as const, label: lt.tabAudit }] : []),
        ]}
      />

      {tab === 'overview' && (
      <>
      <div className="panels">
        <section className="card">
          <h2>{lt.subscription}</h2>
          {subs.loading ? (
            <SkeletonRows rows={2} />
          ) : subs.error ? (
            <ErrorState message={subs.error} onRetry={subs.reload} />
          ) : current ? (
            <>
              <p className="lead">
                <strong>{current.planSnapshot.name}</strong> · {lt.activeUntil(day(current.endAt))}
              </p>
              <p>
                {lt.held(m.activeLoanCount + m.allocatedCount, max)} · {lt.exchangesThisTerm(current.exchangesThisTerm)}
              </p>
            </>
          ) : (
            <p className="lead muted">{lt.noPlan}</p>
          )}
          {next && <p>{lt.renewsOn(day(next.startAt))} · {next.planSnapshot.name}</p>}
          <p className="muted small">{lt.lifetime(m.lifetimeLoans, m.lifetimeExchanges)}</p>
          {pending && (
            <div className="pending-box">
              <p>
                <strong>{lt.pendingPayment}:</strong> {pending.planSnapshot.name} · {money(pending.amountDue.totalMinor)}
              </p>
              <div className="row">
                {perm('payments.recordOffline') && (
                  <button type="button" className="btn btn-filled" onClick={() => setDialog('pay')}>
                    {lt.recordPayment}
                  </button>
                )}
                {perm('subscriptions.manage') && (
                  <button type="button" className="btn btn-text" onClick={() => setDialog('cancelPending')}>
                    {lt.cancelPending}
                  </button>
                )}
              </div>
            </div>
          )}
          {!subs.loading && !subs.error && !pending && m.status === 'ACTIVE' && perm('subscriptions.manage') && !next && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog(current ? 'renew' : 'subscribe')}>
              {current ? lt.renew : lt.subscribe}
            </button>
          )}
        </section>

        {canDeposits && (
          <section className="card">
            <h2>{lt.deposit}</h2>
            {deposit.loading || !deposit.data ? (
              deposit.error ? <ErrorState message={deposit.error} onRetry={deposit.reload} /> : <SkeletonRows rows={2} />
            ) : (
            <>
            <p className="lead">
              {money(acct?.balanceMinor ?? 0)} {acct && acct.status !== 'OPEN' && <span className="badge badge-warn">{label(acct.status)}</span>}
            </p>
            {pendingAdj.length > 0 && (
              <p className="small">
                {lt.pendingApprovals}: {pendingAdj.map((a) => `${money(a.deltaMinor)} (${a.reason})`).join('; ')}
              </p>
            )}
            <div className="row">
              {perm('deposits.adjust') && acct?.status === 'OPEN' && (
                <>
                  <button type="button" className="btn btn-outlined" onClick={() => setDialog('adjust')}>
                    {lt.proposeAdjustment}
                  </button>
                  <button type="button" className="btn btn-text" onClick={() => setDialog('settle')}>
                    {lt.startSettlement}
                  </button>
                </>
              )}
              {perm('deposits.refund') && acct?.status === 'SETTLING' && (
                <button type="button" className="btn btn-filled" onClick={() => setDialog('refund')}>
                  {lt.refund}
                </button>
              )}
            </div>
            {!!deposit.data?.ledger.length && (
              <table className="table compact">
                <tbody>
                  {deposit.data.ledger.slice(0, 8).map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap small">{day(e.at)}</td>
                      <td className="small">{label(e.type.replace('DEPOSIT_', ''))}</td>
                      <td className={`nowrap ${e.deltaMinor < 0 ? 'neg' : ''}`}>{money(e.deltaMinor)}</td>
                      <td className="nowrap muted small">= {money(e.balanceAfterMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            </>
            )}
          </section>
        )}
      </div>

      <section className="section">
        <h2>{lt.currentBooks}</h2>
        {loans.loading ? (
          <SkeletonRows rows={2} />
        ) : loans.error ? (
          <ErrorState message={loans.error} onRetry={loans.reload} />
        ) : !activeLoans.length ? (
          <p className="muted">{lt.noCurrentBooks}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{lt.title}</th>
                  <th scope="col">{lt.copy}</th>
                  <th scope="col">{lt.borrowedFor}</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeLoans.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={paths.adminBook(l.bookId)}>{l.bookTitle}</Link>
                    </td>
                    <td className="mono">{l.copyCode}</td>
                    <td>{since(l.issuedAt)} <span className="muted small">(since {day(l.issuedAt)})</span></td>
                    <td className="cell-actions">
                      {can(claims, 'copies.writeOff', orgId, l.branchId) && (
                        <button type="button" className="btn btn-text" onClick={() => setLostLoan(l)}>
                          {lt.declareLost}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="page-header-row">
          <h2>{lt.reservations}</h2>
          {perm('reservations.manage') && current && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('reserve')}>
              {lt.placeReservation}
            </button>
          )}
        </div>
        {reservations.loading ? (
          <SkeletonRows rows={1} />
        ) : reservations.error ? (
          <ErrorState message={reservations.error} onRetry={reservations.reload} />
        ) : !openRes.length ? (
          <p className="muted">{lt.noReservations}</p>
        ) : (
          <ul className="plain-list">
            {openRes.map((r) => (
              <li key={r.id}>
                <span>{r.bookTitle}</span>
                <span className="muted small">
                  {r.status === 'ALLOCATED' ? `${r.allocatedCopyCode} · ${lt.holdUntil(when(r.holdUntil))}` : lt.waitingQueue}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      </>
      )}

      {tab === 'history' && (
        <>
          <section className="section">
            <h2>{lt.subscriptionHistory}</h2>
            <SubscriptionHistory subs={allSubs} loading={subs.loading} error={subs.error} onRetry={subs.reload} />
          </section>
          {perm('payments.view') && (
            <section className="section">
              <h2>{lt.paymentHistory}</h2>
              <PaymentHistory orgId={orgId} memberId={m.id} scope={scope} reloadKey={reloadKey} />
            </section>
          )}
          <section className="section">
            <h2>{lt.loanHistory}</h2>
            {loans.error ? <ErrorState message={loans.error} onRetry={loans.reload} /> : <LoanHistory loans={pastLoans} />}
          </section>
        </>
      )}

      {tab === 'audit' && perm('audit.view') && (
        <section className="section">
          <MemberAudit orgId={orgId} memberId={m.id} scope={scope} branchName={branchName} reloadKey={reloadKey} />
        </section>
      )}

      {dialog === 'edit' && <MemberDialog orgId={orgId} branchId={b} member={m} onClose={() => setDialog(null)} onSaved={() => member.reload()} />}
      {(dialog === 'subscribe' || dialog === 'renew') && <SubscribeDialog orgId={orgId} member={m} renewing={dialog === 'renew'} onClose={() => setDialog(null)} onCreated={refresh} />}
      {dialog === 'pay' && pending && (
        <PaymentDialog orgId={orgId} sub={pending} onClose={() => setDialog(null)} onDone={() => { setNotice(lt.paymentRecorded); refresh(); }} />
      )}
      {dialog === 'cancelPending' && pending && (
        <ConfirmWithReason title={`${lt.cancelPending} ${pending.planSnapshot.name}?`} body="" confirmLabel={lt.cancelPending} onClose={() => setDialog(null)}
          onConfirm={async (reason) => { await command('subscriptions-cancelPending', { orgId, subscriptionId: pending.id, reason }); refresh(); setDialog(null); }} />
      )}
      {dialog === 'adjust' && <AdjustmentDialog orgId={orgId} memberId={m.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'settle' && (
        <ConfirmWithReason title={`${lt.startSettlement}?`} body="" confirmLabel={lt.startSettlement} onClose={() => setDialog(null)}
          onConfirm={async () => { await command('deposits-startSettlement', { orgId, memberId: m.id }); refresh(); setDialog(null); }} />
      )}
      {dialog === 'refund' && <RefundDialog orgId={orgId} memberId={m.id} balance={acct?.balanceMinor ?? 0} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'reserve' && <ReserveDialog orgId={orgId} memberId={m.id} branchId={b} onClose={() => setDialog(null)} onDone={(msg) => { setNotice(msg); refresh(); }} />}
      {(dialog === 'suspend' || dialog === 'reactivate' || dialog === 'close') && (
        <ConfirmWithReason
          title={lt.statusTitle(dialog === 'suspend' ? lt.suspend : dialog === 'reactivate' ? lt.reactivate : lt.closeMembership)}
          body=""
          confirmLabel={dialog === 'suspend' ? lt.suspend : dialog === 'reactivate' ? lt.reactivate : lt.closeMembership}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await command('members-setStatus', { orgId, memberId: m.id, status: dialog === 'suspend' ? 'SUSPENDED' : dialog === 'reactivate' ? 'ACTIVE' : 'CLOSED', reason });
            member.reload();
            setDialog(null);
          }}
        />
      )}
      {lostLoan && (
        <ConfirmWithReason title={lt.declareLostTitle(lostLoan.bookTitle)} body={lt.declareLostBody} confirmLabel={lt.declareLost} onClose={() => setLostLoan(null)}
          onConfirm={async (reason) => { await command('circulation-declareLost', { orgId, loanId: lostLoan.id, reason }); refresh(); setLostLoan(null); }} />
      )}
    </>
  );
}
