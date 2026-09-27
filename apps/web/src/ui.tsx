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
