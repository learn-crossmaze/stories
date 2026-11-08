import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
