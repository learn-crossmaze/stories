import { render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';
import { type ErrorReport, setErrorSink } from '../shared/reportError';
import { RouteError } from '../shared/RouteError';
import { isChunkLoadError } from '../shared/staleChunks';
import { t } from '../strings';

/** A route whose page fails like `fail` (a lazily loaded page, as in the app). */
function renderFailingPage(fail: () => Promise<never>) {
  const Page = lazy(fail);
  const router = createMemoryRouter([
    {
      errorElement: <RouteError />,
      children: [
        {
          path: '/',
          element: (
            <Suspense fallback={<p>{t.loading}</p>}>
              <Page />
            </Suspense>
          ),
        },
      ],
    },
  ]);
  render(<RouterProvider router={router} />);
}

let reports: ErrorReport[] = [];
let restore: ReturnType<typeof setErrorSink>;
beforeEach(() => {
  reports = [];
  restore = setErrorSink((r) => reports.push(r));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  setErrorSink(restore);
  vi.restoreAllMocks();
});

describe('route error screen', () => {
  it('is the root route’s error element', () => {
    expect(routes[0].errorElement).toBeTruthy();
  });

  it('offers a reload when a page chunk from before a deploy is gone', async () => {
    renderFailingPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://stories.app/assets/ExplorePage-old.js')));
    expect(await screen.findByRole('heading', { name: t.updateTitle })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(t.updateBody);
    expect(screen.getByRole('button', { name: t.reload })).toBeInTheDocument();
    expect(reports.at(-1)).toMatchObject({ source: 'route', context: { update: true } });
  });

  it('says something went wrong for any other failure, with a reload and a way home', async () => {
    renderFailingPage(() => Promise.reject(new Error('boom')));
    expect(await screen.findByRole('heading', { name: t.crashTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.reload })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.goHome })).toHaveAttribute('href', '/');
    expect(reports.at(-1)).toMatchObject({ source: 'route', message: 'boom' });
  });

  it('recognises chunk load failures across browsers', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'))).toBe(true); // Chrome
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: /assets/a.js'))).toBe(true); // Firefox
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true); // Safari
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true); // Vite
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});
