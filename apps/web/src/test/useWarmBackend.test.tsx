import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let user: { uid: string } | null = { uid: 'u1' };
const warm = vi.fn();

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('../data/api', () => ({ warm: () => warm() }));

const { useWarmBackend } = await import('../shared/useWarmBackend');

const show = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  warm.mockClear();
  user = { uid: 'u1' };
});

describe('useWarmBackend', () => {
  it('wakes the backend when a signed-in person opens the app and when the tab comes back into view', () => {
    const { unmount } = renderHook(() => useWarmBackend());
    expect(warm).toHaveBeenCalledTimes(1);
    show('hidden');
    expect(warm).toHaveBeenCalledTimes(1);
    show('visible');
    expect(warm).toHaveBeenCalledTimes(2);
    unmount();
    show('visible');
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it('does nothing while nobody is signed in', () => {
    user = null;
    renderHook(() => useWarmBackend());
    show('visible');
    expect(warm).not.toHaveBeenCalled();
  });
});
