import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Receive books data layer: the cover queue, and how received copies are shared out between branches.
interface Sent {
  action: string;
  bookId: string;
  imageUrl: string;
  requestId: string;
}
const calls: Sent[] = [];
/** The cover imports under way: each is answered by the test. */
const open = new Map<string, (answer: unknown) => void>();

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    calls.push(data);
    const answer = await new Promise((resolve) => open.set(data.bookId, resolve));
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));

const { assignCopies, COVER_IMPORTS, coverProgress, onCoverProgress, queueCovers, receiveChunks, transferLoads } = await import('../data/bulkBooks');
const { TRANSFER_MAX } = await import('../data/circulation');

const covers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ bookId: `bk${from + i}`, url: `https://books.google.com/${from + i}.jpg` }));
/** Answers a cover import and lets the queue move on. */
async function finish(bookId: string, answer: unknown = {}) {
  open.get(bookId)!(answer);
  open.delete(bookId);
  await new Promise((r) => setTimeout(r, 0));
}
/** Whether closing the tab now would ask first. */
function leavingAsks() {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

beforeEach(() => {
  calls.length = 0;
});

describe('cover queue', () => {
  it('imports a few at a time, counts what is done across deliveries, and never imports a title twice', async () => {
    const seen: { done: number; total: number }[] = [];
    const stop = onCoverProgress((p) => seen.push(p));
    expect(leavingAsks()).toBe(false);

    queueCovers(covers(1, 5));
    expect(coverProgress()).toEqual({ done: 0, total: 5 });
    expect(calls.map((c) => c.bookId)).toEqual(['bk1', 'bk2', 'bk3']);
    expect(calls.length).toBe(COVER_IMPORTS);
    expect(calls[0]).toMatchObject({ action: 'books-setCover', imageUrl: 'https://books.google.com/1.jpg' });
    // Each import is its own request.
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(3);
    // Covers still waiting can't be fetched from the book page later: leaving asks first.
    expect(leavingAsks()).toBe(true);

    // A second delivery joins the same queue and the same count; a title already queued is left out.
    queueCovers([...covers(5, 7), ...covers(2, 2)]);
    expect(coverProgress()).toEqual({ done: 0, total: 7 });
    expect(calls).toHaveLength(3);

    // One that can't be fetched counts as done, and the next one starts.
    await finish('bk1', new FirebaseError('functions/permission-denied', 'Not allowed.'));
    expect(coverProgress()).toEqual({ done: 1, total: 7 });
    expect(calls.map((c) => c.bookId)).toEqual(['bk1', 'bk2', 'bk3', 'bk4']);
    for (const id of ['bk2', 'bk3', 'bk4', 'bk5', 'bk6']) await finish(id);
    expect(open.size).toBe(1);
    expect(leavingAsks()).toBe(true);
    await finish('bk7');
    expect(coverProgress()).toEqual({ done: 7, total: 7 });
    expect(calls.map((c) => c.bookId)).toEqual(['bk1', 'bk2', 'bk3', 'bk4', 'bk5', 'bk6', 'bk7']);
    expect(leavingAsks()).toBe(false);
    expect(seen.at(-1)).toEqual({ done: 7, total: 7 });

    // Once everything is in, the count starts again; a page that stopped watching hears nothing more.
    stop();
    const told = seen.length;
    queueCovers([...covers(8, 8), ...covers(1, 1)]);
    expect(coverProgress()).toEqual({ done: 0, total: 1 });
    await finish('bk8');
    expect(coverProgress()).toEqual({ done: 1, total: 1 });
    expect(seen).toHaveLength(told);
    expect(leavingAsks()).toBe(false);
  });

  it('does nothing for an empty list', () => {
    const before = coverProgress();
    queueCovers([]);
    expect(coverProgress()).toBe(before);
    expect(calls).toHaveLength(0);
    expect(leavingAsks()).toBe(false);
  });
});

describe('sharing received copies out between branches', () => {
  const line = (bookId: string, n: number) => ({ bookId, title: bookId, copies: Array.from({ length: n }, (_, k) => ({ id: `${bookId}-${k + 1}`, code: `C-${bookId}-${k + 1}` })) });

  it('gives each branch the next copies of a title in code order, and never more than there are', () => {
    const loads = assignCopies([line('a', 5), line('b', 2)], ['north', 'south', 'east'], { a: { north: 2, south: 1 }, b: { south: 5, east: 1 } });
    expect(loads.map((l) => [l.branchId, l.copies.map((c) => c.id)])).toEqual([
      ['north', ['a-1', 'a-2']],
      // South asked for 5 of b: it gets the 2 there are, and nothing is left for East.
      ['south', ['a-3', 'b-1', 'b-2']],
    ]);
    expect(loads[1].copies[1]).toEqual({ id: 'b-1', code: 'C-b-1', bookId: 'b' });
  });

  it('ignores numbers that are not counts', () => {
    expect(assignCopies([line('a', 3)], ['north'], { a: { north: -2 } })).toEqual([]);
    expect(assignCopies([line('a', 3)], ['north'], { a: { north: 1.9 } })[0].copies.map((c) => c.id)).toEqual(['a-1']);
    expect(assignCopies([line('a', 3)], ['north'], {})).toEqual([]);
  });

  it('keeps every transfer within what one transfer takes', () => {
    const copies = Array.from({ length: 2 * TRANSFER_MAX + 1 }, (_, i) => i);
    const loads = transferLoads(copies);
    expect(loads.map((l) => l.length)).toEqual([TRANSFER_MAX, TRANSFER_MAX, 1]);
    expect(loads.flat()).toEqual(copies);
    expect(transferLoads([])).toEqual([]);
  });
});

describe('a delivery sent in several calls', () => {
  it('is cut at 25 titles or 100 copies, whichever comes first', () => {
    const q = (...quantities: number[]) => quantities.map((quantity) => ({ quantity }));
    expect(receiveChunks(q(...Array(27).fill(1)))).toEqual([{ start: 0, end: 25 }, { start: 25, end: 27 }]);
    expect(receiveChunks(q(50, 50, 1))).toEqual([{ start: 0, end: 2 }, { start: 2, end: 3 }]);
    expect(receiveChunks(q(50, 40, 20))).toEqual([{ start: 0, end: 2 }, { start: 2, end: 3 }]);
    expect(receiveChunks([])).toEqual([]);
  });
});
