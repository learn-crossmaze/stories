import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Copy } from '../data/inventory';

// Copies in the data layer: which copy a scan finds, which shelf a returned book goes back to, and the calls
// that put a trolley back shelf by shelf.
type Asked = { field: string; value: unknown }[];
type Sent = { action: string; locationId: string; copyIds: string[]; requestId: string };
const world = vi.hoisted(() => ({
  /** The copy each question finds, keyed by "field=value". */
  found: {} as Record<string, Record<string, unknown>>,
  asked: [] as Asked[],
  /** Answers held back until the test lets them go, to see that the questions are put together. */
  hold: null as null | (() => void)[],
  calls: [] as Sent[],
  respond: ((data: Sent) => ({ shelved: data.copyIds.length, unchanged: 0 })) as (data: Sent) => unknown,
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    const answer = world.respond(data);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: () => ({}),
  query: (_collection: unknown, ...constraints: unknown[]) => constraints,
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  limit: (n: number) => ({ field: 'limit', value: n }),
  getDocs: async (constraints: Asked) => {
    world.asked.push(constraints);
    if (world.hold) await new Promise<void>((go) => world.hold!.push(go));
    const by = constraints.find((c) => c.field === 'barcode' || c.field === 'code')!;
    const hit = world.found[`${by.field}=${String(by.value)}`];
    return { empty: !hit, docs: hit ? [{ id: hit.id, data: () => hit }] : [] };
  },
}));

const { findCopy, shelveGroups, usualShelf, usualShelfGroups } = await import('../data/inventory');

const copy = (id: string, over: Partial<Copy> = {}): Copy => ({
  id, code: `C-${id}`, barcode: `C-${id}`, bookId: 'bk1', bookCode: 'B1', bookTitle: 'A book', owningBranchId: 'b1', currentBranchId: 'b1',
  locationId: null, status: 'AVAILABLE', condition: 'GOOD', acquisitionCostMinor: 0, activeLoanId: null, activeReservationId: null, lifetimeLoans: 0,
  ...over,
});

beforeEach(() => {
  world.found = {};
  world.asked.length = 0;
  world.hold = null;
  world.calls.length = 0;
  world.respond = (data) => ({ shelved: data.copyIds.length, unchanged: 0 });
});

describe('findCopy', () => {
  it('asks for the barcode and the code together, each at the branch, in capitals', async () => {
    world.hold = [];
    world.found['code=C-7'] = { id: 'c7', code: 'C-7' };
    const finding = findCopy('o1', 'b1', '  c-7 ');
    await vi.waitFor(() => expect(world.asked).toHaveLength(2));
    // Neither answer has come back yet: the second question did not wait for the first.
    world.hold.forEach((go) => go());
    expect(await finding).toMatchObject({ id: 'c7' });
    for (const constraints of world.asked) {
      expect(constraints).toContainEqual({ field: 'currentBranchId', value: 'b1' });
      expect(constraints).toContainEqual({ field: 'limit', value: 1 });
    }
    expect(world.asked.map((c) => c.find((x) => x.field === 'barcode' || x.field === 'code'))).toEqual([
      { field: 'barcode', value: 'C-7' },
      { field: 'code', value: 'C-7' },
    ]);
  });

  it('takes the copy with that barcode over another copy with that code', async () => {
    world.found['barcode=X-1'] = { id: 'labelled', code: 'COPY-9', barcode: 'X-1' };
    world.found['code=X-1'] = { id: 'coded', code: 'X-1', barcode: 'OLD' };
    expect(await findCopy('o1', 'b1', 'x-1')).toMatchObject({ id: 'labelled' });
  });

  it('answers null when the branch has no such copy', async () => {
    expect(await findCopy('o1', 'b1', 'NOPE')).toBeNull();
  });
});

describe('usual shelf', () => {
  const active = new Set(['A', 'B']);

  it('is the shelf the copy was last issued from, when that shelf is in use at this branch', () => {
    expect(usualShelf(copy('1', { lastLocationId: 'A' }), active)).toBe('A');
    // Never issued from a shelf.
    expect(usualShelf(copy('2'), active)).toBeNull();
    expect(usualShelf(copy('3', { lastLocationId: null }), active)).toBeNull();
    // A shelf since archived, or one of the branch the book was lent at.
    expect(usualShelf(copy('4', { lastLocationId: 'GONE' }), active)).toBeNull();
    // On a shelf now: it is being moved, not put back.
    expect(usualShelf(copy('5', { lastLocationId: 'A', locationId: 'B' }), active)).toBeNull();
  });

  it('groups the copies by their usual shelf and leaves the others out', () => {
    const groups = usualShelfGroups(
      [copy('1', { lastLocationId: 'B' }), copy('2'), copy('3', { lastLocationId: 'A' }), copy('4', { lastLocationId: 'B' }), copy('5', { lastLocationId: 'GONE' }), copy('6', { lastLocationId: 'A', locationId: 'B' })],
      active,
    );
    expect(groups).toEqual([
      { locationId: 'B', copyIds: ['1', '4'] },
      { locationId: 'A', copyIds: ['3'] },
    ]);
  });
});

describe('shelveGroups', () => {
  it('sends one copies-shelve per shelf, each with its own request id, and reports the shelf that was refused', async () => {
    world.respond = (data) => (data.locationId === 'B' ? new FirebaseError('functions/failed-precondition', 'Copy C-3 is issued.') : { shelved: data.copyIds.length, unchanged: 0 });
    const results = await shelveGroups('o1', 'b1', [
      { locationId: 'A', copyIds: ['1', '2'] },
      { locationId: 'B', copyIds: ['3'] },
      { locationId: 'C', copyIds: ['4'] },
    ]);
    expect(world.calls.map((c) => [c.action, c.locationId, c.copyIds])).toEqual([
      ['copies-shelve', 'A', ['1', '2']],
      ['copies-shelve', 'B', ['3']],
      ['copies-shelve', 'C', ['4']],
    ]);
    expect(new Set(world.calls.map((c) => c.requestId)).size).toBe(3);
    expect(results).toEqual([
      { locationId: 'A', copyIds: ['1', '2'] },
      { locationId: 'B', copyIds: ['3'], error: 'Copy C-3 is issued.' },
      { locationId: 'C', copyIds: ['4'] },
    ]);
  });
});
