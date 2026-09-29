import { t } from '../strings';

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
  camera: 'M12 17.5q1.9 0 3.2-1.3 1.3-1.3 1.3-3.2t-1.3-3.2Q13.9 8.5 12 8.5t-3.2 1.3Q7.5 11.1 7.5 13t1.3 3.2q1.3 1.3 3.2 1.3Zm0-2q-1 0-1.8-.7-.7-.8-.7-1.8t.7-1.8q.8-.7 1.8-.7t1.8.7q.7.8.7 1.8t-.7 1.8q-.8.7-1.8.7ZM4 21q-.8 0-1.4-.6Q2 19.8 2 19V7q0-.8.6-1.4Q3.2 5 4 5h3.2L9 3h6l1.8 2H20q.8 0 1.4.6.6.6.6 1.4v12q0 .8-.6 1.4-.6.6-1.4.6Z',
  scan: 'M2 6V2h4v2H4v2H2Zm18 0V4h-2V2h4v4h-2ZM2 22v-4h2v2h2v2H2Zm16 0v-2h2v-2h2v4h-4ZM6 17V7h2v10H6Zm3 0V7h1v10H9Zm2 0V7h2v10h-2Zm3 0V7h3v10h-3Zm4 0V7h1v10h-1Z',
  shelves: 'M3 21V3h18v18H3Zm2-2h14v-4H5v4Zm0-6h14V9H5v4Zm0-6h14V5H5v2Zm2 11v-2h2v2H7Zm0-6v-2h2v2H7Zm0-6V5h2v1H7Z',
  bookmark: 'M5 21V5q0-.8.6-1.4T7 3h10q.8 0 1.4.6T19 5v16l-7-3-7 3Zm2-3.05 5-2.15 5 2.15V5H7v12.95Z',
  wallet: 'M5 21q-.8 0-1.4-.6T3 19V5q0-.8.6-1.4T5 3h14q.8 0 1.4.6T21 5v2.5h-2V5H5v14h14v-2.5h2V19q0 .8-.6 1.4T19 21H5Zm8-4q-.8 0-1.4-.6T11 15V9q0-.8.6-1.4T13 7h7q.8 0 1.4.6T22 9v6q0 .8-.6 1.4T20 17h-7Zm7-2V9h-7v6h7Zm-4-1.5q.6 0 1.1-.4t.4-1.1q0-.6-.4-1.1t-1.1-.4q-.6 0-1.1.4t-.4 1.1q0 .6.4 1.1t1.1.4Z',
  print: 'M16 8V5H8v3H6V3h12v5h-2Zm2 4.5q.4 0 .7-.3t.3-.7q0-.4-.3-.7t-.7-.3q-.4 0-.7.3t-.3.7q0 .4.3.7t.7.3ZM16 19v-4H8v4h8Zm2 2H6v-4H2v-6q0-1.3.9-2.1T5 8h14q1.3 0 2.1.9T22 11v6h-4v4Zm2-6v-4q0-.4-.3-.7T19 10H5q-.4 0-.7.3T4 11v4h2v-2h12v2h2Z',
  plus: 'M11 19v-6H5v-2h6V5h2v6h6v2h-6v6h-2Z',
  palette:
    'M12 22q-2.05 0-3.9-.79t-3.2-2.14q-1.35-1.35-2.12-3.18T2 12q0-2.07.81-3.9t2.2-3.17Q6.4 3.58 8.25 2.79T12.2 2q2 0 3.78.69t3.1 1.9q1.35 1.2 2.13 2.85T22 11.05q0 2.87-1.75 4.4T16 17h-1.85q-.23 0-.31.13t-.09.27q0 .3.38.86t.37 1.29q0 1.25-.69 1.85T12 22Zm-5.5-9q.65 0 1.08-.43T8 11.5q0-.65-.43-1.08T6.5 10q-.65 0-1.08.43T5 11.5q0 .65.43 1.08T6.5 13Zm3-4q.65 0 1.08-.43T11 7.5q0-.65-.43-1.08T9.5 6q-.65 0-1.08.43T8 7.5q0 .65.43 1.08T9.5 9Zm5 0q.65 0 1.08-.43T16 7.5q0-.65-.43-1.08T14.5 6q-.65 0-1.08.43T13 7.5q0 .65.43 1.08T14.5 9Zm3 4q.65 0 1.08-.43T19 11.5q0-.65-.43-1.08T17.5 10q-.65 0-1.08.43T16 11.5q0 .65.43 1.08T17.5 13Z',
  check: 'm9.55 18-5.7-5.7 1.43-1.42 4.27 4.27 9.18-9.18 1.42 1.42L9.55 18Z',
  alert: 'M1 21 12 2l11 19H1Zm10-3h2v-2h-2v2Zm0-4h2v-5h-2v5Z',
  menu: 'M3 18v-2h18v2H3Zm0-5v-2h18v2H3Zm0-5V6h18v2H3Z',
  close: 'M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z',
  logout: 'M5 21q-.8 0-1.4-.6T3 19V5q0-.8.6-1.4T5 3h7v2H5v14h7v2H5Zm11-4-1.4-1.45L17.15 13H9v-2h8.15l-2.55-2.55L16 7l5 5-5 5Z',
  key: 'M7 18q-2.5 0-4.25-1.75T1 12q0-2.5 1.75-4.25T7 6q2.02 0 3.6 1.14T12.65 10H23v4h-2v4h-4v-4h-4.35q-.47 1.72-2.05 2.86T7 18Zm0-2q1.65 0 2.73-1.03T11.1 12.5V12h7.9v4h1v-4h1v-.01l-.01-.99H11.1q-.3-1.43-1.38-2.46T7 8q-1.65 0-2.83 1.18T3 12q0 1.65 1.18 2.83T7 16Zm0-2q.83 0 1.41-.59T9 12q0-.83-.59-1.41T7 10q-.83 0-1.41.59T5 12q0 .83.59 1.41T7 14Z',
  tune: 'M11 21v-6h2v2h8v2h-8v2h-2Zm-8-2v-2h6v2H3Zm4-4v-2H3v-2h4V9h2v6H7Zm4-2v-2h10v2H11Zm4-4V3h2v2h4v2h-4v2h-2ZM3 7V5h10v2H3Z',
  badge: 'M4 22q-.8 0-1.4-.6T2 20V9q0-.8.6-1.4T4 7h5V4q0-.8.6-1.4T11 2h2q.8 0 1.4.6T15 4v3h5q.8 0 1.4.6T22 9v11q0 .8-.6 1.4T20 22H4Zm0-2h16V9h-5q0 .8-.6 1.4T13 11h-2q-.8 0-1.4-.6T9 9H4v11Zm2-2h6v-.5q0-.9-.9-1.35T9 15.7q-1.2 0-2.1.45T6 17.5v.5Zm8-1.5h4V15h-4v1.5ZM9 15q.63 0 1.06-.44t.44-1.06q0-.63-.44-1.06T9 12q-.63 0-1.06.44T7.5 13.5q0 .63.44 1.06T9 15Zm5-1.5h4V12h-4v1.5ZM11 9h2V4h-2v5Z',
  tree: 'M15 21v-3h-4V8H9v3H2V3h7v3h6V3h7v8h-7V8h-2v8h2v-3h7v8h-7ZM4 9h3V5H4v4Zm13 10h3v-4h-3v4Zm0-10h3V5h-3v4Z',
  expand: 'M12 15.4 6 9.4 7.4 8l4.6 4.6L16.6 8 18 9.4l-6 6Z',
  console: 'M4 20q-.8 0-1.4-.6T2 18V6q0-.8.6-1.4T4 4h16q.8 0 1.4.6T22 6v12q0 .8-.6 1.4T20 20H4Zm0-2h16V8H4v10Zm3.5-1-1.4-1.4L8.67 13 6.1 10.4 7.5 9l4 4-4 4Zm4.5 0v-2h6v2h-6Z',
  bell: 'M4 19v-2h2v-7q0-2.08 1.25-3.69T10.5 4.2v-.7q0-.63.44-1.06T12 2q.63 0 1.06.44t.44 1.06v.7q2 .5 3.25 2.11T18 10v7h2v2H4Zm8 3q-.83 0-1.41-.59T10 20h4q0 .83-.59 1.41T12 22Zm-4-5h8v-7q0-1.65-1.18-2.83T12 6q-1.65 0-2.82 1.18T8 10v7Z',
  insights: 'M3 21v-2h18v2H3Zm1-3v-7h3v7H4Zm5 0V6h3v12H9Zm5 0V9h3v9h-3Zm5 0V3h3v15h-3Z',
  payments: 'M14 13q-1.25 0-2.12-.88T11 10q0-1.25.88-2.12T14 7q1.25 0 2.13.88T17 10q0 1.25-.87 2.13T14 13Zm-7 3q-.83 0-1.41-.59T5 14V6q0-.83.59-1.41T7 4h14q.83 0 1.41.59T23 6v8q0 .83-.59 1.41T21 16H7Zm2-2h10q0-.83.59-1.41T21 12V8q-.83 0-1.41-.59T19 6H9q0 .83-.59 1.41T7 8v4q.83 0 1.41.59T9 14Zm9 6H3q-.83 0-1.41-.59T1 18V7h2v11h15v2Z',
  calendar: 'M5 22q-.8 0-1.4-.6T3 20V6q0-.8.6-1.4T5 4h1V2h2v2h8V2h2v2h1q.8 0 1.4.6T21 6v14q0 .8-.6 1.4T19 22H5Zm0-2h14V10H5v10ZM5 8h14V6H5v2Zm2 6v-2h2v2H7Zm4 0v-2h2v2h-2Zm4 0v-2h2v2h-2Zm-8 4v-2h2v2H7Zm4 0v-2h2v2h-2Zm4 0v-2h2v2h-2Z',
  clock: 'M12 22q-2.08 0-3.9-.79t-3.18-2.14q-1.35-1.35-2.14-3.18T2 12q0-2.08.79-3.9t2.14-3.18Q6.28 3.57 8.1 2.79T12 2q2.08 0 3.9.79t3.18 2.14q1.35 1.35 2.14 3.18T22 12q0 2.08-.79 3.9t-2.14 3.18q-1.35 1.35-3.18 2.14T12 22Zm0-2q3.35 0 5.68-2.33T20 12q0-3.35-2.33-5.68T12 4Q8.65 4 6.33 6.33T4 12q0 3.35 2.33 5.68T12 20Zm3.3-3.3 1.4-1.4-3.7-3.7V7h-2v5.4l4.3 4.3Z',
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
