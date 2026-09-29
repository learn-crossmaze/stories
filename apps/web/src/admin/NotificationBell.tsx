// The header bell: unread count and a panel of recent notifications (decisions others made on your requests).
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../auth/AuthContext';
import { type AppNotification, markRead, watchNotifications } from '../data/notifications';
import { Icon } from '../shared/ui';
import { ht } from '../strings/hr';

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function NotificationBell() {
  const { user } = useAuth();
  const [list, setList] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!user) return;
    // A failed listener (offline, rules) just leaves the bell empty.
    return watchNotifications(user.uid, setList, () => setList([]));
  }, [user?.uid]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!user) return null;
  const unread = list.filter((n) => !n.read);
  const read = (ids: string[]) => void markRead(user.uid, ids).catch(() => undefined);

  return (
    <div className="bell" ref={ref}>
      <button
        ref={button}
        type="button"
        className="btn btn-text btn-icon bell-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ht.notificationsLabel(unread.length)}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {unread.length > 0 && (
          <span className="bell-count" aria-hidden="true">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="bell-panel" id={panelId} role="region" aria-label={ht.notifications}>
          <div className="bell-head">
            <h2>{ht.notifications}</h2>
            {unread.length > 0 && (
              <button type="button" className="btn btn-text" onClick={() => read(unread.map((n) => n.id))}>
                {ht.markAllRead}
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="muted bell-empty">{ht.noNotifications}</p>
          ) : (
            <ul className="bell-list">
              {list.map((n) => {
                const content = (
                  <>
                    <span className="bell-title">
                      {!n.read && <span className="bell-dot" aria-label={ht.unread} />}
                      {n.title}
                    </span>
                    {n.body && <span className="bell-body">{n.body}</span>}
                    {n.at && <span className="bell-when">{when.format(n.at)}</span>}
                  </>
                );
                return (
                  <li key={n.id} className={n.read ? 'bell-item' : 'bell-item bell-unread'}>
                    {n.link ? (
                      <Link
                        to={n.link}
                        onClick={() => {
                          if (!n.read) read([n.id]);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
