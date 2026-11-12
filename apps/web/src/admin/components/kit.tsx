import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
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

/** How long the field must have been sitting ready before an empty Enter counts as a person's. */
const ENTER_GAP_MS = 300;

/**
 * Input for barcode scanners (they type the code and press Enter), manual
 * entry, or the device camera (laptop webcam / phone). Keeps focus after each
 * scan so staff can scan continuously.
 *
 * Not a <form>: it sits inside dialog forms, and a scanner's Enter must never
 * submit them. While a scan is looked up the field is read-only; a failed
 * lookup puts the code back and says what went wrong.
 *
 * Opt-in, all off by default:
 * - `autoFocus`: the field takes focus when it appears, and is the first focus of its page (useRouteFocus) or
 *   dialog (Dialog) through `data-autofocus`.
 * - `focusSignal`: change the number to send focus back to the field (after a save, say). Asked while `busy`,
 *   it happens when `busy` ends, unless the person has moved to another control meanwhile.
 * - `queue`: for scanning a stack. The field stays open during a lookup; codes entered meanwhile wait their turn
 *   and are handed to the latest `onScan`, one at a time, in order, with a "Looking up N" line while they do. A
 *   failed code is listed as "CODE: message" and never put back, so the next scan can't run into it.
 * - `onPendingChange`: told how many scans are not settled yet (looked up or waiting), 0 when all are. A page
 *   must hold its confirm button, and keep the field on screen, while that is above 0: codes still waiting when
 *   the field goes away are dropped.
 * - `onEmptyEnter`: Enter in the empty, idle field (to confirm what was scanned). A scanner can't trigger it:
 *   not while a scan is looked up or waiting, not on a held key, not right after a scan or after focus arrives.
 *   Keys lost to the read-only field are reported as soon as that lookup ends ("scan it again"); while the
 *   message shows, the first Enter only takes note of it and the next one confirms.
 *
 * The field never takes focus from a dialog that has opened over it.
 */
