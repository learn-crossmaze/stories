import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { command } from '../../data/api';
import { depositAccount, ledger, memberAdjustments, memberSubscriptions } from '../../data/billing';
import { type Loan, memberLoans, memberReservations } from '../../data/circulation';
import { label, planWithOption, toDate } from '../../data/common';
import { getMember, wardsOf } from '../../data/members';
import { useAsync } from '../../shared/useAsync';
import { day, money, since, when } from '../../shared/format';
import { paths } from '../../paths';
import { t } from '../../strings';
import { EmptyState, ErrorState, SkeletonRows, StatusBadge, TableWrap } from '../../shared/ui';
import { ConfirmWithReason, Dialog } from '../components/Dialog';
import { Notice, Tabs } from '../components/kit';
import { lt } from '../../strings/library';
import { IdCardPanel } from '../../shared/IdCard';
import { useWorkspace } from '../Workspace';
import { CollectOnlineDialog } from './OnlinePayments';
import { MemberDialog } from './Members';
import { LoanHistory, MemberAudit, PaymentHistory, SubscriptionHistory } from './MemberHistory';
import { AdjustmentDialog, PaymentDialog, RefundDialog, ReserveDialog, SubscribeDialog } from './memberDialogs';

type DialogKind =
  | 'idCard'
  | 'edit'
  | 'subscribe'
  | 'renew'
  | 'pay'
  | 'online'
  | 'cancelPending'
  | 'adjust'
  | 'settle'
  | 'refund'
  | 'reserve'
  | 'suspend'
  | 'reactivate'
  | 'close';

export function MemberDetailPage() {
  const { memberId = '' } = useParams();
  const { claims } = useAuth();
  const { org, branchName, branches } = useWorkspace();
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
  if (!m) return <EmptyState page icon="person" title={t.notFoundTitle} message="" />;

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
          {m.status !== 'CLOSED' && (
            <button type="button" className="btn btn-outlined" onClick={() => setDialog('idCard')}>
              {t.idCardTitle}
            </button>
          )}
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
                  <div className="row">
                    {perm('payments.recordOffline') && (
                      <button type="button" className="btn btn-filled" onClick={() => setDialog('pay')}>
                        {lt.recordPayment}
                      </button>
                    )}
                    {perm('payments.recordOffline') && branches.find((x) => x.id === b)?.payments?.razorpay?.enabled && (
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
                  deposit.error ? (
                    <ErrorState message={deposit.error} onRetry={deposit.reload} />
                  ) : (
                    <SkeletonRows rows={2} />
                  )
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
                    {activeLoans.map((l) => (
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
                            <button type="button" className="btn btn-text" onClick={() => setLostLoan(l)}>
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

      {dialog === 'idCard' && (
        <Dialog title={t.idCardTitle} onClose={() => setDialog(null)} narrow>
          <IdCardPanel
            info={{
              orgName: org?.name ?? '',
              branchName: branchName(m.homeBranchId),
              branchPhone: branches.find((x) => x.id === m.homeBranchId)?.contact.phone ?? null,
              fullName: m.fullName,
              code: m.code,
              validUntil: current ? (toDate(current.endAt)?.toISOString() ?? null) : null,
              guardianName: m.guardian?.name ?? null,
            }}
          />
        </Dialog>
      )}
      {dialog === 'edit' && <MemberDialog orgId={orgId} branchId={b} member={m} onClose={() => setDialog(null)} onSaved={() => member.reload()} />}
      {(dialog === 'subscribe' || dialog === 'renew') && (
        <SubscribeDialog orgId={orgId} member={m} renewing={dialog === 'renew'} onClose={() => setDialog(null)} onCreated={refresh} />
      )}
      {dialog === 'online' && pending && (
        <CollectOnlineDialog
          orgId={orgId}
          subscriptionId={pending.id}
          amountMinor={pending.amountDue.totalMinor}
          member={{ phone: m.phone, email: m.email ?? null }}
          onClose={() => {
            setDialog(null);
            refresh();
          }}
          onPaid={() => setNotice(lt.paymentRecorded)}
        />
      )}
      {dialog === 'pay' && pending && (
        <PaymentDialog
          orgId={orgId}
          sub={pending}
          onClose={() => setDialog(null)}
          onDone={() => {
            setNotice(lt.paymentRecorded);
            refresh();
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
            refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'adjust' && <AdjustmentDialog orgId={orgId} memberId={m.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'settle' && (
        <ConfirmWithReason
          title={`${lt.startSettlement}?`}
          body=""
          confirmLabel={lt.startSettlement}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await command('deposits-startSettlement', { orgId, memberId: m.id });
            refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'refund' && <RefundDialog orgId={orgId} memberId={m.id} balance={acct?.balanceMinor ?? 0} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'reserve' && (
        <ReserveDialog
          orgId={orgId}
          memberId={m.id}
          branchId={b}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setNotice(msg);
            refresh();
          }}
        />
      )}
      {(dialog === 'suspend' || dialog === 'reactivate' || dialog === 'close') && (
        <ConfirmWithReason
          title={lt.statusTitle(dialog === 'suspend' ? lt.suspend : dialog === 'reactivate' ? lt.reactivate : lt.closeMembership)}
          body=""
          confirmLabel={dialog === 'suspend' ? lt.suspend : dialog === 'reactivate' ? lt.reactivate : lt.closeMembership}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await command('members-setStatus', {
              orgId,
              memberId: m.id,
              status: dialog === 'suspend' ? 'SUSPENDED' : dialog === 'reactivate' ? 'ACTIVE' : 'CLOSED',
              reason,
            });
            member.reload();
            setDialog(null);
          }}
        />
      )}
      {lostLoan && (
        <ConfirmWithReason
          title={lt.declareLostTitle(lostLoan.bookTitle)}
          body={lt.declareLostBody}
          confirmLabel={lt.declareLost}
          onClose={() => setLostLoan(null)}
          onConfirm={async (reason) => {
            await command('circulation-declareLost', { orgId, loanId: lostLoan.id, reason });
            refresh();
            setLostLoan(null);
          }}
        />
      )}
    </>
  );
}
