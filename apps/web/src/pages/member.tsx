import type { DocumentSnapshot } from 'firebase/firestore';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { AppearanceSettings } from '../AppearanceSettings';
import { useAuth } from '../auth/AuthContext';
import { isStaff } from '../auth/claims';
import { BookCover } from '../BookCover';
import { type IdCardInfo, IdCardPanel } from '../IdCard';
import { callAction, toApiError } from '../data/api';
import { type Book, label, searchBooks } from '../data/library';
import {
  cancelMyReservation,
  cancelUnpaid,
  checkOnlinePayment,
  currentTerm,
  type Membership,
  type MyPlan,
  pendingSubscription,
  reserveBook,
  startOnlinePayment,
  subscribeToPlan,
} from '../data/me';
import { services } from '../data/services';
import { useDebounced } from '../data/useDebounced';
import { day, money, relativeDays, when } from '../format';
import { paths } from '../paths';
import { t } from '../strings';
import { EmptyState, ErrorState, Icon, SkeletonRows } from '../ui';
import { useMemberData } from './memberData';

// Member pages: everything about the signed-in person's memberships (and their
// children's), loaded once by MemberDataProvider from me-overview.

const METHOD_LABELS: Record<string, string> = {
  OFFLINE_CASH: 'Cash at the branch',
  OFFLINE_UPI: 'UPI at the branch',
  OFFLINE_CARD: 'Card at the branch',
  OFFLINE_BANK_TRANSFER: 'Bank transfer',
  ONLINE_LINK: 'Online (payment link)',
  ONLINE_UPI_QR: 'Online (UPI QR)',
};

const days = (iso: string | null) => (iso ? Math.round((Date.parse(iso) - Date.now()) / 86_400_000) : null);

