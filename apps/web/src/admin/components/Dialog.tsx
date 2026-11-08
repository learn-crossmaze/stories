import { useState } from 'react';

import { Dialog, DialogActions, FormError, useSubmit } from '../../shared/Dialog';
import { TextField } from '../../shared/fields';
import { t } from '../../strings';

// The dialog and form pieces live in src/shared (the member app uses them too); re-exported for the console.
export { Dialog, DialogActions, FormError, useAction, useSubmit } from '../../shared/Dialog';
export { SelectField, TextArea, TextField } from '../../shared/fields';

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
