import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { BookCover } from '../shared/BookCover';
import { call } from '../data/api';
import { type Book, searchBooks } from '../data/catalogue';
import { label } from '../data/common';
import { type Membership, reserveBook } from '../data/me';
import { useAction } from '../shared/Dialog';
import { useAsync } from '../shared/useAsync';
import { useDebounced } from '../shared/useDebounced';
import { usePagedQuery } from '../shared/usePagedQuery';
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
  // The website's book quick-view links here with the title filled in (?q=).
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const debounced = useDebounced(q);
  const [open, setOpen] = useState<string | null>(null);
  const list = usePagedQuery<Book>((after) => searchBooks(debounced, m.member.audience === 'ADULTS' ? '' : m.member.audience, after, 'ACTIVE'), [debounced, m.member.audience]);
  const books = list.items;
  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.meSearchBooks} aria-label={t.meSearchBooks} />
      </div>
      {m.member.audience !== 'ADULTS' && <p className="muted small">{t.meShowingFor(label(m.member.audience))}</p>}
      {list.error && !books.length ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.loading && !books.length && !list.hasMore ? (
        <SkeletonRows rows={5} />
      ) : !books.length && list.hasMore ? (
        // A search of several words stops after a few pages: none matched so far, and there are more to read.
        <>
          <EmptyState icon="book" title={t.searchNoneYet} message={t.searchNoneYetHint} />
          <button type="button" className="btn btn-outlined load-more" disabled={list.loading} onClick={list.loadMore}>
            {list.loading ? t.loading : t.keepLooking}
          </button>
        </>
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
          {list.error && <p className="form-error" role="alert">{list.error}</p>}
          {list.hasMore && (
            <button type="button" className="btn btn-outlined load-more" disabled={list.loading} onClick={list.loadMore}>
              {list.loading ? t.loading : t.loadMore}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Synopsis, where copies are and a Reserve button (at the home branch or one that has it). */
function BookPanel({ m, book, onReserved }: { m: Membership; book: Book; onReserved: () => void }) {
  const avail = useAsync(() => call<Availability>('copies-availability', { orgId: m.orgId, bookId: book.id }), [m.orgId, book.id]);
  const action = useAction();
  const [reserved, setReserved] = useState<string | null>(null);
  const already = m.reservations.some((r) => r.bookId === book.id && (r.status === 'WAITING' || r.status === 'ALLOCATED'));
  const branches = avail.data ? [...avail.data.branches].sort((a, b) => Number(b.branchId === m.branch.id) - Number(a.branchId === m.branch.id)) : [];
  if (avail.data && !branches.some((b) => b.branchId === m.branch.id))
    branches.unshift({ branchId: m.branch.id, branchName: m.branch.name, available: 0, total: 0 });
  const reserve = (branchId: string) => {
    setReserved(null);
    return action.run(async () => {
      const r = await reserveBook(m, book.id, branchId);
      setReserved(r.status === 'ALLOCATED' ? t.meReservedHeld : t.meReservedWaiting);
      onReserved();
    }, branchId);
  };
  return (
    <div className="book-panel">
      {book.synopsis && <p className="synopsis">{book.synopsis}</p>}
      {avail.loading ? (
        <SkeletonRows rows={1} />
      ) : avail.error || !avail.data ? (
        // Unknown availability is not "not stocked": say so, and offer to try again.
        <p className="form-error" role="alert">
          {avail.error ?? t.errorLoad}{' '}
          <button type="button" className="btn btn-text" onClick={avail.reload}>
            {t.retry}
          </button>
        </p>
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
                  disabled={action.busy || m.member.status !== 'ACTIVE'}
                  onClick={() => void reserve(b.branchId)}
                >
                  {action.pending === b.branchId ? t.saving : b.available ? t.meReserveHere : t.meJoinQueue}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {reserved && (
        <p className="form-notice" role="status">
          {reserved}
        </p>
      )}
      {action.error && (
        <p className="form-error" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}
