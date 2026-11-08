import { useId } from 'react';

// Labelled form fields (hint and error tied to the control), shared by the staff console and the member app.

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
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const described = [props.hint && `${id}-hint`, props.error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value as T)}
        aria-invalid={!!props.error}
        aria-describedby={described}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
