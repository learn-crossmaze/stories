import { useEffect, useId, useRef, useState } from 'react';

import { branchLine, cleanIfsc, type IfscDetails, isIfsc, lookupIfsc } from '../../shared/ifsc';
import { t } from '../../strings';

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'found'; details: IfscDetails } | { kind: 'notFound' } | { kind: 'offline' };

/**
 * An IFSC input that looks the code up as soon as it is complete and shows the
 * bank and branch under it. `onFound` lets the form fill the bank name.
 * A code the directory doesn't know is a warning, not a block: new branches
 * can take a while to appear.
 */
export function IfscField({ label, value, onChange, onFound, error }: { label: string; value: string; onChange: (v: string) => void; onFound?: (d: IfscDetails) => void; error?: string }) {
  const id = useId();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const found = useRef(onFound);
  found.current = onFound;
  const code = cleanIfsc(value);
  const complete = isIfsc(code);

  useEffect(() => {
    if (!complete) {
      setStatus({ kind: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setStatus({ kind: 'checking' });
    lookupIfsc(code, ctrl.signal)
      .then((r) => {
        if (r.found) {
          setStatus({ kind: 'found', details: r.details });
          found.current?.(r.details);
        } else setStatus({ kind: r.found === false ? 'notFound' : 'offline' });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [code, complete]);

  const shownError = error ?? (status.kind === 'notFound' ? t.ifscNotFound : undefined);
  const described = [`${id}-status`, shownError && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        maxLength={14}
        autoComplete="off"
        spellCheck={false}
        className="mono"
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-invalid={!!shownError}
        aria-describedby={described}
      />
      <span id={`${id}-status`} className="field-hint" aria-live="polite">
        {status.kind === 'checking' && t.ifscChecking}
        {status.kind === 'found' && (
          <span className="ok-text">
            {status.details.bank}
            {branchLine(status.details) && <span className="field-hint"> · {branchLine(status.details)}</span>}
          </span>
        )}
        {status.kind === 'offline' && t.ifscOffline}
        {status.kind === 'idle' && !shownError && t.ifscHint}
      </span>
      {shownError && (
        <span id={`${id}-error`} className="field-error">
          {shownError}
        </span>
      )}
    </div>
  );
}
