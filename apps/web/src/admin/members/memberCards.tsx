// The member page's cards and sections (MemberDetail.tsx). Each owns its dialogs; the deposit,
// loans and reservations sections read their own data and refresh when the page's reloadKey changes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { can } from '../../auth/claims';
import { command } from '../../data/api';
import { depositAccount, ledger, memberAdjustments, type Subscription } from '../../data/billing';
import { type Loan, memberLoans, memberReservations } from '../../data/circulation';
import { label, planWithOption, toDate } from '../../data/common';
import type { Member } from '../../data/members';
import type { Permission } from '../../generated/rbac';
import { paths } from '../../paths';
import { day, money, since, when } from '../../shared/format';
import { Badge, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { type AsyncState, useAsync } from '../../shared/useAsync';
import { PendingUpgrade } from '../../shared/Upgrade';
import { lt } from '../../strings/library';
import { ConfirmWithReason } from '../components/Dialog';
import { LoanHistory } from './MemberHistory';
import { AdjustmentDialog, PaymentDialog, RefundDialog, ReserveDialog, SubscribeDialog, UpgradeDialog } from './memberDialogs';
import { CollectOnlineDialog } from './OnlinePayments';

type Scope = string[] | 'ALL';
type Perm = (p: Permission) => boolean;

/** Re-reads in the background whenever the page asks for a refresh (not on mount). */
function useReloadOn(reloadKey: number, reload: () => void) {
  useEffect(() => {
    if (reloadKey) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
}

/** The member's running, next and unpaid subscriptions. */
export function subscriptionState(subs: Subscription[], m: Member) {
  const current = subs.find((s) => s.id === m.activeSubscriptionId && s.status === 'ACTIVE' && (toDate(s.endAt)?.getTime() ?? 0) > Date.now());
  const next = subs.find((s) => s.id === m.nextSubscriptionId && s.status === 'ACTIVE');
  const pending = subs.find((s) => s.status === 'PENDING_PAYMENT');
  return { current, next, pending };
}

type SubscriptionDialog = 'subscribe' | 'renew' | 'upgrade' | 'pay' | 'online' | 'cancelPending';

/** Plan, books held and renewal, with payment of an unpaid subscription. */
export function SubscriptionCard({
  orgId,
  m,
  subs,
  perm,
  canCollectOnline,
  onChanged,
  onNotice,
  autoOpen = false,
  onAutoOpened,
}: {
  orgId: string;
  m: Member;
  subs: AsyncState<Subscription[]>;
  perm: Perm;
  canCollectOnline: boolean;
  onChanged: () => void;
  onNotice: (text: string) => void;
  /** Open the plan chooser by itself once it can be used (a member registered a moment ago). */
  autoOpen?: boolean;
  /** The chooser opened by itself: the page stops asking, so closing it leaves it closed. */
  onAutoOpened?: () => void;
}) {
  const [dialog, setDialog] = useState<SubscriptionDialog | null>(null);
  const { current, next, pending } = subscriptionState(subs.data ?? [], m);
  const max = current?.planSnapshot.maxSimultaneousBooks ?? 0;
  // When a plan can be sold or renewed: the same test shows the buttons and lets the chooser open by itself.
  const canStart = !subs.loading && !subs.error && !pending && m.status === 'ACTIVE' && perm('subscriptions.manage') && !next;
  useEffect(() => {
    if (!autoOpen || !canStart || current) return;
    setDialog('subscribe');
    onAutoOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, canStart, !current]);
  // The plan to offer first: the one running, or the last one paid for.
  const previous = current ?? (subs.data ?? []).find((s) => s.status === 'ACTIVE' || s.status === 'EXPIRED');
  return (
    <section className="card">
      <h2>{lt.subscription}</h2>
      {subs.loading ? (
        <SkeletonRows rows={2} />
      ) : subs.error && !subs.data ? (
        <ErrorState message={subs.error} onRetry={subs.reload} />
      ) : current ? (
        <>
          <p className="lead">
            <strong>{planWithOption(current.planSnapshot)}</strong> · {lt.activeUntil(day(current.endAt))}
          </p>
          <p>
            {lt.held(m.activeLoanCount + m.allocatedCount, max)} · {lt.exchangesThisTerm(current.exchangesThisTerm)}
          </p>
        </>
      ) : (
        <p className="lead muted">{lt.noPlan}</p>
      )}
      {next && (
        <p>
          {lt.renewsOn(day(next.startAt))} · {planWithOption(next.planSnapshot)}
        </p>
      )}
      <p className="muted small">{lt.lifetime(m.lifetimeLoans, m.lifetimeExchanges)}</p>
      {pending && (
        <div className="pending-box">
          <p>
            <strong>{lt.pendingPayment}:</strong> {planWithOption(pending.planSnapshot)} · {money(pending.amountDue.totalMinor)}
          </p>
          {pending.kind === 'UPGRADE' && pending.upgrade && <PendingUpgrade upgrade={pending.upgrade} planName={planWithOption(pending.planSnapshot)} amountDue={pending.amountDue} />}
          <div className="row">
            {perm('payments.recordOffline') && (
              <button type="button" className="btn btn-filled" onClick={() => setDialog('pay')}>
                {lt.recordPayment}
              </button>
            )}
            {perm('payments.recordOffline') && canCollectOnline && (
              <button type="button" className="btn btn-outlined" onClick={() => setDialog('online')}>
                {lt.collectOnline}
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
      {canStart && (
        <div className="row">
          <button type="button" className="btn btn-outlined" onClick={() => setDialog(current ? 'renew' : 'subscribe')}>
            {current ? lt.renew : lt.subscribe}
          </button>
          {current && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('upgrade')}>
              {lt.upgradePlan}
            </button>
          )}
        </div>
      )}

      {(dialog === 'subscribe' || dialog === 'renew') && (
        <SubscribeDialog
          orgId={orgId}
          member={m}
          renewing={dialog === 'renew'}
          previous={previous}
          canTakePayment={perm('payments.recordOffline') && perm('deposits.view')}
          onClose={() => setDialog(null)}
          onCreated={onChanged}
          onPaid={() => {
            onNotice(lt.paymentRecorded);
            onChanged();
          }}
        />
      )}
      {dialog === 'upgrade' && <UpgradeDialog orgId={orgId} member={m} onClose={() => setDialog(null)} onCreated={onChanged} />}
      {dialog === 'online' && pending && (
        <CollectOnlineDialog
          orgId={orgId}
          subscriptionId={pending.id}
          amountMinor={pending.amountDue.totalMinor}
          member={{ phone: m.phone, email: m.email ?? null }}
          onClose={() => {
            setDialog(null);
            onChanged();
          }}
          onPaid={() => onNotice(lt.paymentRecorded)}
        />
      )}
      {dialog === 'pay' && pending && (
        <PaymentDialog
          orgId={orgId}
          sub={pending}
          onClose={() => setDialog(null)}
          onDone={() => {
            onNotice(lt.paymentRecorded);
            onChanged();
          }}
        />
      )}
      {dialog === 'cancelPending' && pending && (
        <ConfirmWithReason
          title={`${lt.cancelPending} ${pending.planSnapshot.name}?`}
          body=""
          confirmLabel={lt.cancelPending}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await command('subscriptions-cancelPending', { orgId, subscriptionId: pending.id, reason });
            onChanged();
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/** The deposit card shows the latest entries only. */
const LEDGER_ROWS = 8;

/** Deposit balance and ledger, adjustments and settlement (staff who may see deposits). */
export function DepositCard({ orgId, memberId, scope, perm, reloadKey, onChanged }: { orgId: string; memberId: string; scope: Scope; perm: Perm; reloadKey: number; onChanged: () => void }) {
  const [dialog, setDialog] = useState<'adjust' | 'settle' | 'refund' | null>(null);
  const deposit = useAsync(async () => {
    const [{ account, rows }, adjustments] = await Promise.all([
      // The ledger lives under the account (members have none until their first deposit), so it waits for the account.
      depositAccount(orgId, memberId).then(async (account) => ({ account, rows: account ? await ledger(orgId, memberId, LEDGER_ROWS) : [] })),
      memberAdjustments(orgId, memberId, scope),
    ]);
    return { account, ledger: rows, adjustments };
  }, [orgId, memberId, JSON.stringify(scope)]);
  useReloadOn(reloadKey, deposit.reload);
  const acct = deposit.data?.account;
  const pendingAdj = (deposit.data?.adjustments ?? []).filter((a) => a.status === 'PENDING');
  return (
    <section className="card">
      <h2>{lt.deposit}</h2>
      {deposit.loading || !deposit.data ? (
        deposit.error ? (
          <ErrorState message={deposit.error} onRetry={deposit.reload} />
        ) : (
          <SkeletonRows rows={2} />
        )
      ) : (
        <>
          <p className="lead">
            {money(acct?.balanceMinor ?? 0)} {acct && acct.status !== 'OPEN' && <Badge tone="warn">{label(acct.status)}</Badge>}
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
          {!!deposit.data.ledger.length && (
            <table className="table compact">
              <tbody>
                {deposit.data.ledger.slice(0, LEDGER_ROWS).map((e) => (
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

      {dialog === 'adjust' && <AdjustmentDialog orgId={orgId} memberId={memberId} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'settle' && (
        <ConfirmWithReason
          title={`${lt.startSettlement}?`}
          body=""
          confirmLabel={lt.startSettlement}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await command('deposits-startSettlement', { orgId, memberId });
            onChanged();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'refund' && <RefundDialog orgId={orgId} memberId={memberId} balance={acct?.balanceMinor ?? 0} onClose={() => setDialog(null)} onDone={onChanged} />}
    </section>
  );
}

/** Books the member has now, with "declare lost". */
export function CurrentLoans({ orgId, memberId, scope, reloadKey, onChanged }: { orgId: string; memberId: string; scope: Scope; reloadKey: number; onChanged: () => void }) {
  const { claims } = useAuth();
  const loans = useAsync(() => memberLoans(orgId, memberId, scope, true), [orgId, memberId, JSON.stringify(scope)]);
  useReloadOn(reloadKey, loans.reload);
  const [lost, setLost] = useState<Loan | null>(null);
  const active = (loans.data ?? []).filter((l) => l.status === 'ACTIVE');
  return (
    <section className="section">
      <h2>{lt.currentBooks}</h2>
      {loans.loading ? (
        <SkeletonRows rows={2} />
      ) : loans.error && !loans.data ? (
        <ErrorState message={loans.error} onRetry={loans.reload} />
      ) : !active.length ? (
        <p className="muted">{lt.noCurrentBooks}</p>
      ) : (
        <TableWrap>
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
              {active.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={paths.adminBook(l.bookId)}>{l.bookTitle}</Link>
                  </td>
                  <td className="mono">{l.copyCode}</td>
                  <td>
                    {since(l.issuedAt)} <span className="muted small">(since {day(l.issuedAt)})</span>
                  </td>
                  <td className="cell-actions">
                    {can(claims, 'copies.writeOff', orgId, l.branchId) && (
                      <button type="button" className="btn btn-text" onClick={() => setLost(l)}>
                        {lt.declareLost}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {lost && (
        <ConfirmWithReason
          title={lt.declareLostTitle(lost.bookTitle)}
          body={lt.declareLostBody}
          confirmLabel={lt.declareLost}
          onClose={() => setLost(null)}
          onConfirm={async (reason) => {
            await command('circulation-declareLost', { orgId, loanId: lost.id, reason });
            onChanged();
            setLost(null);
          }}
        />
      )}
    </section>
  );
}

/** Books the member returned (history tab). */
export function PastLoans({ orgId, memberId, scope, reloadKey }: { orgId: string; memberId: string; scope: Scope; reloadKey: number }) {
  const loans = useAsync(() => memberLoans(orgId, memberId, scope, false), [orgId, memberId, JSON.stringify(scope)]);
  useReloadOn(reloadKey, loans.reload);
  if (loans.loading) return <SkeletonRows rows={2} />;
  if (loans.error && !loans.data) return <ErrorState message={loans.error} onRetry={loans.reload} />;
  return <LoanHistory loans={(loans.data ?? []).filter((l) => l.status !== 'ACTIVE')} />;
}

/** Waiting and held reservations, with "place reservation". */
export function MemberReservations({
  orgId,
  memberId,
  branchId,
  scope,
  canPlace,
  reloadKey,
  onChanged,
  onNotice,
}: {
  orgId: string;
  memberId: string;
  branchId: string;
  scope: Scope;
  canPlace: boolean;
  reloadKey: number;
  onChanged: () => void;
  onNotice: (text: string) => void;
}) {
  const reservations = useAsync(() => memberReservations(orgId, memberId, scope), [orgId, memberId, JSON.stringify(scope)]);
  useReloadOn(reloadKey, reservations.reload);
  const [placing, setPlacing] = useState(false);
  const open = (reservations.data ?? []).filter((r) => r.status === 'WAITING' || r.status === 'ALLOCATED');
  return (
    <section className="section">
      <div className="page-header-row">
        <h2>{lt.reservations}</h2>
        {canPlace && (
          <button type="button" className="btn btn-outlined" onClick={() => setPlacing(true)}>
            {lt.placeReservation}
          </button>
        )}
      </div>
      {reservations.loading ? (
        <SkeletonRows rows={1} />
      ) : reservations.error && !reservations.data ? (
        <ErrorState message={reservations.error} onRetry={reservations.reload} />
      ) : !open.length ? (
        <p className="muted">{lt.noReservations}</p>
      ) : (
        <ul className="plain-list">
          {open.map((r) => (
            <li key={r.id}>
              <span>{r.bookTitle}</span>
              <span className="muted small">{r.status === 'ALLOCATED' ? `${r.allocatedCopyCode} · ${lt.holdUntil(when(r.holdUntil))}` : lt.waitingQueue}</span>
            </li>
          ))}
        </ul>
      )}
      {placing && (
        <ReserveDialog
          orgId={orgId}
          memberId={memberId}
          branchId={branchId}
          onClose={() => setPlacing(false)}
          onDone={(msg) => {
            onNotice(msg);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
