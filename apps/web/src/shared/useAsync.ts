import { useCallback, useEffect, useState } from 'react';

import { errorText } from '../data/api';
import { t } from '../strings';
import { reportError } from './reportError';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * One-time read with loading/error/reload. Screens use one-shot reads rather
 * than live listeners unless live updates are worth their cost.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean }>({ error: null, loading: true });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    run().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => {
        reportError(e, 'load');
        // Plain words for missing permission, a database index still building (after a deploy), or no connection.
        if (live) setState({ error: errorText(e, t.errorLoad), loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [run, tick]);

  return { ...state, data: state.data, reload: () => setTick((n) => n + 1) };
}
