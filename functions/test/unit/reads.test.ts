import { describe, expect, it } from 'vitest';

import { inOrder, readAll } from '../../src/core/reads.js';

const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const failAfter = (ms: number, reason: string) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(reason)), ms));

describe('inOrder (reads started together)', () => {
  it('gives the results in the order listed, whichever finishes first', async () => {
    expect(await inOrder([after(20, 'slow'), after(0, 2), Promise.resolve(null)])).toEqual(['slow', 2, null]);
    expect(await inOrder([])).toEqual([]);
  });

  it('throws the failure of the first one listed, not the first to fail', async () => {
    // The permission check is listed first: its refusal wins even when a later read fails sooner.
    await expect(inOrder([failAfter(20, 'FORBIDDEN'), failAfter(0, 'NOT_FOUND'), after(0, 'ok')])).rejects.toThrow('FORBIDDEN');
    await expect(inOrder([after(20, 'ok'), failAfter(10, 'second'), failAfter(0, 'third')])).rejects.toThrow('second');
  });

  it('waits for every read and leaves no failure unobserved', async () => {
    const unhandled: unknown[] = [];
    const seen = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', seen);
    let lastDone = false;
    const last = after(30, 'done').then((v) => {
      lastDone = true;
      return v;
    });
    await expect(inOrder([failAfter(0, 'first'), failAfter(10, 'later'), last])).rejects.toThrow('first');
    expect(lastDone).toBe(true);
    await after(20, null); // a failure nobody handled would be reported by now
    process.off('unhandledRejection', seen);
    expect(unhandled).toEqual([]);
  });
});

describe('readAll (several documents in one read)', () => {
  it('asks once for all of them, and not at all for an empty list', async () => {
    const calls: unknown[][] = [];
    const tx = { getAll: async (...refs: unknown[]) => (calls.push(refs), refs.map((r) => ({ ref: r }))) };
    const refs = [{ path: 'a/1' }, { path: 'a/2' }];
    expect(await readAll(tx as never, refs as never)).toEqual([{ ref: refs[0] }, { ref: refs[1] }]);
    expect(await readAll(tx as never, [])).toEqual([]);
    expect(calls).toEqual([refs]);
  });
});
