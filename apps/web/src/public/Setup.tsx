import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { ApiError, command } from '../data/api';
import { paths } from '../paths';
import { t } from '../strings';

/**
 * One-time administration setup. Only the owner email configured on the
 * server (functions/.env) can claim the first Super Admin role; the server
 * rejects everyone else. Not linked from navigation.
 */
export function SetupPage() {
  const { user, repo, claims } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (claims.sa) {
    body = (
      <>
        <p className="form-notice">{t.setupDone}</p>
        <Link to={paths.admin} className="btn btn-filled">
          {t.setupOpenConsole}
        </Link>
      </>
    );
  } else if (!user?.emailVerified) {
    body = (
      <>
        <h2>{t.verifyTitle}</h2>
        <p className="muted">{t.verifyBody(user?.email ?? '')}</p>
        <div className="row">
          <button type="button" className="btn btn-outlined" disabled={busy} onClick={() => run(() => repo.resendVerification(), t.verifySent)}>
            {t.verifyResend}
          </button>
          <button type="button" className="btn btn-filled" disabled={busy} onClick={() => run(() => repo.reload())}>
            {t.verifyDone}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <button
        type="button"
        className="btn btn-filled"
        disabled={busy}
        onClick={() => run(() => command('platform-bootstrapSuperAdmin', {}).then(() => undefined))}
      >
        {busy ? t.loading : t.setupClaim}
      </button>
    );
  }

  return (
    <main className="setup">
      <p className="wordmark">{t.appTitle}</p>
      <h1>{t.setupTitle}</h1>
      <p className="muted">{t.setupBody}</p>
      {body}
      <p className="form-error" role="alert">
        {error}
      </p>
      <p className="form-notice" role="status">
        {notice}
      </p>
    </main>
  );
}
