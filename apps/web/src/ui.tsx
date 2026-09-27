import { t } from './strings';

// Small shared UI pieces. Icons are inline SVG paths (Material Symbols, Apache-2.0).

const iconPaths = {
  home: 'M6 19h3v-6h6v6h3v-9l-6-4.5L6 10v9Zm-2 2V9l8-6 8 6v12h-7v-6h-2v6H4Z',
  explore:
    'm7.5 16.5 7-2 2-7-7 2-2 7ZM12 13.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  book: 'M6 22q-.8 0-1.4-.6T4 20V4q0-.8.6-1.4T6 2h12q.8 0 1.4.6T20 4v16q0 .8-.6 1.4T18 22H6Zm0-2h12V4h-2v7l-2.5-1.5L11 11V4H6v16Z',
  truck:
    'M6 20q-1.3 0-2.1-.9T3 17H1V6q0-.8.6-1.4T3 4h14v4h3l3 4v5h-2q0 1.3-.9 2.1T18 20q-1.3 0-2.1-.9T15 17H9q0 1.3-.9 2.1T6 20Zm0-2q.4 0 .7-.3T7 17q0-.4-.3-.7T6 16q-.4 0-.7.3T5 17q0 .4.3.7t.7.3Zm-3-3h.8q.4-.5 1-.7T6 14q.6 0 1.2.3t1 .7H15V6H3v9Zm15 3q.4 0 .7-.3t.3-.7q0-.4-.3-.7T18 16q-.4 0-.7.3t-.3.7q0 .4.3.7t.7.3Zm-1-5h4.3L19 10h-2v3Z',
  person:
    'M12 12q-1.7 0-2.8-1.2T8 8q0-1.7 1.2-2.8T12 4q1.7 0 2.8 1.2T16 8q0 1.7-1.2 2.8T12 12Zm-8 8v-2.8q0-.9.4-1.6t1.2-1.1q1.5-.8 3.1-1.1T12 13q1.7 0 3.3.4t3.1 1.1q.7.4 1.2 1.1t.4 1.6V20H4Zm2-2h12v-.8q0-.3-.1-.5t-.4-.4q-1.4-.7-2.7-1T12 15q-1.4 0-2.8.3t-2.7 1q-.3.2-.4.4t-.1.5v.8Zm6-8q.8 0 1.4-.6T14 8q0-.8-.6-1.4T12 6q-.8 0-1.4.6T10 8q0 .8.6 1.4t1.4.6Z',
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  building:
    'M3 21V3h12v4h6v14H3Zm2-2h2v-2H5v2Zm0-4h2v-2H5v2Zm0-4h2V9H5v2Zm0-4h2V5H5v2Zm4 12h2v-2H9v2Zm0-4h2v-2H9v2Zm0-4h2V9H9v2Zm0-4h2V5H9v2Zm4 12h6V9h-6v2h2v2h-2v2h2v2h-2v2Z',
  store: 'M4 4h16v2H4V4Zm-1 4h18l-1 5v7h-2v-6h-4v6H4v-7L3 8Zm3 7v3h4v-3H6Z',
  people:
    'M9 12a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm-7 7v-1.5C2 15 5 13.5 9 13.5s7 1.5 7 4V19H2Zm14.5-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm1.5 1.6c2.3.4 4 1.5 4 3.4V19h-4v-1.5c0-1.5-.7-2.8-1.9-3.8.6-.1 1.2-.1 1.9-.1Z',
  history:
    'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12Z',
  folder: 'M3 6q0-.8.6-1.4T5 4h5l2 2h7q.8 0 1.4.6T21 8v10q0 .8-.6 1.4T19 20H5q-.8 0-1.4-.6T3 18V6Z',
  scan: 'M2 6V2h4v2H4v2H2Zm18 0V4h-2V2h4v4h-2ZM2 22v-4h2v2h2v2H2Zm16 0v-2h2v-2h2v4h-4ZM6 17V7h2v10H6Zm3 0V7h1v10H9Zm2 0V7h2v10h-2Zm3 0V7h3v10h-3Zm4 0V7h1v10h-1Z',
  shelves: 'M3 21V3h18v18H3Zm2-2h14v-4H5v4Zm0-6h14V9H5v4Zm0-6h14V5H5v2Zm2 11v-2h2v2H7Zm0-6v-2h2v2H7Zm0-6V5h2v1H7Z',
  bookmark: 'M5 21V5q0-.8.6-1.4T7 3h10q.8 0 1.4.6T19 5v16l-7-3-7 3Zm2-3.05 5-2.15 5 2.15V5H7v12.95Z',
  wallet: 'M5 21q-.8 0-1.4-.6T3 19V5q0-.8.6-1.4T5 3h14q.8 0 1.4.6T21 5v2.5h-2V5H5v14h14v-2.5h2V19q0 .8-.6 1.4T19 21H5Zm8-4q-.8 0-1.4-.6T11 15V9q0-.8.6-1.4T13 7h7q.8 0 1.4.6T22 9v6q0 .8-.6 1.4T20 17h-7Zm7-2V9h-7v6h7Zm-4-1.5q.6 0 1.1-.4t.4-1.1q0-.6-.4-1.1t-1.1-.4q-.6 0-1.1.4t-.4 1.1q0 .6.4 1.1t1.1.4Z',
  print: 'M16 8V5H8v3H6V3h12v5h-2Zm2 4.5q.4 0 .7-.3t.3-.7q0-.4-.3-.7t-.7-.3q-.4 0-.7.3t-.3.7q0 .4.3.7t.7.3ZM16 19v-4H8v4h8Zm2 2H6v-4H2v-6q0-1.3.9-2.1T5 8h14q1.3 0 2.1.9T22 11v6h-4v4Zm2-6v-4q0-.4-.3-.7T19 10H5q-.4 0-.7.3T4 11v4h2v-2h12v2h2Z',
  plus: 'M11 19v-6H5v-2h6V5h2v6h6v2h-6v6h-2Z',
  check: 'm9.55 18-5.7-5.7 1.43-1.42 4.27 4.27 9.18-9.18 1.42 1.42L9.55 18Z',
  alert: 'M1 21 12 2l11 19H1Zm10-3h2v-2h-2v2Zm0-4h2v-5h-2v5Z',
  card: 'M4 20q-.8 0-1.4-.6T2 18V6q0-.8.6-1.4T4 4h16q.8 0 1.4.6T22 6v12q0 .8-.6 1.4T20 20H4Zm0-2h16v-6H4v6Zm0-10h16V6H4v2Z',
} as const;

export type IconName = keyof typeof iconPaths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d={iconPaths[name]} fill="currentColor" />
    </svg>
  );
}

export function EmptyState({ icon, title, message }: { icon: IconName; title: string; message: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <span className="empty-icon empty-icon-danger">
        <Icon name="alert" />
      </span>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-outlined" onClick={onRetry}>
          {t.retry}
        </button>
      )}
    </div>
  );
}

/** Placeholder rows while a table loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label={t.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

const tone: Record<string, string> = {
  ACTIVE: 'ok',
  ARCHIVED: 'muted',
  REVOKED: 'muted',
  SUSPENDED: 'warn',
};

/** Status chip: always text (and a dot), never color alone. */
export function StatusBadge({ status }: { status: string }) {
  const label = ({ ACTIVE: t.active, ARCHIVED: t.archived, REVOKED: t.revoked, SUSPENDED: t.suspended } as Record<string, string>)[status] ?? status;
  return <span className={`badge badge-${tone[status] ?? 'muted'}`}>{label}</span>;
}
