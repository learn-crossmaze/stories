import JsBarcode from 'jsbarcode';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { t } from '../strings';
import { EmptyState, Icon } from '../ui';
import { useWorkspace } from './Workspace';

/** Placeholder cover generated from the title (no copyrighted artwork). */
export function BookCover({ title, author, seed, url, size = 'md' }: { title: string; author?: string; seed: string; url?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (url) return <img className={`cover cover-img cover-${size}`} src={url} alt="" loading="lazy" />;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const palettes = [
    ['#b4502b', '#fbe3d7'], ['#55705a', '#ddeadf'], ['#2f6690', '#dbe8f3'], ['#6b4c9a', '#e8e0f3'],
    ['#8a5a00', '#f6e7c8'], ['#1e2a2f', '#f1eadf'], ['#9c2f4f', '#f6dbe3'], ['#2e7d6b', '#d7eee8'],
  ];
  const [ink, paper] = palettes[h % palettes.length];
  return (
    <div className={`cover cover-${size}`} style={{ background: paper, color: ink, borderColor: ink }} aria-hidden="true">
      <span className="cover-band" style={{ background: ink }} />
      <span className="cover-title">{title}</span>
      {author && size !== 'sm' && <span className="cover-author">{author}</span>}
    </div>
  );
}

/**
 * Input for barcode scanners (they type the code and press Enter) and manual
 * entry. Keeps focus after each scan so staff can scan continuously.
 */
export function ScanInput({ label, onScan, busy, placeholder }: { label: string; onScan: (value: string) => void | Promise<void>; busy?: boolean; placeholder?: string }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <form
      className="scan"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setValue('');
        await onScan(v);
        ref.current?.focus();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="scan-row">
        <Icon name="scan" />
        <input
          id={id}
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? t.scanPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button type="submit" className="btn btn-outlined" disabled={busy || !value.trim()}>
          {t.scanAdd}
        </button>
      </div>
    </form>
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

/** Code 128 barcode as inline SVG. */
export function Barcode({ value, height = 44 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height, width: 1.6, margin: 0, displayValue: false });
  }, [value, height]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} />;
}

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
