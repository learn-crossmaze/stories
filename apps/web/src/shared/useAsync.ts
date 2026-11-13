import { useCallback, useEffect, useRef, useState } from 'react';

import { errorText } from '../data/api';
import { t } from '../strings';
import { get, remove, set } from './asyncCache';
import { reportError } from './reportError';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  /** Nothing to show yet for the current inputs: the first read, or a read after they changed (or after a failure). */
  loading: boolean;
  /** reload() is reading again while the current data stays on screen. */
  refreshing: boolean;
  reload: () => void;
}

/** What `useAsync` returns: the state, plus whether the data is from an earlier visit and not yet confirmed. */
export interface CachedAsyncState<T> extends AsyncState<T> {
  /** With the `cache` option: the data is what the page showed last time, and the read to confirm it is still under way. */
  cached: boolean;
}

interface State<T> {
  data?: T;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  cached: boolean;
}

/**
 * One-time read with loading/error/reload. Screens use one-shot reads rather
 * than live listeners unless live updates are worth their cost.
 *
 * reload() refreshes in the background: the data stays (and so do dialogs
 * opened over it) while `refreshing` is true. A failed refresh keeps the data
 * and sets `error`.
 *
 * `cache` (a name for this read; off unless given) paints what the same read
 * with the same `deps` returned last time, with `cached` and `refreshing`
 * true, while it reads again; if that read fails the old data goes and the
 * error shows. Kept in memory only (shared/asyncCache.ts). Opt in only where
 * `deps` are plain values that include every input of `load`, and keep
 * one-click actions disabled while `cached` is true. Not for forms, limits,
 * availability or money.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], options: { cache?: string } = {}): CachedAsyncState<T> {
  const key = options.cache ? `${options.cache}|${JSON.stringify(deps)}` : null;
  const [state, setState] = useState<State<T>>(() => {
    const hit = key ? get<T>(key) : undefined;
    return hit ? { data: hit.data, error: null, loading: false, refreshing: true, cached: true } : { error: null, loading: true, refreshing: false, cached: false };
  });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  // The read whose data is on screen (data belongs to the current inputs only if it is `run`).
  const shown = useRef<unknown>(state.cached ? run : null);
  // The data on screen is from an earlier visit and no read has confirmed it yet.
  const unconfirmed = useRef(state.cached);
  // `key` changes only when `deps` do, and then `run` changes with it.
  const keyNow = useRef(key);
  keyNow.current = key;

  useEffect(() => {
    let live = true;
    const key = keyNow.current;
    if (shown.current !== run) {
      // New inputs seen before: their last answer replaces the previous inputs' data while this read runs.
      const hit = key ? get<T>(key) : undefined;
      unconfirmed.current = !!hit;
      if (hit) {
        shown.current = run;
        setState({ data: hit.data, error: null, loading: false, refreshing: true, cached: true });
      }
    }
    const background = shown.current === run;
    setState((s) => (background ? { ...s, refreshing: true } : { ...s, loading: true, refreshing: false, error: null, cached: false }));
    const started = Date.now();
    run().then(
      (data) => {
        if (key) set(key, data, started);
        if (!live) return;
        shown.current = run;
        unconfirmed.current = false;
        setState({ data, error: null, loading: false, refreshing: false, cached: false });
      },
      (e: unknown) => {
        reportError(e, 'load');
        if (!live) return;
        // Plain words for missing permission, a database index still building (after a deploy), or no connection.
        const error = errorText(e, t.errorLoad);
        if (unconfirmed.current) {
          // What was painted from an earlier visit could not be confirmed: it goes, and the page says why.
          if (key) remove(key);
          unconfirmed.current = false;
          shown.current = null;
          setState({ error, loading: false, refreshing: false, cached: false });
          return;
        }
        setState((s) => (background ? { ...s, error, refreshing: false } : { error, loading: false, refreshing: false, cached: false }));
      },
    );
    return () => {
      live = false;
    };
  }, [run, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, data: state.data, reload };
}
