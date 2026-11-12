import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { oneOf, remember } from '../shared/remember';

const AGES = ['CHILDREN', 'TEENS', 'ADULTS'] as const;
type Receive = { locationId: string; ageGroup: (typeof AGES)[number] };
const isReceive = (v: unknown): v is Receive =>
  typeof v === 'object' && v !== null && typeof (v as Receive).locationId === 'string' && oneOf(AGES)((v as Receive).ageGroup);

describe('remember', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('names keys for the organization and branch a choice belongs to', () => {
    expect(remember.key('receive', 'o1', 'b1')).toBe('stories.receive.o1.b1');
    expect(remember.key('receive', 'o1')).toBe('stories.receive.o1');
  });

  it('gives back what was stored, per key', () => {
    const key = remember.key('receive', 'o1', 'b1');
    remember.set(key, { locationId: 'L1', ageGroup: 'CHILDREN' });
    expect(remember.get(key, { locationId: '', ageGroup: 'ADULTS' }, isReceive)).toEqual({ locationId: 'L1', ageGroup: 'CHILDREN' });
    expect(remember.get(remember.key('receive', 'o1', 'b2'), 'ADULTS', oneOf(AGES))).toBe('ADULTS');
  });

  it('falls back when the stored value is not what the caller accepts', () => {
    const key = remember.key('rider', 'o1', 'b1');
    remember.set(key, 'u-gone');
    expect(remember.get(key, 'u1', oneOf(['u1', 'u2']))).toBe('u1');
    remember.set(key, 'u2');
    expect(remember.get(key, 'u1', oneOf(['u1', 'u2']))).toBe('u2');
    remember.set(key, { ageGroup: 'TODDLERS', locationId: 'L1' });
    expect(remember.get(key, null, (v): v is Receive | null => isReceive(v))).toBeNull();
    remember.set(key, 7);
    expect(remember.get(key, 'u1', oneOf(['u1', 'u2']))).toBe('u1');
  });

  it('falls back on text that is not JSON, and when the guard itself fails', () => {
    localStorage.setItem('stories.rider.o1.b1', '{broken');
    expect(remember.get('stories.rider.o1.b1', 'u1', oneOf(['u1']))).toBe('u1');
    remember.set('k', 'x');
    expect(
      remember.get('k', 'fallback', (v): v is string => {
        throw new Error(`cannot check ${String(v)}`);
      }),
    ).toBe('fallback');
  });

  it('forgets a choice set to undefined', () => {
    remember.set('k', 'u1');
    remember.set('k', undefined);
    expect(localStorage.getItem('k')).toBeNull();
    expect(remember.get('k', 'none', oneOf(['u1']))).toBe('none');
  });

  it('never throws when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => remember.set('k', 'u1')).not.toThrow();
    expect(() => remember.set('k', undefined)).not.toThrow();
    expect(remember.get('k', 'u1', oneOf(['u1']))).toBe('u1');
  });

  it('never throws on a value that cannot be written as JSON', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => remember.set('k', loop)).not.toThrow();
    expect(localStorage.getItem('k')).toBeNull();
  });
});
