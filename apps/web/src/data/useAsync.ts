import { useCallback, useEffect, useState } from 'react';

import { t } from '../strings';

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
        console.error(e);
        const denied = (e as { code?: string }).code === 'permission-denied';
        if (live) setState({ error: denied ? t.errorForbidden : t.errorLoad, loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [run, tick]);

  return { ...state, data: state.data, reload: () => setTick((n) => n + 1) };
}
