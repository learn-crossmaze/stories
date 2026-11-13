import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clear, get, keepFor, MAX_AGE_MS, MAX_ENTRIES, set } from '../shared/asyncCache';
import { useAsync } from '../shared/useAsync';
import { t } from '../strings';

describe('useAsync', () => {
  it('refreshes in the background: reload keeps the data on screen', async () => {
    let answer: (v: string) => void = () => undefined;
    const load = vi.fn(() => new Promise<string>((r) => (answer = r)));
    const { result } = renderHook(() => useAsync(load, []));
    expect(result.current.loading).toBe(true);
    await act(async () => answer('first'));
    expect(result.current).toMatchObject({ data: 'first', loading: false, refreshing: false });

    act(() => result.current.reload());
    expect(result.current).toMatchObject({ data: 'first', loading: false, refreshing: true });
    await act(async () => answer('second'));
    expect(result.current).toMatchObject({ data: 'second', loading: false, refreshing: false });
  });

  it('loads afresh when the inputs change, and after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async (id: string) => {
      if (id === 'bad') throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return `member ${id}`;
    });
    const { result, rerender } = renderHook(({ id }) => useAsync(() => load(id), [id]), { initialProps: { id: 'a' } });
    await waitFor(() => expect(result.current.data).toBe('member a'));
    rerender({ id: 'bad' });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.error).toBe(t.errorForbidden));
    expect(result.current.data).toBeUndefined();
    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('useAsync with `cache`: what the page showed last time, while it reads again', () => {
  afterEach(() => {
    clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A read answered by hand, one call at a time. */
  const manual = () => {
    const answers: { resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
    const load = vi.fn((_id?: string) => new Promise<string>((resolve, reject) => answers.push({ resolve, reject })));
    return { load, answers };
  };

  it('keeps nothing unless asked: a second visit loads as before', async () => {
    const load = vi.fn(async () => 'rows');
    const first = renderHook(() => useAsync(load, ['cen']));
    await waitFor(() => expect(first.result.current.data).toBe('rows'));
    expect(first.result.current.cached).toBe(false);
    first.unmount();
    const second = renderHook(() => useAsync(load, ['cen']));
    expect(second.result.current).toMatchObject({ data: undefined, loading: true, refreshing: false, cached: false });
    await waitFor(() => expect(second.result.current.data).toBe('rows'));
  });

  it('paints the last answer on coming back, marked as not yet confirmed, then the fresh one', async () => {
    const { load, answers } = manual();
    const first = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    expect(first.result.current).toMatchObject({ loading: true, cached: false });
    await act(async () => answers[0].resolve('old rows'));
    expect(first.result.current).toMatchObject({ data: 'old rows', loading: false, refreshing: false, cached: false });
    first.unmount();

    const second = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    expect(second.result.current).toMatchObject({ data: 'old rows', loading: false, refreshing: true, cached: true, error: null });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => answers[1].resolve('new rows'));
    expect(second.result.current).toMatchObject({ data: 'new rows', loading: false, refreshing: false, cached: false });
  });

  it('never serves an answer under other inputs or another read’s name', async () => {
    const load = vi.fn(async (id: string) => `rows of ${id}`);
    const first = renderHook(() => useAsync(() => load('cen'), ['cen'], { cache: 'queue' }));
    await waitFor(() => expect(first.result.current.data).toBe('rows of cen'));
    first.unmount();

    const otherBranch = renderHook(() => useAsync(() => load('nth'), ['nth'], { cache: 'queue' }));
    expect(otherBranch.result.current).toMatchObject({ data: undefined, loading: true, cached: false });
    await waitFor(() => expect(otherBranch.result.current.data).toBe('rows of nth'));
    otherBranch.unmount();
    const otherRead = renderHook(() => useAsync(() => load('cen'), ['cen'], { cache: 'holds' }));
    expect(otherRead.result.current).toMatchObject({ data: undefined, loading: true, cached: false });
    await waitFor(() => expect(otherRead.result.current.loading).toBe(false));
  });

  it('swaps to the kept answer when the inputs change to ones seen before, and loads for ones never seen', async () => {
    const { load, answers } = manual();
    const { result, rerender } = renderHook(({ tab }) => useAsync(() => load(tab), [tab], { cache: 'tabs' }), { initialProps: { tab: 'ready' } });
    await act(async () => answers[0].resolve('ready rows'));
    rerender({ tab: 'waiting' });
    // Never seen: the usual loading state, and not the other tab's rows passed off as these.
    expect(result.current).toMatchObject({ loading: true, cached: false });
    await act(async () => answers[1].resolve('waiting rows'));
    expect(result.current).toMatchObject({ data: 'waiting rows', loading: false, cached: false });

    rerender({ tab: 'ready' });
    expect(result.current).toMatchObject({ data: 'ready rows', loading: false, refreshing: true, cached: true });
    await act(async () => answers[2].resolve('ready rows, fresh'));
    expect(result.current).toMatchObject({ data: 'ready rows, fresh', refreshing: false, cached: false });
  });

  it('drops what it painted when the read to confirm it fails, and says why', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { load, answers } = manual();
    const first = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    await act(async () => answers[0].resolve('old rows'));
    first.unmount();

    const second = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    expect(second.result.current.cached).toBe(true);
    await act(async () => answers[1].reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })));
    expect(second.result.current).toMatchObject({ data: undefined, error: t.errorForbidden, loading: false, refreshing: false, cached: false });
    second.unmount();
    // Nothing is left to paint next time either.
    const third = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    expect(third.result.current).toMatchObject({ data: undefined, loading: true, cached: false });
  });

  it('a failed reload of confirmed data keeps the data, as without `cache`', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { load, answers } = manual();
    const { result } = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    await act(async () => answers[0].resolve('rows'));
    act(() => result.current.reload());
    await act(async () => answers[1].reject(new Error('offline')));
    expect(result.current).toMatchObject({ data: 'rows', loading: false, refreshing: false, cached: false });
    expect(result.current.error).toBeTruthy();
  });

  it('shows the loading state for an answer older than the limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const load = vi.fn(async () => 'rows');
    const first = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    await waitFor(() => expect(first.result.current.data).toBe('rows'));
    first.unmount();
    vi.setSystemTime(Date.now() + MAX_AGE_MS + 1);
    const second = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    expect(second.result.current).toMatchObject({ data: undefined, loading: true, cached: false });
    await waitFor(() => expect(second.result.current.data).toBe('rows'));
  });

  it('starts empty for another person or changed permissions', async () => {
    keepFor('u1|1');
    const load = vi.fn(async () => 'rows');
    const first = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    await waitFor(() => expect(first.result.current.data).toBe('rows'));
    first.unmount();
    keepFor('u1|1');
    expect(get('queue|["cen"]')).toEqual({ data: 'rows' });
    keepFor('u1|2');
    expect(get('queue|["cen"]')).toBeUndefined();
    set('queue|["cen"]', 'rows');
    keepFor('u2|1');
    expect(get('queue|["cen"]')).toBeUndefined();
    set('queue|["cen"]', 'rows');
    keepFor(null);
    const next = renderHook(() => useAsync(load, ['cen'], { cache: 'queue' }));
    expect(next.result.current).toMatchObject({ data: undefined, loading: true, cached: false });
    await waitFor(() => expect(next.result.current.loading).toBe(false));
  });

  it('a slow older read never replaces a newer answer, and the store stays small', () => {
    set('k', 'newer', 2_000_000_000_000);
    set('k', 'older', 1_999_999_999_000);
    expect(get('k')).toEqual({ data: 'newer' });
    clear();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) set(`k${i}`, i);
    expect(get('k0')).toBeUndefined();
    expect(get('k4')).toBeUndefined();
    expect(get('k5')).toEqual({ data: 5 });
    expect(get(`k${MAX_ENTRIES + 4}`)).toEqual({ data: MAX_ENTRIES + 4 });
  });
});
