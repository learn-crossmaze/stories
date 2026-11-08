import { useEffect, useRef } from 'react';
import { useRouteError } from 'react-router';

import { paths } from '../paths';
import { t } from '../strings';
import { reportError } from './reportError';
import { isChunkLoadError, reloadingForUpdate } from './staleChunks';
import { Icon } from './ui';

/**
 * The app's last line of defence (the root route's errorElement): a page that
 * failed to render or load. A page chunk that can't be fetched usually means a
 * new version was deployed since the tab was opened: that gets a plain
 * "new version" message; anything else a general one. Both offer a reload.
 */
export function RouteError() {
  const error = useRouteError();
  const update = isChunkLoadError(error) || reloadingForUpdate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    reportError(error, 'route', { update });
    heading.current?.focus();
  }, [error, update]);
  return (
    <main className="empty-state route-error" role="alert">
      <span className={update ? 'empty-icon' : 'empty-icon empty-icon-danger'}>
        <Icon name={update ? 'history' : 'alert'} />
      </span>
      <h1 ref={heading} tabIndex={-1}>
        {update ? t.updateTitle : t.crashTitle}
      </h1>
      <p>{update ? t.updateBody : t.crashBody}</p>
      <div className="row">
        <button type="button" className="btn btn-filled" onClick={() => window.location.reload()}>
          {t.reload}
        </button>
        {!update && (
          <a className="btn btn-text" href={paths.home}>
            {t.goHome}
          </a>
        )}
      </div>
    </main>
  );
}
