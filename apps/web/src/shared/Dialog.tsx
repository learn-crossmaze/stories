import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { ApiError, errorText } from '../data/api';
import { t } from '../strings';
import { reportError } from './reportError';

// Dialogs and the hooks behind their buttons, shared by the staff console and the member app.

/**
 * Accessible modal: labelled, Escape closes, focus moves in, stays in (Tab wraps) and returns on close.
 * Forms get room for two columns; `narrow` suits a short confirmation or a single field.
 */
export function Dialog({ title, onClose, children, narrow }: { title: string; onClose: () => void; children: ReactNode; narrow?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Keep Tab inside the dialog while it is open.
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) =>
          !el.hasAttribute('disabled') && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden',
      );
      if (!items.length) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={narrow ? 'dialog dialog-narrow' : 'dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A failure the user should see; anything that isn't the server's answer is also reported. */
function failureText(err: unknown): string {
  if (!(err instanceof ApiError)) reportError(err, 'action');
  return errorText(err);
}

/**
 * Form wrapper for a server command: disables double submits, keeps input on
 * failure and shows the server's user-facing message.
 */
export function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: two clicks in the same frame both see busy === false.
  const running = useRef(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(failureText(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

/**
 * A button's server action (not a form): one at a time, so a double click
 * can't run it twice. `pending` is the key of the running action, for screens
 * with several buttons. `run` resolves to true when the action succeeded.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const run = useCallback(async (fn: () => Promise<unknown>, key = 'run'): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setPending(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(failureText(err));
      return false;
    } finally {
      running.current = false;
      setPending(null);
    }
  }, []);
  return { busy: pending !== null, pending, error, setError, run };
}

export function FormError({ error }: { error: string | null }) {
  return (
    <p className="form-error" role="alert">
      {error}
    </p>
  );
}

export function DialogActions({ busy, submitLabel, onCancel, danger }: { busy: boolean; submitLabel: string; onCancel: () => void; danger?: boolean }) {
  return (
    <div className="dialog-actions">
      <button type="button" className="btn btn-text" onClick={onCancel} disabled={busy}>
        {t.cancel}
      </button>
      <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-filled'}`} disabled={busy}>
        {busy ? t.saving : submitLabel}
      </button>
    </div>
  );
}
