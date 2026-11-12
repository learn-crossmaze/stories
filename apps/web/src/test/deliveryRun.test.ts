import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canJoinRun,
  carrierGroups,
  landingTab,
  pool,
  readLastDispatch,
  receiveBags,
  runBarcodes,
  saveLastDispatch,
  sendRun,
  startingChoice,
  tabFrom,
  withDispatch,
} from '../admin/circulation/deliveryRun';
import { ApiError } from '../data/api';
import type { Delivery, DeliveryMethod, ReadyHold } from '../data/delivery';

// The Deliveries board's rules that need no screen (admin/circulation/deliveryRun.ts).

const visit = (id: string, extra: Partial<Delivery> = {}) =>
  ({ id, status: 'REQUESTED', kind: 'DELIVER', holdIds: [], collected: [], sent: [], outcome: null, rider: null, provider: null, courier: null, ...extra }) as Delivery;
const hold = (reservationId: string, copyCode: string | null = `C-${reservationId}`): ReadyHold => ({ reservationId, bookTitle: `Book ${reservationId}`, copyCode });
const riders = [{ uid: 'asha' }, { uid: 'ravi' }];

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('what the last dispatch used', () => {
  it('starts the next dispatch with the remembered rider and method while they are still on offer', () => {
    saveLastDispatch('o1', 'b1', withDispatch({}, { method: 'OWN', riderUid: 'ravi', courierName: '' }));
    const last = readLastDispatch('o1', 'b1');
    expect(startingChoice(last, ['OWN', 'PORTER', 'MANUAL'], riders)).toEqual({ method: 'OWN', riderUid: 'ravi', courierName: '' });
    // Another branch has its own memory.
    expect(readLastDispatch('o1', 'b2')).toEqual({});
  });

  it('falls back to the first rider when the remembered one has left, and to the first method when theirs is not offered for the visit', () => {
    expect(startingChoice({ method: 'OWN', riderUid: 'gone' }, ['OWN', 'MANUAL'], riders)).toMatchObject({ method: 'OWN', riderUid: 'asha' });
    expect(startingChoice({ method: 'MANUAL', riderUid: 'ravi', courierName: 'Speedy' }, ['OWN'], riders)).toEqual({ method: 'OWN', riderUid: 'ravi', courierName: 'Speedy' });
    expect(startingChoice({ method: 'MANUAL' }, ['PORTER', 'MANUAL'], [])).toEqual({ method: 'MANUAL', riderUid: '', courierName: '' });
    expect(startingChoice({}, [], [])).toEqual({ method: 'OWN', riderUid: '', courierName: '' });
  });

  it('never remembers a courier app, a reference or a tracking link', () => {
    const own = withDispatch({}, { method: 'OWN', riderUid: 'ravi', courierName: 'typed but unused' });
    expect(own).toEqual({ method: 'OWN', riderUid: 'ravi' });
    // A paid booking must be chosen each time: the method and rider remembered before stay as they were.
    expect(withDispatch(own, { method: 'PORTER' as DeliveryMethod, riderUid: null, courierName: '' })).toEqual(own);
    expect(withDispatch(own, { method: 'MANUAL', riderUid: null, courierName: '  Speedy Couriers ' })).toEqual({ method: 'MANUAL', riderUid: 'ravi', courierName: 'Speedy Couriers' });
  });

  it('reads nothing from a stored value that is damaged, of another shape, or out of reach', () => {
    const key = 'stories.dispatch.o1.b1';
    localStorage.setItem(key, '{not json');
    expect(readLastDispatch('o1', 'b1')).toEqual({});
    localStorage.setItem(key, JSON.stringify(['OWN', 'ravi']));
    expect(readLastDispatch('o1', 'b1')).toEqual({});
    localStorage.setItem(key, JSON.stringify({ method: 'PORTER', riderUid: 7, courierName: { name: 'x' }, reference: 'AWB1' }));
    expect(readLastDispatch('o1', 'b1')).toEqual({});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLastDispatch('o1', 'b1')).toEqual({});
    expect(() => saveLastDispatch('o1', 'b1', { method: 'OWN', riderUid: 'ravi' })).not.toThrow();
  });
});

describe('which visits can go out together', () => {
  it('takes pickups and visits whose books were reserved, not a request by note or a visit already out', () => {
    expect(canJoinRun(visit('a', { kind: 'PICKUP' }))).toBe(true);
    expect(canJoinRun(visit('b', { holdIds: ['h1'] }))).toBe(true);
    expect(canJoinRun(visit('c', { kind: 'EXCHANGE', holdIds: ['h1'] }))).toBe(true);
    expect(canJoinRun(visit('d'))).toBe(false);
    expect(canJoinRun(visit('e', { kind: 'EXCHANGE' }))).toBe(false);
    expect(canJoinRun(visit('f', { kind: 'PICKUP', status: 'OUT' }))).toBe(false);
  });

  it('sends exactly the reserved books the visit was booked with, or asks for the visit to be opened', () => {
    const d = visit('a', { holdIds: ['h1', 'h2'] });
    expect(runBarcodes(d, [hold('h2'), hold('h1')])).toEqual(['C-h2', 'C-h1']);
    expect(runBarcodes(visit('p', { kind: 'PICKUP' }), [hold('h9')])).toEqual([]);
    // One lapsed, another became ready since, or its copy is not set aside: staff look at it.
    expect(runBarcodes(d, [hold('h1')])).toBeNull();
    expect(runBarcodes(d, [hold('h1'), hold('h2'), hold('h3')])).toBeNull();
    expect(runBarcodes(d, [hold('h1'), hold('h3')])).toBeNull();
    expect(runBarcodes(d, [hold('h1'), hold('h2', null)])).toBeNull();
    expect(runBarcodes(visit('n'), [])).toBeNull();
  });
});

