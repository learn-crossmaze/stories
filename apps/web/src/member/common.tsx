import { type ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { label } from '../data/common';
import { currentTerm, type Membership } from '../data/me';
import { day, relativeDays } from '../shared/format';
import { t } from '../strings';
import { EmptyState, ErrorState, SkeletonRows } from '../shared/ui';
import { JoinMembership } from './JoinMembership';
import { useMemberData } from './memberData';

// Building blocks shared by the member pages: the page frame, the member switcher,
// the plan badge and the loan list. Data comes from MemberDataProvider (me-overview).
export const days = (iso: string | null) => (iso ? Math.round((Date.parse(iso) - Date.now()) / 86_400_000) : null);

export function Page({ title, children, lead }: { title: string; children: ReactNode; lead?: ReactNode }) {
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
        {lead}
      </header>
      {children}
    </>
  );
}

/** Shows the page body once memberships are loaded; explains what to do when none is linked. */
export function WithMembership({ children }: { children: (m: Membership) => ReactNode }) {
  const { overview, current } = useMemberData();
  const { user } = useAuth();
  if (overview.loading && !overview.data) return <SkeletonRows rows={4} />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  if (!current) {
    const email = overview.data?.email ?? user?.email ?? '';
    // Signed in with a verified email but not a member yet: join a branch here.
    if (overview.data?.emailVerified) return <JoinMembership />;
    return (
      <EmptyState
        icon="card"
        title={t.noMembershipTitle}
        message={overview.data && !overview.data.emailVerified ? t.meVerifyEmail(email) : t.meNotLinked(email)}
      />
    );
  }
  return (
    <>
      <MemberSwitcher />
      {children(current)}
    </>
  );
}

/** A guardian switches between their own membership and their children's. */
export function MemberSwitcher() {
  const { overview, current, select } = useMemberData();
  const list = overview.data?.memberships ?? [];
  if (list.length < 2 || !current) return null;
  return (
    <div className="member-switch" role="group" aria-label={t.meViewing}>
      {list.map((m) => (
        <button key={m.memberId} type="button" className="chip" aria-pressed={m.memberId === current.memberId} onClick={() => select(m.memberId)}>
          {m.member.fullName.split(' ')[0]}
          {!m.self && <span className="muted small"> · {m.member.guardian?.relationship ? t.meChild : t.meFamily}</span>}
        </button>
      ))}
    </div>
  );
}

export function PlanBadge({ m }: { m: Membership }) {
  const term = currentTerm(m);
  const left = days(m.member.renewalDueAt);
  if (!term) return <span className="badge badge-muted">{t.meNoPlan}</span>;
  if (left !== null && left <= 15) return <span className="badge badge-warn">{t.meRenewSoon(relativeDays(m.member.renewalDueAt))}</span>;
  return <span className="badge badge-ok">{t.meActive}</span>;
}

export function LoanList({ loans }: { loans: Membership['loans'] }) {
  return (
    <ul className="plain-list">
      {loans.map((l) => (
        <li key={l.id}>
          <span>
            <strong>{l.bookTitle}</strong> <span className="muted small mono">{l.copyCode}</span>
          </span>
          <span className="muted small">
            {l.status === 'ACTIVE' ? t.meSince(day(l.issuedAt)) : l.status === 'RETURNED' ? t.meReturned(day(l.issuedAt), day(l.returnedAt)) : label(l.status)}
          </span>
        </li>
      ))}
    </ul>
  );
}
