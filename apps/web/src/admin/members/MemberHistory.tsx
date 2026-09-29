import { memberAudit, type AuditEntry } from '../../data/org';
import { memberPayments, type Subscription } from '../../data/billing';
import { type Loan } from '../../data/circulation';
import { label, planWithOption } from '../../data/common';
import { useAsync } from '../../shared/useAsync';
import { day, money, when } from '../../shared/format';
import { t } from '../../strings';
import { ErrorState, SkeletonRows, StatusBadge } from '../../shared/ui';
import { lt } from '../../strings/library';

type Scope = string[] | 'ALL';

/** Every subscription the member has had, newest first. */
export function SubscriptionHistory({ subs, loading, error, onRetry }: { subs: Subscription[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <SkeletonRows rows={2} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!subs.length) return <p className="muted">{lt.noSubscriptions}</p>;
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th scope="col">{lt.plan}</th>
            <th scope="col">{lt.period}</th>
            <th scope="col">{lt.amountCol}</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {subs.map((s) => (
            <tr key={s.id}>
              <td>
                {planWithOption(s.planSnapshot)}
                <div className="muted small">{s.kind === 'RENEWAL' ? lt.renewal : lt.newSubscription}</div>
              </td>
              <td className="nowrap">{s.startAt ? `${day(s.startAt)} → ${day(s.endAt)}` : '—'}</td>
              <td className="nowrap">{money(s.amountDue.totalMinor)}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Money received from or paid back to the member. */
export function PaymentHistory({ orgId, memberId, scope, reloadKey }: { orgId: string; memberId: string; scope: Scope; reloadKey: number }) {
  const payments = useAsync(() => memberPayments(orgId, memberId, scope), [orgId, memberId, JSON.stringify(scope), reloadKey]);
  if (payments.loading) return <SkeletonRows rows={2} />;
  if (payments.error) return <ErrorState message={payments.error} onRetry={payments.reload} />;
  if (!payments.data?.length) return <p className="muted">{lt.noPayments}</p>;
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th scope="col">{lt.date}</th>
            <th scope="col">{lt.paidFor}</th>
            <th scope="col">{lt.method}</th>
            <th scope="col">{lt.amountCol}</th>
          </tr>
        </thead>
        <tbody>
          {payments.data.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{when(p.at)}</td>
              <td>
                {p.lines.map((l) => label(l.type)).join(' + ')}
                {p.reference && <div className="muted small mono">{p.reference}</div>}
              </td>
              <td>{label(p.method.replace(/^OFFLINE_/, ''))}</td>
              <td className="nowrap">{p.direction === 'OUT' ? `− ${money(p.amountMinor)}` : money(p.amountMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Past loans (returned or lost). */
export function LoanHistory({ loans }: { loans: Loan[] }) {
  if (!loans.length) return <p className="muted">{lt.noLoanHistory}</p>;
  return (
    <ul className="plain-list">
      {loans.map((l) => (
        <li key={l.id}>
          <span>
            {l.bookTitle} <span className="mono small muted">{l.copyCode}</span>
          </span>
          <span className="muted small">
            {day(l.issuedAt)} → {l.status === 'LOST' ? label('LOST') : day(l.returnedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '');
const get = (v: unknown, k: string) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined);

/** One line describing an audit entry in plain words. */
export function describe(e: AuditEntry): string {
  const a = e.after;
  switch (e.action) {
    case 'member.register':
      return lt.actRegistered;
    case 'member.update':
      return lt.actUpdated;
    case 'member.setStatus':
      return lt.actStatus(label(String(get(a, 'status') ?? '')));
    case 'subscription.create':
      return lt.actSubscribed(money(Number(get(get(a, 'amountDue'), 'totalMinor') ?? 0)));
    case 'subscription.cancel':
      return lt.actSubCancelled;
    case 'subscription.expire':
      return lt.actSubExpired;
    case 'payment.requestOnline':
      return lt.actOnlineRequested(String(get(a, 'channel') ?? '') === 'LINK' ? lt.olLink.toLowerCase() : lt.olQr.toLowerCase());
    case 'payment.requestCancelled':
      return lt.actOnlineCancelled;
    case 'payment.onlineUnapplied':
      return lt.actOnlineUnapplied(money(Number(get(a, 'amountMinor') ?? 0)));
    case 'payment.online':
    case 'payment.recordOffline':
      return lt.actPaid(money(Number(get(a, 'amountMinor') ?? 0)), label(String(get(a, 'method') ?? '').replace(/^OFFLINE_/, '')), day(get(a, 'endAt') ? new Date(String(get(a, 'endAt'))) : null));
    case 'circulation.issue':
      return lt.actIssued(list(get(a, 'titles')) || list(get(a, 'copies')));
    case 'circulation.return':
      return lt.actReturned(list(get(a, 'titles')) || list(get(a, 'copies')));
    case 'circulation.exchange':
      return lt.actExchanged(list(get(a, 'returned')), list(get(a, 'issued')));
    case 'loan.declareLost':
      return lt.actLost;
    case 'reservation.place':
      return lt.actReserved;
    case 'reservation.cancel':
      return lt.actReservationCancelled;
    case 'reservation.expire':
      return lt.actReservationExpired;
    case 'deposit.propose':
      return lt.actDepositProposed(money(Math.abs(Number(get(a, 'deltaMinor') ?? 0))));
    case 'deposit.approve':
      return lt.actDepositApproved;
    case 'deposit.reject':
      return lt.actDepositRejected;
    case 'deposit.startSettlement':
      return lt.actSettlement;
    case 'deposit.refund':
      return lt.actRefunded;
    default: {
      const words = e.action.replace(/\./g, ' ');
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  }
}

/** The member's audit trail: who did what, when, with the recorded details. */
export function MemberAudit({ orgId, memberId, scope, branchName, reloadKey }: { orgId: string; memberId: string; scope: Scope; branchName: (id: string) => string; reloadKey: number }) {
  const trail = useAsync(() => memberAudit(orgId, memberId, scope), [orgId, memberId, JSON.stringify(scope), reloadKey]);
  if (trail.loading) return <SkeletonRows rows={3} />;
  if (trail.error) return <ErrorState message={trail.error} onRetry={trail.reload} />;
  if (!trail.data?.length) return <p className="muted">{lt.noActivity}</p>;
  return (
    <ol className="timeline">
      {trail.data.map((e) => (
        <li key={e.id}>
          <div>
            <strong>{describe(e)}</strong>
            {e.reason && <span className="muted"> · {e.reason}</span>}
          </div>
          <div className="muted small">
            {when(e.at)} · {e.actorEmail ?? t.auditSystem}
            {e.branchId && ` · ${branchName(e.branchId)}`}
          </div>
          {(e.before != null || e.after != null) && (
            <details>
              <summary className="small">{t.auditDetails}</summary>
              {e.before != null && <pre>{JSON.stringify(e.before, null, 2)}</pre>}
              {e.after != null && <pre>{JSON.stringify(e.after, null, 2)}</pre>}
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
