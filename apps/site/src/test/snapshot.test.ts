import { beforeEach, describe, expect, it, vi } from 'vitest';

// The head as written (the test page's own address is no file, so it is brought in as text, not read from disk).
import head from '../partials/head.html?raw';

const answer = () => new Response(JSON.stringify({ generatedAt: '2026-11-12T00:00:00.000Z', titles: 3 }));

describe('the live data request', () => {
  beforeEach(() => vi.resetModules());

  it('is the very request every page preloads in its head, so the browser fetches the data once', async () => {
    const { loadSnapshot } = await import('../data');
    const fetcher = vi.fn(async () => answer());
    expect((await loadSnapshot(fetcher as unknown as typeof fetch)).titles).toBe(3);
    // A plain GET of the same address: any header or option here and the preloaded answer would not be reused.
    expect(fetcher.mock.calls).toEqual([['/api/public']]);
    expect(head).toContain('<link rel="preload" href="/api/public" as="fetch" crossorigin="anonymous" vite-ignore />');
    expect(head.indexOf('rel="preload"')).toBeLessThan(head.indexOf('<script type="module"'));
  });

  it('is shared by everything on the page, and asked again after a failure', async () => {
    const { loadSnapshot } = await import('../data');
    const failing = vi.fn(async () => new Response('', { status: 503 }));
    await expect(loadSnapshot(failing as unknown as typeof fetch)).rejects.toThrow('503');
    const fetcher = vi.fn(async () => answer());
    const [a, b] = await Promise.all([loadSnapshot(fetcher as unknown as typeof fetch), loadSnapshot(fetcher as unknown as typeof fetch)]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
