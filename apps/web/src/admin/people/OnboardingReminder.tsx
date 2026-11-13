import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { myOnboardingState, ONBOARDING_CHANGED, type OnboardingState, type OnboardingStatus } from '../../data/selfOnboarding';
import { paths } from '../../paths';
import { Icon } from '../../shared/ui';
import { type CachedAsyncState, useAsync } from '../../shared/useAsync';
import { ht } from '../../strings/hr';
import { Dialog } from '../components/Dialog';
import { useWorkspace } from '../Workspace';

/** How often the reminder pops up while mandatory details or documents are missing. */
export const REMINDER_EVERY_MS = 4 * 60 * 60 * 1000;

const storeKey = (uid: string, orgId: string) => `stories.onboardingReminder.${uid}.${orgId}`;
const lastShown = (key: string) => {
  try {
    return Number(localStorage.getItem(key) ?? 0);
  } catch {
    return 0;
  }
};
const markShown = (key: string) => {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Private mode or blocked storage: the reminder simply shows again next time.
  }
};

/** A look again when the tab comes back into view, unless the last one was within this long. */
export const ONBOARDING_FRESH_MS = 5 * 60 * 1000;
/** A look again this often while the tab stays in view (HR may have rejected a document or asked for more). */
export const ONBOARDING_EVERY_MS = 10 * 60 * 1000;

type Shared = CachedAsyncState<OnboardingState | null>;
const OnboardingContext = createContext<Shared | null>(null);

/**
 * The signed-in person's own record and self-onboarding status, read once for the whole console: the banner, the
 * menu count, the Dashboard, My profile and Complete my profile all show this one answer. It is read again when
 * the person saves or uploads something (at once), when the tab comes back into view after 5 minutes, and every
 * 10 minutes while it stays in view. A refresh keeps what is on screen; a failure shows nothing here.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const last = useRef(0);
  const state = useAsync(() => {
    last.current = Date.now();
    return org && user ? myOnboardingState(org.id, user.uid) : Promise.resolve(null);
  }, [org?.id, user?.uid]);
  const { reload } = state;
  useEffect(() => {
    const stale = (ms: number) => Date.now() - last.current >= ms;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && stale(ONBOARDING_FRESH_MS)) reload();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && stale(ONBOARDING_EVERY_MS - 5_000)) reload();
    }, ONBOARDING_EVERY_MS);
    window.addEventListener(ONBOARDING_CHANGED, reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(ONBOARDING_CHANGED, reload);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);
  // While another organization's answer is on its way, the previous one is not shown as this one's.
  const { data, error, loading, refreshing } = state;
  const value = useMemo<Shared>(
    () => ({ data: loading ? undefined : data, error, loading, refreshing, cached: false, reload }),
    [data, error, loading, refreshing, reload],
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

const NOT_SHARED: Shared = { data: null, error: null, loading: false, refreshing: false, cached: false, reload: () => undefined };

/** The signed-in person's own employee record and self-onboarding status (the shell's one shared read). */
export function useMyOnboardingState(): Shared {
  return useContext(OnboardingContext) ?? NOT_SHARED;
}

/** The signed-in person's self-onboarding status, refreshed when they save or upload something. */
export function useMyOnboarding(): CachedAsyncState<OnboardingStatus | null> {
  const shared = useMyOnboardingState();
  return useMemo(() => ({ ...shared, data: shared.data === undefined ? undefined : (shared.data?.status ?? null) }), [shared]);
}

/**
 * Staff shell: while mandatory profile details or documents are missing, a
 * banner stays on every page, and a reminder pops up at sign-in and again
 * every 4 hours (per person and organization, on this device).
 */
export function OnboardingReminder() {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const status = useMyOnboarding();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const missing = status.data?.missing.length ?? 0;
  const onPage = pathname === paths.adminMyOnboarding;
  const key = user && org ? storeKey(user.uid, org.id) : null;

  useEffect(() => {
    if (!key || !missing || onPage) {
      setOpen(false);
      return;
    }
    const check = () => {
      if (Date.now() - lastShown(key) >= REMINDER_EVERY_MS) setOpen(true);
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [key, missing, onPage]);

  if (!missing || !key) return null;
  const later = () => {
    markShown(key);
    setOpen(false);
  };
  return (
    <>
      {!onPage && (
        <div className="ob-banner" role="status">
          <Icon name="alert" />
          <span>{ht.obBanner(missing)}</span>
          <Link to={paths.adminMyOnboarding} className="btn btn-text">
            {ht.obReminderNow}
          </Link>
        </div>
      )}
      {open && (
        <Dialog title={ht.obReminderTitle} onClose={later} narrow>
          <p>{ht.obReminderBody(missing)}</p>
          <ul className="ob-missing">
            {status.data!.missing.map((i) => (
              <li key={i.key}>
                {i.label}
                {i.note && <span className="muted small"> · {i.note}</span>}
              </li>
            ))}
          </ul>
          <p className="muted small">{ht.obReminderNext}</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-text" onClick={later}>
              {ht.obReminderLater}
            </button>
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => {
                later();
                navigate(paths.adminMyOnboarding);
              }}
            >
              {ht.obReminderNow}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
