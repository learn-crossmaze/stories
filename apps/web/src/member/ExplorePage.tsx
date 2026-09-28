import type { DocumentSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { BookCover } from '../shared/BookCover';
import { callAction, toApiError } from '../data/api';
import { type Book, searchBooks } from '../data/catalogue';
import { label } from '../data/common';
import { type Membership, reserveBook } from '../data/me';
import { services } from '../data/services';
import { useDebounced } from '../shared/useDebounced';
import { t } from '../strings';
import { EmptyState, ErrorState, SkeletonRows } from '../shared/ui';
import { useMemberData } from './memberData';
import { Page, WithMembership } from './common';

// Browse the catalogue and reserve a title at the member's branch.
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
  if (avail && !branches.some((b) => b.branchId === m.branch.id))
    branches.unshift({ branchId: m.branch.id, branchName: m.branch.name, available: 0, total: 0 });
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
                <button
                  type="button"
                  className="btn btn-outlined"
                  disabled={busy !== null || m.member.status !== 'ACTIVE'}
                  onClick={() => void reserve(b.branchId)}
                >
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
