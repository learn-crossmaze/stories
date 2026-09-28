import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ApiError } from '../../data/api';
import { t } from '../../strings';

/**
 * Accessible modal: labelled, Escape closes, focus moves in and returns on close.
 * Forms get room for two columns; `narrow` suits a short confirmation or a single field.
 */
export function Dialog({ title, onClose, children, narrow }: { title: string; onClose: () => void; children: ReactNode; narrow?: boolean }) {
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
      <div className={narrow ? 'dialog dialog-narrow' : 'dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
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
    <Dialog title={title} onClose={onClose} narrow>
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

export function TextArea(props: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <textarea id={id} rows={props.rows ?? 3} value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-invalid={!!props.error} />
      {props.hint && <span className="field-hint">{props.hint}</span>}
      {props.error && <span className="field-error">{props.error}</span>}
    </div>
  );
}

/** Checkbox list with a filter box, for picking several items from a long list. */
export function MultiPick({
  legend,
  options,
  value,
  onChange,
  max,
  error,
  onAdd,
}: {
  legend: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  error?: string;
  onAdd?: (name: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const shown = options.filter((o) => value.includes(o.value) || o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : max && value.length >= max ? value : [...value, v]);
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      <div className="pick-filter">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.filterPlaceholder} aria-label={`${legend}: ${t.filterPlaceholder}`} />
        {onAdd && filter.trim().length >= 2 && !options.some((o) => o.label.toLowerCase() === filter.trim().toLowerCase()) && (
          <button
            type="button"
            className="btn btn-text"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              try {
                await onAdd(filter.trim());
                setFilter('');
              } finally {
                setAdding(false);
              }
            }}
          >
            + {filter.trim()}
          </button>
        )}
      </div>
      <div className="pick-list">
        {shown.map((o) => (
          <label key={o.value} className="check">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}
