import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { myOnboarding, ONBOARDING_CHANGED } from '../../data/selfOnboarding';
import { paths } from '../../paths';
import { Icon } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
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

/** The signed-in person's self-onboarding status, refreshed when they save or upload something. */
export function useMyOnboarding() {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const again = () => setVersion((n) => n + 1);
    window.addEventListener(ONBOARDING_CHANGED, again);
    return () => window.removeEventListener(ONBOARDING_CHANGED, again);
  }, []);
  return useAsync(() => (org && user ? myOnboarding(org.id, user.uid) : Promise.resolve(null)), [org?.id, user?.uid, version]);
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
