import type { DocumentSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorText } from '../data/api';
import { t } from '../strings';
import { reportError } from './reportError';

export interface PageOf<T, C> {
  items: T[];
  /** Where the next page starts; none when this was the last page. */
  cursor?: C;
}

export interface PagedQuery<T> {
  items: T[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /** Appends the next page (ignored while a page is loading). */
  loadMore: () => void;
  /** Loads the first page again. */
  reload: () => void;
}

/**
 * A list read a page at a time, with "Load more". Only the latest request may
 * change the list: a slow answer for an earlier search, filter or branch (or a
 * "Load more" for the previous filters) is dropped when it arrives.
 *
 * `fetchPage` is called with the cursor of the page to load (undefined for the
 * first); the first page is loaded again whenever `deps` change. While it
 * loads, the previous results stay on screen unless `keepPrevious` is false.
 * Nothing is loaded while `enabled` is false.
 */
export function usePagedQuery<T, C = DocumentSnapshot>(
  fetchPage: (after: C | undefined) => Promise<PageOf<T, C>>,
  deps: unknown[],
  { enabled = true, keepPrevious = true }: { enabled?: boolean; keepPrevious?: boolean } = {},
): PagedQuery<T> {
  const [state, setState] = useState<{ items: T[]; cursor?: C; loading: boolean; error: string | null }>({ items: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  // Every request takes the next number; an answer counts only if no request started after it.
  const latest = useRef(0);
  const pending = useRef<number | null>(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const run = useCallback(
    async (after: C | undefined) => {
      const id = ++latest.current;
      pending.current = id;
      setState((s) => ({ ...s, ...(after === undefined && !keepPrevious && { items: [], cursor: undefined }), loading: true, error: null }));
      try {
        const page = await fetchRef.current(after);
        if (id !== latest.current) return;
        setState((s) => ({ items: after === undefined ? page.items : [...s.items, ...page.items], cursor: page.cursor, loading: false, error: null }));
      } catch (e) {
        if (id !== latest.current) return;
        reportError(e, 'load');
        setState((s) => ({ ...s, loading: false, error: errorText(e, t.errorLoad) }));
      } finally {
        if (pending.current === id) pending.current = null;
      }
    },
    [keepPrevious],
  );

  useEffect(() => {
    if (!enabled) return;
    void run(undefined);
    return () => {
      // New deps (or unmount): whatever is still loading is out of date.
      latest.current++;
      pending.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt, run, ...deps]);

  const cursor = state.cursor;
  const loadMore = useCallback(() => {
    if (pending.current !== null || cursor === undefined || cursor === null) return;
    void run(cursor);
  }, [cursor, run]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { items: state.items, hasMore: cursor !== undefined && cursor !== null, loading: state.loading, error: state.error, loadMore, reload };
}
