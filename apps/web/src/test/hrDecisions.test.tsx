import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { runEach, useDecisions, useHidden, useTicks } from '../admin/people/decisions';
import { ApiError } from '../data/api';

// Deciding several waiting requests: each is its own command, a few at a time, and each row keeps its own outcome.

type Row = { id: string };
const row = (id: string): Row => ({ id });

/** A send whose answers the test gives one by one. */
function held() {
  const waiting = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
  const send = vi.fn((r: Row) => new Promise<void>((resolve, reject) => waiting.set(r.id, { resolve, reject })));
  return { send, waiting };
}

describe('runEach', () => {
  it('runs a few at a time, in order, and one failure does not stop the others', async () => {
    let running = 0;
    let most = 0;
    const settled: [number, boolean][] = [];
    const left = await runEach(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        most = Math.max(most, ++running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        if (n === 2) throw new Error('no');
      },
      (n, failure) => settled.push([n, !!failure]),
    );
    expect(most).toBe(3);
    expect(left).toEqual([]);
    expect(settled.map(([n]) => n).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(settled.filter(([, failed]) => failed)).toEqual([[2, true]]);
  });

  it('starts nothing more once a failure is one that will meet everyone, and says who was left', async () => {
    const started: number[] = [];
    const left = await runEach(
      [1, 2, 3, 4],
      1,
      async (n) => {
        started.push(n);
        if (n === 2) throw new Error('closed');
      },
      () => undefined,
      (failure) => (failure as Error).message === 'closed',
    );
    expect(started).toEqual([1, 2]);
    expect(left).toEqual([3, 4]);
  });
});

describe('useDecisions', () => {
  it('a second click on a row whose decision is on its way sends nothing more', async () => {
    const { send, waiting } = held();
    const onDone = vi.fn();
    const onIdle = vi.fn();
    const { result } = renderHook(() => useDecisions<Row>(send, onDone, onIdle));
    act(() => void result.current.approve(row('a')));
    act(() => void result.current.approve(row('a')));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.busy('a')).toBe(true);
    expect(result.current.working).toBe(true);
    // Another row is not held back.
    act(() => void result.current.approve(row('b')));
    expect(send).toHaveBeenCalledTimes(2);

    await act(async () => waiting.get('a')!.resolve());
    expect(result.current.busy('a')).toBe(false);
    expect(onDone).toHaveBeenCalledWith(row('a'));
    expect(onIdle).not.toHaveBeenCalled(); // b is still on its way
    await act(async () => waiting.get('b')!.resolve());
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(result.current.working).toBe(false);
  });

  it('keeps a refusal with its row, whatever happens to the other rows', async () => {
    const { send, waiting } = held();
    const onDone = vi.fn();
    const { result } = renderHook(() => useDecisions<Row>(send, onDone));
    act(() => void result.current.approveMany([row('a'), row('b')]));
    expect(result.current.busy('a') && result.current.busy('b')).toBe(true);
    await act(async () => waiting.get('a')!.reject(new ApiError('Attendance for 2026-10 is finalized.', 'MONTH_FINALIZED')));
    await act(async () => waiting.get('b')!.resolve());
    expect(result.current.failed).toEqual({ a: 'Attendance for 2026-10 is finalized.' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(row('b'));
    // Approving another row later does not wipe it; trying the row again does.
    act(() => void result.current.approve(row('c')));
    expect(result.current.failed.a).toBeDefined();
    act(() => void result.current.approve(row('a')));
    expect(result.current.failed.a).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('a request someone else decided first counts as done, with a note and no error', async () => {
    const { send, waiting } = held();
    const onDone = vi.fn();
    const onIdle = vi.fn();
    const { result } = renderHook(() => useDecisions<Row>(send, onDone, onIdle));
    act(() => void result.current.approve(row('a')));
    await act(async () => waiting.get('a')!.reject(new ApiError('This leave request has already been decided.', 'NOT_PENDING')));
    expect(result.current.failed).toEqual({});
    expect(result.current.elsewhere).toEqual([row('a')]);
    expect(onDone).toHaveBeenCalledWith(row('a'));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('rejecting: a refusal is thrown for the dialog and the row is free again; success closes the dialog', async () => {
    const { send, waiting } = held();
    const onDone = vi.fn();
    const { result } = renderHook(() => useDecisions<Row>(send, onDone));
    act(() => result.current.reject(row('a')));
    expect(result.current.rejecting).toEqual(row('a'));
    let outcome: Promise<void>;
    act(() => {
      outcome = result.current.confirmReject('No cover that week');
      outcome.catch(() => undefined);
    });
    expect(send).toHaveBeenCalledWith(row('a'), 'REJECT', 'No cover that week');
    expect(result.current.busy('a')).toBe(true);
    await act(async () => waiting.get('a')!.reject(new ApiError('Say why the leave is rejected.', 'INVALID_INPUT')));
    await expect(outcome!).rejects.toThrow('Say why the leave is rejected.');
    expect(result.current.busy('a')).toBe(false);
    expect(result.current.rejecting).toEqual(row('a'));
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      outcome = result.current.confirmReject('No cover that week');
    });
    await act(async () => waiting.get('a')!.resolve());
    await outcome!;
    expect(result.current.rejecting).toBeNull();
    expect(onDone).toHaveBeenCalledWith(row('a'));
  });
});

describe('useHidden and useTicks', () => {
  it('a decided row is hidden until the list is read again (an id can come back)', () => {
    const first = [row('a'), row('b')];
    const { result, rerender } = renderHook(({ rows }) => useHidden(rows), { initialProps: { rows: first as Row[] | undefined } });
    expect(result.current.shown).toBe(first);
    act(() => result.current.hide('a'));
    expect(result.current.shown).toEqual([row('b')]);
    expect(result.current.hidden('a')).toBe(true);
    // The same read again (a refresh that failed keeps it): still hidden.
    rerender({ rows: first });
    expect(result.current.shown).toEqual([row('b')]);
    // A fresh read: whatever it holds is shown, also a new request under the same id.
    const second = [row('a')];
    rerender({ rows: second });
    expect(result.current.shown).toBe(second);
    expect(result.current.hidden('a')).toBe(false);
    // Hiding after a fresh read starts from nothing hidden.
    act(() => result.current.hide('x'));
    expect(result.current.shown).toEqual([row('a')]);
  });

  it('nothing starts ticked, and a row that left the list no longer counts', () => {
    const { result, rerender } = renderHook(({ rows }) => useTicks(rows), { initialProps: { rows: [row('a'), row('b')] } });
    expect(result.current.chosen).toEqual([]);
    expect(result.current.all).toBe(false);
    act(() => result.current.toggleAll(true));
    expect(result.current.chosen).toEqual([row('a'), row('b')]);
    expect(result.current.all).toBe(true);
    rerender({ rows: [row('b')] });
    expect(result.current.chosen).toEqual([row('b')]);
    act(() => result.current.toggle('b', false));
    expect(result.current.chosen).toEqual([]);
  });
});
