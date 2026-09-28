import { Link } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { currentTerm, type Membership, pendingSubscription } from '../data/me';
import { day, money, relativeDays, when } from '../shared/format';
import { paths } from '../paths';
import { t } from '../strings';
import { Icon } from '../shared/ui';
import { days, Page, WithMembership, PlanBadge, LoanList } from './common';

// Member home: current plan, books at home, reservations.
export function HomePage() {
  const { user } = useAuth();
  const name = user?.displayName?.split(' ')[0];
  return (
    <Page title={name ? t.greeting(name) : t.greetingFallback} lead={<p className="tagline">{t.tagline}</p>}>
      <WithMembership>{(m) => <HomeBody m={m} />}</WithMembership>
    </Page>
  );
}

function HomeBody({ m }: { m: Membership }) {
  const term = currentTerm(m);
  const pending = pendingSubscription(m);
  const held = m.reservations.filter((r) => r.status === 'ALLOCATED');
  const borrowed = m.loans.filter((l) => l.status === 'ACTIVE');
  const left = days(m.member.renewalDueAt);
  const max = term?.planSnapshot.maxSimultaneousBooks ?? 0;
  return (
    <>
      <section className="card member-card">
        <div className="member-card-head">
          <div>
            <h2>{m.member.fullName}</h2>
            <p className="muted">
              <span className="mono">{m.member.code}</span> · {m.branch.name}
            </p>
          </div>
          <PlanBadge m={m} />
        </div>
        <dl className="facts">
          <dt>{t.mePlan}</dt>
          <dd>{term?.planSnapshot.name ?? m.member.planName ?? '—'}</dd>
          <dt>{term ? t.meRenewsOn : t.meEndedOn}</dt>
          <dd>{m.member.renewalDueAt ? `${day(m.member.renewalDueAt)} (${relativeDays(m.member.renewalDueAt)})` : '—'}</dd>
          <dt>{t.meBooksOut}</dt>
          <dd>{term ? t.meBooksOfMax(borrowed.length + m.member.allocatedCount, max) : borrowed.length}</dd>
          <dt>{t.meDeposit}</dt>
          <dd>{m.deposit ? money(m.deposit.balanceMinor) : '—'}</dd>
        </dl>
      </section>

      <ul className="todo-list">
        {pending && (
          <li>
            <Link to={paths.membership}>
              <Icon name="card" />
              <span>{t.mePaymentDue(pending.planSnapshot.name, money(pending.amountDue.totalMinor))}</span>
            </Link>
          </li>
        )}
        {held.map((r) => (
          <li key={r.id}>
            <Link to={paths.myBooks}>
              <Icon name="bookmark" />
              <span>{t.meReadyToCollect(r.bookTitle, r.holdUntil ? when(r.holdUntil) : '')}</span>
            </Link>
          </li>
        ))}
        {!pending && (!term || (left !== null && left <= 15)) && (
          <li>
            <Link to={paths.membership}>
              <Icon name="alert" />
              <span>{term ? t.meRenewPrompt : t.meSubscribePrompt}</span>
            </Link>
          </li>
        )}
      </ul>

      <section className="section">
        <h2>{t.meBorrowedNow}</h2>
        {borrowed.length ? <LoanList loans={borrowed} /> : <p className="muted">{t.meNothingBorrowed}</p>}
        <p className="row">
          <Link to={paths.explore}>{t.meFindBooks}</Link>
          <Link to={`${paths.profile}#id-card`}>{t.idCardShow}</Link>
        </p>
      </section>
    </>
  );
}
