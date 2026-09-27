import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ApiError } from '../data/api';
import { t } from '../strings';

/** Accessible modal: labelled, Escape closes, focus moves in and returns on close. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Form wrapper for a server command: disables double submits, keeps input on
 * failure and shows the server's user-facing message.
 */
export function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
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

/** Confirmation for destructive actions; the reason goes into the audit log. */
export function ConfirmWithReason({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = reason.trim().length < 3;
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (invalid) return;
    await onConfirm(reason.trim());
  });
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">{body}</p>
        <TextField label={t.reasonLabel} hint={t.reasonHint} value={reason} onChange={setReason} error={touched && invalid ? t.required : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={confirmLabel} onCancel={onClose} danger />
      </form>
    </Dialog>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const described = [props.hint && `${id}-hint`, props.error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type={props.type ?? 'text'}
        value={props.value}
        disabled={props.disabled}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={!!props.error}
        aria-describedby={described}
      />
      {props.hint && (
        <span id={`${id}-hint`} className="field-hint">
          {props.hint}
        </span>
      )}
      {props.error && (
        <span id={`${id}-error`} className="field-error">
          {props.error}
        </span>
      )}
    </div>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
