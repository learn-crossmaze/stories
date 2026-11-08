import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type PageOf, usePagedQuery } from '../shared/usePagedQuery';
import { t } from '../strings';

/** A fetch whose answers the test hands out, in any order. */
function controlled() {
  const requests: { q: string; after: number | undefined; resolve: (p: PageOf<string, number>) => void; reject: (e: unknown) => void }[] = [];
  const fetchFor = (q: string) => (after: number | undefined) =>
    new Promise<PageOf<string, number>>((resolve, reject) => requests.push({ q, after, resolve, reject }));
  return { requests, fetchFor };
}

describe('usePagedQuery', () => {
  it('ignores the answer to an earlier search that arrives after a later one', async () => {
    const { requests, fetchFor } = controlled();
    const { result, rerender } = renderHook(({ q }) => usePagedQuery<string, number>(fetchFor(q), [q]), { initialProps: { q: 'ha' } });
    rerender({ q: 'harry' });
    await waitFor(() => expect(requests.map((r) => r.q)).toEqual(['ha', 'harry']));

    await act(async () => requests[1].resolve({ items: ['Harry Potter'] }));
    expect(result.current.items).toEqual(['Harry Potter']);
    // The slow answer for "ha" comes in last: it must not replace the results for "harry".
    await act(async () => requests[0].resolve({ items: ['Hamlet', 'Harry Potter', 'Hatchet'], cursor: 3 }));
    expect(result.current.items).toEqual(['Harry Potter']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('drops a "Load more" for the previous filters once the filters change', async () => {
    const { requests, fetchFor } = controlled();
    const { result, rerender } = renderHook(({ q }) => usePagedQuery<string, number>(fetchFor(q), [q]), { initialProps: { q: 'all' } });
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].resolve({ items: ['a1', 'a2'], cursor: 2 }));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    expect(requests[1]).toMatchObject({ q: 'all', after: 2 });
    // A second click while the page loads does nothing.
    act(() => result.current.loadMore());
    expect(requests).toHaveLength(2);

    rerender({ q: 'archived' });
    await waitFor(() => expect(requests).toHaveLength(3));
    await act(async () => requests[2].resolve({ items: ['x1'] }));
    await act(async () => requests[1].resolve({ items: ['a3', 'a4'], cursor: 4 }));
    expect(result.current.items).toEqual(['x1']);
    expect(result.current.hasMore).toBe(false);
  });

  it('appends pages and shows a failure in plain words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { requests, fetchFor } = controlled();
    const { result } = renderHook(() => usePagedQuery<string, number>(fetchFor('q'), []));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].resolve({ items: ['a'], cursor: 1 }));
    act(() => result.current.loadMore());
    await act(async () => requests[1].resolve({ items: ['b'], cursor: 2 }));
    expect(result.current.items).toEqual(['a', 'b']);

    act(() => result.current.loadMore());
    await act(async () => requests[2].reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })));
    expect(result.current.error).toBe(t.errorForbidden);
    expect(result.current.items).toEqual(['a', 'b']);
    vi.restoreAllMocks();
  });
});
