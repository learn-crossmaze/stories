import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The signed-in person's own employee record: several parts of one screen ask for it, and share one read
// for a minute. Also what the data layer asks for a person's own day (the rules need the account filter).
type Asked = { path: string; filters: { field: string; value: unknown }[] };
const world = vi.hoisted(() => ({
  asked: [] as Asked[],
  /** What the next read answers: documents, or an error to throw. */
  answer: (() => []) as (asked: Asked) => Record<string, unknown>[] | Error,
}));

vi.mock('../data/services', () => ({ services: () => ({ db: {}, fns: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: (_db: unknown, path: string) => ({ path }),
  query: (col: { path: string }, ...filters: unknown[]) => ({ path: col.path, filters }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  limit: (n: number) => ({ field: 'limit', value: n }),
  getDocs: async (q: Asked) => {
    world.asked.push(q);
    const docs = world.answer(q);
    if (docs instanceof Error) throw docs;
    return { empty: !docs.length, docs: docs.map((d) => ({ id: d.id as string, data: () => d })) };
  },
}));

const { forgetMyEmployee, myEmployee } = await import('../data/hr');
const { dayAfterPunch, myDay } = await import('../data/attendance');
const { onboardingChanged } = await import('../data/selfOnboarding');
const { useAsync } = await import('../shared/useAsync');

beforeEach(() => {
  vi.useFakeTimers();
  world.asked.length = 0;
  world.answer = () => [{ id: 'e1', fullName: 'Asha Rao', status: 'ACTIVE' }];
  forgetMyEmployee();
});
afterEach(() => vi.useRealTimers());

describe('myEmployee', () => {
  it('callers at the same moment, and within the minute, share one read', async () => {
    const [a, b] = await Promise.all([myEmployee('o1', 'u1'), myEmployee('o1', 'u1')]);
    expect(a).toMatchObject({ id: 'e1', fullName: 'Asha Rao' });
    expect(b).toBe(a);
    vi.advanceTimersByTime(59_000);
    await myEmployee('o1', 'u1');
    expect(world.asked).toHaveLength(1);
    expect(world.asked[0]).toMatchObject({ path: 'orgs/o1/employees', filters: [{ field: 'uid', value: 'u1' }, { field: 'limit', value: 1 }] });
  });

  it('reads again after a minute, and at once after forgetMyEmployee', async () => {
    await myEmployee('o1', 'u1');
    vi.advanceTimersByTime(61_000);
    await myEmployee('o1', 'u1');
    expect(world.asked).toHaveLength(2);
    forgetMyEmployee();
    world.answer = () => [{ id: 'e1', fullName: 'Asha Rao', photoUrl: 'new.jpg' }];
    expect(await myEmployee('o1', 'u1')).toMatchObject({ photoUrl: 'new.jpg' });
    expect(world.asked).toHaveLength(3);
  });

  it('does not keep a failed read, and keeps "no record" only for the minute', async () => {
    world.answer = () => new Error('offline');
    await expect(myEmployee('o1', 'u1')).rejects.toThrow('offline');
    world.answer = () => [];
    expect(await myEmployee('o1', 'u1')).toBeNull();
    expect(world.asked).toHaveLength(2);
    // Their account is linked to a record a little later.
    world.answer = () => [{ id: 'e9' }];
    expect(await myEmployee('o1', 'u1')).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect(await myEmployee('o1', 'u1')).toMatchObject({ id: 'e9' });
  });

  it('reads again once the person has saved something of their own (the "onboarding changed" signal)', async () => {
    expect(await myEmployee('o1', 'u1')).not.toHaveProperty('photoUrl');
    world.answer = () => [{ id: 'e1', fullName: 'Asha Rao', photoUrl: 'new.jpg' }];
    onboardingChanged();
    expect(await myEmployee('o1', 'u1')).toMatchObject({ photoUrl: 'new.jpg' });
    expect(world.asked).toHaveLength(2);
    // A read that was on its way when the signal came may hold the record as it was: it is not handed on.
    const early = myEmployee('o1', 'u2');
    onboardingChanged();
    const fresh = myEmployee('o1', 'u2');
    expect(fresh).not.toBe(early);
    await Promise.all([early, fresh]);
    expect(world.asked).toHaveLength(4);
  });

  it('a page that reloads its record and then gives the signal, as the photo does, shows the new record', async () => {
    vi.useRealTimers();
    const page = renderHook(() => useAsync(() => myEmployee('o1', 'u1'), []));
    await waitFor(() => expect(page.result.current.data).toMatchObject({ id: 'e1' }));
    world.answer = () => [{ id: 'e1', fullName: 'Asha Rao', photoUrl: 'new.jpg' }];
    act(() => {
      page.result.current.reload();
      onboardingChanged();
    });
    await waitFor(() => expect(page.result.current.data).toMatchObject({ photoUrl: 'new.jpg' }));
    expect(world.asked).toHaveLength(2);
  });

  it('keeps people and organizations apart', async () => {
    world.answer = (q) => [{ id: `${q.path}:${String(q.filters[0].value)}` }];
    expect((await myEmployee('o1', 'u1'))!.id).toBe('orgs/o1/employees:u1');
    expect((await myEmployee('o1', 'u2'))!.id).toBe('orgs/o1/employees:u2');
    expect((await myEmployee('o2', 'u1'))!.id).toBe('orgs/o2/employees:u1');
    expect(world.asked).toHaveLength(3);
  });
});

describe("the person's own day", () => {
  it('is asked for by account and date only (what the rules allow, with no index of its own)', async () => {
    world.answer = () => [{ id: 'e1_2026-11-12', date: '2026-11-12', status: 'IN_PROGRESS', checkIn: null, checkOut: null }];
    expect(await myDay('o1', 'u1', '2026-11-12')).toMatchObject({ id: 'e1_2026-11-12', status: 'IN_PROGRESS' });
    expect(world.asked[0]).toEqual({ path: 'orgs/o1/attendance', filters: [{ field: 'employeeUid', value: 'u1' }, { field: 'date', value: '2026-11-12' }, { field: 'limit', value: 1 }] });
    world.answer = () => [];
    expect(await myDay('o1', 'u1', '2026-11-13')).toBeNull();
  });

  it('is taken from what a punch answers, without reading it again', () => {
    const result = { date: '2026-11-12', status: 'PRESENT' as const, late: true, lateMinutes: 12, earlyExit: false, missedCheckout: false, workedMinutes: 480, checkIn: 1_800_000_000_000, checkOut: 1_800_000_030_000 };
    expect(dayAfterPunch(result, '2026-11-12')).toEqual({ ...result, checkIn: new Date(1_800_000_000_000), checkOut: new Date(1_800_000_030_000) });
    expect(dayAfterPunch({ ...result, status: 'IN_PROGRESS', checkOut: null }, '2026-11-12')).toMatchObject({ checkOut: null, late: true, lateMinutes: 12 });
    // A check-out that closed yesterday's overnight day: today has nothing recorded.
    expect(dayAfterPunch(result, '2026-11-13')).toBeNull();
    // An older backend answers without times: the day has to be read.
    expect(dayAfterPunch({ date: '2026-11-12', status: 'IN_PROGRESS', late: false } as never, '2026-11-12')).toBeUndefined();
  });
});
