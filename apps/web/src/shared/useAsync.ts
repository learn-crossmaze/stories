import { useCallback, useEffect, useRef, useState } from 'react';

import { errorText } from '../data/api';
import { t } from '../strings';
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

/**
 * One-time read with loading/error/reload. Screens use one-shot reads rather
 * than live listeners unless live updates are worth their cost.
 *
 * reload() refreshes in the background: the data stays (and so do dialogs
 * opened over it) while `refreshing` is true. A failed refresh keeps the data
 * and sets `error`.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean; refreshing: boolean }>({ error: null, loading: true, refreshing: false });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  // The read whose data is on screen (data belongs to the current inputs only if it is `run`).
  const shown = useRef<unknown>(null);

  useEffect(() => {
    let live = true;
    const background = shown.current === run;
    setState((s) => (background ? { ...s, refreshing: true } : { ...s, loading: true, refreshing: false, error: null }));
    run().then(
      (data) => {
        if (!live) return;
        shown.current = run;
        setState({ data, error: null, loading: false, refreshing: false });
      },
      (e: unknown) => {
        reportError(e, 'load');
        if (!live) return;
        // Plain words for missing permission, a database index still building (after a deploy), or no connection.
        const error = errorText(e, t.errorLoad);
        setState((s) => (background ? { ...s, error, refreshing: false } : { error, loading: false, refreshing: false }));
      },
    );
    return () => {
      live = false;
    };
  }, [run, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, data: state.data, reload };
}