describe('running several side by side', () => {
  it('keeps going after a failure, never runs more than the size at once, and answers in the order asked', async () => {
    let running = 0;
    let most = 0;
    const results = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      running--;
      if (n % 3 === 0) throw new Error(`no ${n}`);
      return n * 10;
    });
    expect(most).toBe(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message))).toEqual([10, 20, 'no 3', 40, 50, 'no 6', 70]);
    expect(await pool([], 3, async () => 1)).toEqual([]);
  });

  it('dispatches each ticked visit as its own call, skips one whose reserved books changed, and reports a refusal on its own visit', async () => {
    const visits = [visit('pick', { kind: 'PICKUP' }), visit('ok', { holdIds: ['h1'] }), visit('changed', { holdIds: ['h2'] }), visit('refused', { holdIds: ['h3'] })];
    const live: Record<string, ReadyHold[]> = { ok: [hold('h1')], changed: [hold('h2'), hold('h7')], refused: [hold('h3')] };
    const holds = vi.fn(async (id: string) => live[id]);
    const dispatch = vi.fn(async (id: string) => {
      if (id === 'refused') throw new ApiError('This plan allows 2 books at a time.', 'LIMIT_REACHED');
    });
    const result = await sendRun(visits, 'ravi', { holds, dispatch }, 'Open it');
    expect(result).toEqual({ sent: ['pick', 'ok'], problems: { changed: 'Open it', refused: 'This plan allows 2 books at a time.' } });
    // A pickup sends nothing and reads nothing; the changed visit is never dispatched.
    expect(holds.mock.calls.map((c) => c[0]).sort()).toEqual(['changed', 'ok', 'refused']);
    expect(dispatch.mock.calls.map((c) => c[0]).sort()).toEqual(['ok', 'pick', 'refused']);
    expect(dispatch).toHaveBeenCalledWith('pick', { barcodes: [], method: 'OWN', riderUid: 'ravi', courier: null, waiveFee: false });
    expect(dispatch).toHaveBeenCalledWith('ok', { barcodes: ['C-h1'], method: 'OWN', riderUid: 'ravi', courier: null, waiveFee: false });
  });

  it('receives each bag as its own call; one that someone else has just received counts as done', async () => {
    const bags = [visit('a'), visit('b'), visit('c')];
    const receive = vi.fn(async (id: string) => {
      if (id === 'b') throw new ApiError('There is nothing to receive for this delivery.', 'NOT_RETURNING');
      if (id === 'c') throw new ApiError('Copy was not found.', 'NOT_FOUND');
      return { returned: 2 };
    });
    expect(await receiveBags(bags, receive)).toEqual({ done: ['a', 'b'], books: 2, problems: { c: 'Copy was not found.' } });
    expect(receive).toHaveBeenCalledTimes(3);
  });
});

describe('the board', () => {
  it('opens on what waits to go out, else on the bags coming back; a tab in the address must be one of its own', () => {
    expect(landingTab([{ status: 'REQUESTED' }, { status: 'RETURNING' }])).toBe('REQUESTED');
    expect(landingTab([{ status: 'OUT' }, { status: 'RETURNING' }])).toBe('RETURNING');
    expect(landingTab([{ status: 'OUT' }])).toBe('REQUESTED');
    expect(landingTab([])).toBe('REQUESTED');
    expect(tabFrom('RETURNING')).toBe('RETURNING');
    expect(tabFrom('CLOSED')).toBe('CLOSED');
    expect(tabFrom('returning')).toBeNull();
    expect(tabFrom('COMPLETED')).toBeNull();
    expect(tabFrom(null)).toBeNull();
  });

  it('keeps bags together by who carries them: riders by account, not by name', () => {
    const rider = (uid: string, name = 'Ravi') => ({ uid, name, phone: null });
    const porter = { key: 'PORTER' } as Delivery['provider'];
    const groups = carrierGroups([
      visit('a', { rider: rider('r1') }),
      visit('b', { rider: rider('r2') }),
      visit('c', { provider: porter }),
      visit('d', { rider: rider('r1') }),
      visit('e', { courier: { name: 'Speedy', reference: '', trackingUrl: null } }),
      visit('f', { courier: { name: ' speedy ', reference: 'AWB2', trackingUrl: null } }),
      visit('g'),
    ]);
    expect(groups.map((g) => [g.key, g.name, g.bags.map((b) => b.id)])).toEqual([
      ['rider:r1', 'Ravi', ['a', 'd']],
      ['rider:r2', 'Ravi', ['b']],
      ['app:PORTER', null, ['c']],
      ['courier:speedy', 'Speedy', ['e', 'f']],
      ['other', null, ['g']],
    ]);
  });
});
