import { useState } from 'react';
import { Link } from 'react-router';

import { toApiError } from '../data/api';
import { label } from '../data/common';
import { cancelMyReservation, type Membership } from '../data/me';
import { day, when } from '../shared/format';
import { paths } from '../paths';
import { t } from '../strings';
import { useMemberData } from './memberData';
import { Page, WithMembership, LoanList } from './common';

// Books on loan, reservations and reading history.
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