function Page({ title, children, lead }: { title: string; children: ReactNode; lead?: ReactNode }) {
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
function WithMembership({ children }: { children: (m: Membership) => ReactNode }) {
  const { overview, current } = useMemberData();
  const { user } = useAuth();
  if (overview.loading && !overview.data) return <SkeletonRows rows={4} />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  if (!current) {
    const email = overview.data?.email ?? user?.email ?? '';
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
function MemberSwitcher() {
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

function PlanBadge({ m }: { m: Membership }) {
  const term = currentTerm(m);
  const left = days(m.member.renewalDueAt);
  if (!term) return <span className="badge badge-muted">{t.meNoPlan}</span>;
  if (left !== null && left <= 15) return <span className="badge badge-warn">{t.meRenewSoon(relativeDays(m.member.renewalDueAt))}</span>;
  return <span className="badge badge-ok">{t.meActive}</span>;
}

// ------------------------------------------------------------------ Home

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

function LoanList({ loans }: { loans: Membership['loans'] }) {
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

// ------------------------------------------------------------------ Explore

interface Availability {
  branches: { branchId: string; branchName: string; available: number; total: number }[];
}

export function ExplorePage() {
  return (
    <Page title={t.navExplore}>
      <WithMembership>{(m) => <ExploreBody m={m} />}</WithMembership>
    </Page>
  );
}

function ExploreBody({ m }: { m: Membership }) {
  const { overview } = useMemberData();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [books, setBooks] = useState<Book[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | undefined>();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [open, setOpen] = useState<string | null>(null);
  const load = async (after?: DocumentSnapshot) => {
    setState({ loading: true, error: null });
    try {
      const page = await searchBooks(debounced, m.member.audience === 'ADULTS' ? '' : m.member.audience, after, 'ACTIVE');
      setBooks((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setState({ loading: false, error: null });
    } catch (e) {
      console.error(e);
      setState({ loading: false, error: t.errorLoad });
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, m.member.audience]);
  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.meSearchBooks} aria-label={t.meSearchBooks} />
      </div>
      {m.member.audience !== 'ADULTS' && <p className="muted small">{t.meShowingFor(label(m.member.audience))}</p>}
      {state.error && !books.length ? (
        <ErrorState message={state.error} onRetry={() => void load()} />
      ) : state.loading && !books.length ? (
        <SkeletonRows rows={5} />
      ) : !books.length ? (
        <EmptyState icon="book" title={t.meNoBooksFound} message="" />
      ) : (
        <>
          <ul className="book-list">
            {books.map((b) => (
              <li key={b.id}>
                <button type="button" className="book-row book-row-button" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <BookCover title={b.title} seed={b.id} url={b.coverUrl} size="sm" />
                  <span className="book-main">
                    <span className="book-title">{b.title}</span>
                    <span className="muted small">{b.authorNames.join(', ')}</span>
                  </span>
                  <span className="book-meta small">{b.genres.map(label).join(', ')}</span>
                </button>
                {open === b.id && <BookPanel m={m} book={b} onReserved={overview.reload} />}
              </li>
            ))}
          </ul>
          {cursor && (
            <button type="button" className="btn btn-outlined load-more" disabled={state.loading} onClick={() => void load(cursor)}>
              {state.loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Synopsis, where copies are and a Reserve button (at the home branch or one that has it). */
function BookPanel({ m, book, onReserved }: { m: Membership; book: Book; onReserved: () => void }) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    callAction<Availability>(services().fns, 'copies-availability', { orgId: m.orgId, bookId: book.id })
      .then(setAvail)
      .catch(() => setAvail({ branches: [] }));
  }, [m.orgId, book.id]);
  const already = m.reservations.some((r) => r.bookId === book.id && (r.status === 'WAITING' || r.status === 'ALLOCATED'));
  const branches = avail ? [...avail.branches].sort((a, b) => Number(b.branchId === m.branch.id) - Number(a.branchId === m.branch.id)) : [];
  if (avail && !branches.some((b) => b.branchId === m.branch.id)) branches.unshift({ branchId: m.branch.id, branchName: m.branch.name, available: 0, total: 0 });
  const reserve = async (branchId: string) => {
    setBusy(branchId);
    setMsg(null);
    try {
      const r = await reserveBook(m, book.id, branchId);
      setMsg({ tone: 'ok', text: r.status === 'ALLOCATED' ? t.meReservedHeld : t.meReservedWaiting });
      onReserved();
    } catch (e) {
      setMsg({ tone: 'error', text: toApiError(e).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="book-panel">
      {book.synopsis && <p className="synopsis">{book.synopsis}</p>}
      {!avail ? (
        <SkeletonRows rows={1} />
      ) : (
        <ul className="plain-list">
          {branches.map((b) => (
            <li key={b.branchId}>
              <span>
                <strong>{b.branchName}</strong>{' '}
                <span className={b.available ? 'ok small' : 'muted small'}>{b.total ? t.meOnShelf(b.available, b.total) : t.meNotStocked}</span>
              </span>
              {already ? (
                <span className="muted small">{t.meAlreadyReserved}</span>
              ) : (
                <button type="button" className="btn btn-outlined" disabled={busy !== null || m.member.status !== 'ACTIVE'} onClick={() => void reserve(b.branchId)}>
                  {busy === b.branchId ? t.saving : b.available ? t.meReserveHere : t.meJoinQueue}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p className={msg.tone === 'ok' ? 'form-notice' : 'form-error'} role={msg.tone === 'ok' ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ My books

export function MyBooksPage() {
  return (
    <Page title={t.navMyBooks}>
      <WithMembership>{(m) => <MyBooksBody m={m} />}</WithMembership>
    </Page>
  );
}

function MyBooksBody({ m }: { m: Membership }) {
  const { overview } = useMemberData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const borrowed = m.loans.filter((l) => l.status === 'ACTIVE');
  const past = m.loans.filter((l) => l.status !== 'ACTIVE');
  const open = m.reservations.filter((r) => r.status === 'WAITING' || r.status === 'ALLOCATED');
  const closed = m.reservations.filter((r) => r.status !== 'WAITING' && r.status !== 'ALLOCATED');
  const cancel = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await cancelMyReservation(m, id);
      overview.reload();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <section className="section">
        <h2>{t.meBorrowedNow}</h2>
        {borrowed.length ? <LoanList loans={borrowed} /> : <p className="muted">{t.meNothingBorrowed}</p>}
      </section>
      <section className="section">
        <h2>{t.meReservations}</h2>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!open.length ? (
          <p className="muted">
            {t.meNoReservations} <Link to={paths.explore}>{t.meFindBooks}</Link>
          </p>
        ) : (
          <ul className="plain-list">
            {open.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.bookTitle}</strong>
                  <br />
                  <span className={r.status === 'ALLOCATED' ? 'ok small' : 'muted small'}>
                    {r.status === 'ALLOCATED' ? t.meHeldUntil(r.holdUntil ? when(r.holdUntil) : '') : t.meWaitingSince(day(r.queuedAt))}
                  </span>
                </span>
                <button type="button" className="btn btn-text" disabled={busy !== null} onClick={() => void cancel(r.id)}>
                  {busy === r.id ? t.saving : t.cancel}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="section">
        <h2>{t.meHistory}</h2>
        {!past.length && !closed.length ? (
          <p className="muted">{t.meNoHistory}</p>
        ) : (
          <>
            {!!past.length && <LoanList loans={past} />}
            {!!closed.length && (
              <ul className="plain-list">
                {closed.map((r) => (
                  <li key={r.id}>
                    <span>{r.bookTitle}</span>
                    <span className="muted small">{t.meReservationClosed(label(r.status === 'FULFILLED' ? 'COLLECTED' : r.status), day(r.queuedAt))}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ Membership & payments

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
    act('pay', async () => {
      const r = await startOnlinePayment(m, subscriptionId);
      if (r.url) window.open(r.url, '_blank', 'noopener');
    }, t.mePayOpened);
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
    const onFocus = () => void checkOnlinePayment(m, pending.id).then((r) => r.paid && overview.reload(), () => undefined);
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
              {term ? t.meTerm(day(term.startAt), day(term.endAt)) : m.member.renewalDueAt ? t.meEndedOn + ' ' + day(m.member.renewalDueAt) : t.meNeverSubscribed}
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
                <PlanCard key={p.id} plan={p} busy={busy === p.id} disabled={busy !== null || m.member.status !== 'ACTIVE'} onChoose={() => void act(p.id, () => subscribeToPlan(m, p.id))} />
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

// ------------------------------------------------------------------ Profile

const cardInfo = (m: Membership): IdCardInfo => ({
  orgName: m.orgName,
  branchName: m.branch.name,
  branchPhone: m.branch.phone || null,
  fullName: m.member.fullName,
  code: m.member.code,
  validUntil: currentTerm(m) ? m.member.renewalDueAt : null,
  guardianName: m.member.guardian?.name ?? null,
});

export function ProfilePage() {
  const { user, repo, claims } = useAuth();
  const { current } = useMemberData();
  const { hash } = useLocation();
  // "Show my ID card" links here with #id-card: scroll to it once the membership has loaded.
  useEffect(() => {
    if (hash === '#id-card' && current) document.getElementById('id-card')?.scrollIntoView({ block: 'start' });
  }, [hash, current]);
  return (
    <>
      <header className="page-header">
        <h1>{t.navProfile}</h1>
      </header>
      <section className="profile">
        {user?.displayName && <h2>{user.displayName}</h2>}
        {user?.email && <p className="muted">{t.profileSignedInAs(user.email)}</p>}
        {isStaff(claims) && (
          <Link to={paths.admin} className="btn btn-filled">
            {t.staffConsole}
          </Link>
        )}
        <button type="button" className="btn btn-outlined" onClick={() => repo.signOut()}>
          {t.signOut}
        </button>
      </section>
      {current && (
        <section className="section" id="id-card">
          <MemberSwitcher />
          <h2>{t.idCardTitle}</h2>
          <p className="muted">{t.idCardIntro}</p>
          <IdCardPanel info={cardInfo(current)} />
        </section>
      )}
      {current && (
        <section className="section">
          <h2>{t.meMembershipDetails}</h2>
          <dl className="facts">
            <dt>{t.meName}</dt>
            <dd>{current.member.fullName}</dd>
            <dt>{t.meMemberCode}</dt>
            <dd className="mono">{current.member.code}</dd>
            <dt>{t.meDob}</dt>
            <dd>{day(new Date(current.member.dob))}</dd>
            <dt>{t.meMobile}</dt>
            <dd>{current.member.phone ?? '—'}</dd>
            <dt>{t.meEmail}</dt>
            <dd>{current.member.email ?? '—'}</dd>
            {current.member.guardian && (
              <>
                <dt>{t.meGuardian}</dt>
                <dd>
                  {current.member.guardian.name} ({current.member.guardian.relationship})
                </dd>
              </>
            )}
            <dt>{t.meLibrary}</dt>
            <dd>
              {current.orgName} · {current.branch.name}
              {current.branch.phone && <div className="muted small">{current.branch.phone}</div>}
              {current.branch.address && (
                <div className="muted small">
                  {[current.branch.address.line1, current.branch.address.city, current.branch.address.postalCode].filter(Boolean).join(', ')}
                </div>
              )}
            </dd>
            <dt>{t.meBorrowedSoFar}</dt>
            <dd>{t.meLifetime(current.member.lifetimeLoans, current.member.lifetimeExchanges)}</dd>
          </dl>
          <p className="muted small">{t.meChangeDetails}</p>
        </section>
      )}
      <section className="section">
        <h2>{t.navAppearance}</h2>
        <p className="muted">{t.apIntro}</p>
        <AppearanceSettings />
      </section>
    </>
  );
}
