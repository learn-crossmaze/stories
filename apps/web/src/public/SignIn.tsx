import { cloneElement, type FormEvent, type InputHTMLAttributes, type ReactElement, useId, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { AuthFailure } from '../auth/models';
import type { AuthRepository } from '../auth/repository';
import { authErrorMessage, t } from '../strings';
import { Icon } from '../shared/ui';

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Errors = Partial<Record<'name' | 'email' | 'password', string>>;

export function SignInPage() {
  const { repo } = useAuth();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function run(action: (r: AuthRepository) => Promise<void>): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await action(repo);
      return true;
    } catch (e) {
      if (!(e instanceof AuthFailure)) console.error(e);
      const failure = e instanceof AuthFailure ? e : new AuthFailure('unknown');
      // Show the raw code for unexpected errors so users can report something actionable.
      const suffix = failure.code === 'unknown' && failure.firebaseCode ? ` (${failure.firebaseCode})` : '';
      setError(authErrorMessage[failure.code] + suffix);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errors: Errors = {};
    if (creating && !name.trim()) errors.name = t.validationName;
    if (!emailPattern.test(email.trim())) errors.email = t.validationEmail;
    if (password.length < 8) errors.password = t.validationPassword;
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    await run((r) => (creating ? r.createAccount(name, email, password) : r.signInWithEmail(email, password)));
  }

  async function resetPassword() {
    const trimmed = email.trim();
    if (!emailPattern.test(trimmed)) {
      setFieldErrors({ email: t.validationEmail });
      return;
    }
    if (await run((r) => r.sendPasswordReset(trimmed))) setNotice(t.resetEmailSent(trimmed));
  }

  return (
    <main className="sign-in">
      <aside className="editorial">
        <Icon name="book" />
        <p className="editorial-title">
          Subscribe once.
          <br />
          Borrow within your plan.
          <br />
          Exchange as often as you like.
        </p>
        <p>Pick up at your library or get books delivered home. For children, teens and adults.</p>
      </aside>

      <form className="auth-form" onSubmit={submit} noValidate>
        <p className="wordmark">{t.appTitle}</p>
        <h1>{creating ? t.createAccountTitle : t.signInTitle}</h1>
        <p className="muted">{creating ? t.createAccountSubtitle : t.signInSubtitle}</p>

        {creating && (
          <Field label={t.fullNameLabel} error={fieldErrors.name}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        <Field label={t.emailLabel} error={fieldErrors.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label={t.passwordLabel} error={fieldErrors.password}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={creating ? 'new-password' : 'current-password'}
          />
        </Field>

        {!creating && (
          <button type="button" className="btn btn-text align-end" disabled={submitting} onClick={resetPassword}>
            {t.forgotPassword}
          </button>
        )}

        <p className="form-error" role="alert">
          {error}
        </p>
        <p className="form-notice" role="status">
          {notice}
        </p>

        <button type="submit" className="btn btn-filled" disabled={submitting}>
          {submitting ? t.loading : creating ? t.createAccountButton : t.signInButton}
        </button>

        <div className="divider">
          <span>{t.orDivider}</span>
        </div>

        <button
          type="button"
          className="btn btn-outlined"
          disabled={submitting}
          onClick={() => run((r) => r.signInWithGoogle())}
        >
          {t.continueWithGoogle}
        </button>
        <button
          type="button"
          className="btn btn-text"
          disabled={submitting}
          onClick={() => {
            setCreating(!creating);
            setError(null);
            setFieldErrors({});
          }}
        >
          {creating ? t.haveAccountButton : t.createAccountButton}
        </button>
      </form>
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactElement<InputHTMLAttributes<HTMLInputElement>> }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-invalid': !!error, 'aria-describedby': error ? errorId : undefined })}
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
