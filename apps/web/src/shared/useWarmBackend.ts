import { useEffect } from 'react';

import { useAuth } from '../auth/AuthContext';
import { warm } from '../data/api';

/**
 * Wakes the backend when a signed-in person opens the app and whenever its tab
 * comes back into view, so their first action does not wait for it to start.
 * `warm` sends at most one small request per 10 minutes and never fails.
 */
export function useWarmBackend(): void {
  const uid = useAuth().user?.uid;
  useEffect(() => {
    if (!uid) return;
    warm();
    const onVisible = () => {
      if (document.visibilityState === 'visible') warm();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [uid]);
}
