import { type ReactNode, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { ApiError, errorText } from '../../data/api';
import { reportError } from '../../shared/reportError';
import { t } from '../../strings';
import { EmptyState, Icon } from '../../shared/ui';
import { CameraScanner } from './CameraScanner';
import { lt } from '../../strings/library';
import { useWorkspace } from '../Workspace';

/** Placeholder cover generated from the title (no copyrighted artwork). */
export { BookCover } from '../../shared/BookCover';

/**
 * Input for barcode scanners (they type the code and press Enter), manual
 * entry, or the device camera (laptop webcam / phone). Keeps focus after each
 * scan so staff can scan continuously.
 *
 * Not a <form>: it sits inside dialog forms, and a scanner's Enter must never
 * submit them. While a scan is looked up the field is read-only; a failed
 * lookup puts the code back and says what went wrong.
 */
export function ScanInput({ label, onScan, busy, placeholder }: { label: string; onScan: (value: string) => void | Promise<void>; busy?: boolean; placeholder?: string }) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const id = useId();
  const errorId = `${id}-error`;
  const scan = async (raw: string) => {
    const v = raw.trim();
    if (!v || busy || inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    setValue('');
    try {
      await onScan(v);
    } catch (e) {
      if (!(e instanceof ApiError)) reportError(e, 'scan');
      setError(errorText(e, t.errorLoad));
      setValue(v);
    } finally {
      inFlight.current = false;
      setRunning(false);
      ref.current?.focus();
    }
  };
  return (
    <div className="scan" aria-busy={running || undefined}>
      <label htmlFor={id}>{label}</label>
      <div className="scan-row">
        <Icon name="scan" />
        <input
          id={id}
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // Stops the browser submitting a surrounding form ("implicit submission").
            e.preventDefault();
            e.stopPropagation();
            void scan(value);
          }}
          placeholder={placeholder ?? t.scanPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          readOnly={running}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
        <button type="button" className="btn btn-outlined" disabled={busy || running || !value.trim()} onClick={() => void scan(value)}>
          {running ? t.loading : t.scanAdd}
        </button>
        <button
          type="button"
          className={`btn ${camera ? 'btn-filled' : 'btn-outlined'} btn-icon`}
          onClick={() => setCamera((c) => !c)}
          aria-pressed={camera}
          aria-label={camera ? lt.camStop : lt.camUse}
          title={camera ? lt.camStop : lt.camUse}
        >
          <Icon name="camera" />
        </button>
      </div>
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
      {camera && <CameraScanner onDetect={(text) => void scan(text)} onClose={() => setCamera(false)} />}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`tab ${value === tab.value ? 'tab-active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}


/**
 * QR code for the same value: laptop webcams and phones read it reliably even
 * when slightly out of focus or at an angle, unlike the thin bars of Code 128.
 */
export { QrCode, QrTag } from '../../shared/QrCode';

/** Wraps branch-level pages: requires a branch the user works at. */
export function NeedBranch({ children }: { children: (branchId: string) => ReactNode }) {
  const { branch, branchesLoading } = useWorkspace();
  if (branchesLoading) return null;
  if (!branch) return <EmptyState icon="store" title={t.noBranchTitle} message={t.noBranchMessage} />;
  return <>{children(branch.id)}</>;
}

export function Stat({ value, label, to }: { value: number | string; label: string; to?: string }) {
  const body = (
    <>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </>
  );
  return to ? (
    <Link className="stat stat-link" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