export function ScanInput({
  label,
  onScan,
  busy,
  placeholder,
  autoFocus,
  focusSignal,
  queue,
  onPendingChange,
  onEmptyEnter,
}: {
  label: string;
  onScan: (value: string) => void | Promise<void>;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  focusSignal?: number;
  queue?: boolean;
  onPendingChange?: (count: number) => void;
  onEmptyEnter?: () => void;
}) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ code: string; text: string }[]>([]);
  const [pending, setPending] = useState(0);
  // Keys were lost to the read-only field: 'new' until an Enter has taken note of the message, then 'seen'.
  const [lost, setLost] = useState<false | 'new' | 'seen'>(false);
  const ref = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const waiting = useRef<string[]>([]);
  // The queue outlives the render that started it: always call the handler of the latest render.
  const latest = useRef(onScan);
  latest.current = onScan;
  const pendingChanged = useRef(onPendingChange);
  pendingChanged.current = onPendingChange;
  const mounted = useRef(true);
  const missed = useRef(false);
  const quietUntil = useRef(0);
  const id = useId();
  const errorId = `${id}-error`;
  const lostId = `${id}-lost`;

  const report = (count: number) => {
    setPending(count);
    pendingChanged.current?.(count);
  };

  // Focus taken from an open dialog would leave the keyboard on the page behind it.
  const focusField = () => {
    const field = ref.current;
    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    if (field && (!dialogs.length || dialogs[dialogs.length - 1].contains(field))) field.focus();
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A disabled field loses focus. Give it back when `busy` ends if it was here (or nowhere) when `busy` began,
  // or if `focusSignal` asked meanwhile. `from` is where focus was when it was asked: anywhere else by the time
  // `busy` ends means the person has moved on, and focus stays with them.
  const refocus = useRef<{ from: Element | null } | null>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy && !wasBusy.current) {
      const active = document.activeElement;
      if (!active || active === document.body || active === ref.current) refocus.current = { from: null };
    }
    wasBusy.current = !!busy;
    if (!busy && refocus.current) {
      const { from } = refocus.current;
      refocus.current = null;
      const active = document.activeElement;
      if (!active || active === document.body || active === ref.current || active === from) focusField();
    }
  }, [busy]);

  const signal = useRef(focusSignal);
  useEffect(() => {
    if (signal.current === focusSignal) return;
    signal.current = focusSignal;
    if (busy) refocus.current = { from: document.activeElement };
    else focusField();
  }, [focusSignal, busy]);

  const scan = async (raw: string, fromCamera = false) => {
    const v = raw.trim();
    if (!v || busy) return;
    if (inFlight.current) {
      // The camera keeps re-reading the code in view, so it never queues.
      if (!queue || fromCamera) return;
      waiting.current.push(v);
      report(1 + waiting.current.length);
      setValue('');
      quietUntil.current = Date.now() + ENTER_GAP_MS;
      focusField();
      return;
    }
    inFlight.current = true;
    setRunning(true);
    report(1);
    setError(null);
    setLost(false);
    setValue('');
    quietUntil.current = Date.now() + ENTER_GAP_MS;
    if (queue) focusField();
    let next: string | undefined = v;
    while (next !== undefined && mounted.current) {
      const code = next;
      try {
        await latest.current(code);
        if (queue) setFailed((list) => (list.some((f) => f.code === code) ? list.filter((f) => f.code !== code) : list));
      } catch (e) {
        if (!(e instanceof ApiError)) reportError(e, 'scan');
        const text = errorText(e, t.errorLoad);
        if (queue) setFailed((list) => [...list.filter((f) => f.code !== code), { code, text }]);
        else {
          setError(text);
          setValue(code);
        }
      }
      next = waiting.current.shift();
      if (next !== undefined && mounted.current) report(1 + waiting.current.length);
    }
    waiting.current = [];
    inFlight.current = false;
    setRunning(false);
    report(0);
    if (missed.current) {
      // Said now, while it is plain which book it was, and not at the next Enter, when it may be long rescanned.
      missed.current = false;
      setLost('new');
      // The lost scan's own Enter may still be on its way.
      quietUntil.current = Date.now() + ENTER_GAP_MS;
    }
    if (!queue) focusField();
  };
  const locked = running && !queue;
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
          onFocus={() => (quietUntil.current = Date.now() + ENTER_GAP_MS)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') {
              // Typed while the field is held for a lookup: that scan is lost. Only pages that confirm with Enter
              // are told, as only there can the loss go unseen into a confirmed list.
              if (inFlight.current && !queue && onEmptyEnter && e.key.length === 1) missed.current = true;
              return;
            }
            // Stops the browser submitting a surrounding form ("implicit submission").
            e.preventDefault();
            e.stopPropagation();
            if (value.trim()) return void scan(value);
            if (!onEmptyEnter || e.repeat || busy || inFlight.current || Date.now() < quietUntil.current) return;
            // "Scan it again" is showing: this Enter only takes note of it.
            if (lost === 'new') return setLost('seen');
            setLost(false);
            onEmptyEnter();
          }}
          placeholder={placeholder ?? t.scanPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          readOnly={locked}
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          aria-invalid={!!error || !!lost}
          aria-describedby={[error && errorId, lost && lostId].filter(Boolean).join(' ') || undefined}
        />
        <button type="button" className="btn btn-outlined" disabled={busy || locked || !value.trim()} onClick={() => void scan(value)}>
          {locked ? t.loading : t.scanAdd}
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
      {lost && (
        <p id={lostId} className="field-error" role="alert">
          {t.scanMissed}
        </p>
      )}
      {queue && pending > 0 && (
        <span className="field-hint" role="status">
          {t.scanLookingUp(pending)}
        </span>
      )}
      {failed.length > 0 && (
        <div>
          {failed.map((f) => (
            <p key={f.code} className="field-error" role="alert">
              {f.code}: {f.text}
            </p>
          ))}
          <button
            type="button"
            className="btn btn-text"
            onClick={() => {
              setFailed([]);
              focusField();
            }}
          >
            {t.scanClearFailed}
          </button>
        </div>
      )}
      {camera && <CameraScanner onDetect={(text) => void scan(text, true)} onClose={() => setCamera(false)} />}
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
