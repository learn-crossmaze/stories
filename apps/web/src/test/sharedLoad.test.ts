import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forget, sharedLoad } from '../data/shared';

describe('one read for several askers (sharedLoad)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    forget();
  });
  afterEach(() => vi.useRealTimers());

  it('gives askers at the same moment the one read under way, however long it takes', async () => {
    let answer: (n: number) => void = () => undefined;
    const load = vi.fn(() => new Promise<number>((r) => (answer = r)));
    const first = sharedLoad('u1|counts', load, 5_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const second = sharedLoad('u1|counts', load, 5_000);
    answer(7);
    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps an answer for the hold time, counted from when it arrived, then reads again', async () => {
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    const first = await sharedLoad('u1|counts', load, 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(await sharedLoad('u1|counts', load, 5_000)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await sharedLoad('u1|counts', load, 5_000)).toEqual({ n: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never keeps a failure: the next asker reads again', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
    await expect(sharedLoad('u1|counts', load, 5_000)).rejects.toThrow('offline');
    expect(await sharedLoad('u1|counts', load, 5_000)).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a load that throws straight away is a failed read, not a crash', async () => {
    const load = vi.fn((): Promise<string> => {
      throw new Error('bad input');
    });
    await expect(sharedLoad('u1|counts', load, 5_000)).rejects.toThrow('bad input');
  });

  it('shares nothing between people or between different questions', async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    expect(await sharedLoad('u1|org|cen', load, 5_000)).toBe(1);
    expect(await sharedLoad('u2|org|cen', load, 5_000)).toBe(2);
    expect(await sharedLoad('u1|org|nth', load, 5_000)).toBe(3);
    expect(await sharedLoad('u1|org|cen', load, 5_000)).toBe(1);
  });

  it('forget drops what is held under a prefix, a read under way included', async () => {
    let answer: (s: string) => void = () => undefined;
    const slow = vi.fn(() => new Promise<string>((r) => (answer = r)));
    const before = sharedLoad('me|u1', slow, 10_000);
    const other = vi.fn(async () => 'kept');
    await sharedLoad('counts|u1', other, 10_000);

    forget('me|');
    const fresh = vi.fn(async () => 'after the save');
    expect(await sharedLoad('me|u1', fresh, 10_000)).toBe('after the save');
    // The read from before the save still answers whoever asked it, but nobody after.
    answer('before the save');
    expect(await before).toBe('before the save');
    expect(await sharedLoad('me|u1', fresh, 10_000)).toBe('after the save');
    expect(fresh).toHaveBeenCalledTimes(1);

    await sharedLoad('counts|u1', other, 10_000);
    expect(other).toHaveBeenCalledTimes(1);
    forget();
    await sharedLoad('counts|u1', other, 10_000);
    expect(other).toHaveBeenCalledTimes(2);
  });
});
