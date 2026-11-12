import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { name: string; data: Record<string, unknown> }[] = [];
let outcomes: (Error | unknown)[] = [];
let servicesReady = true;

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => async (data: Record<string, unknown>) => {
    calls.push({ name, data });
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return { data: next };
  },
}));
vi.mock('../data/services', () => ({
  services: () => {
    if (!servicesReady) throw new Error('Firebase services are not initialized');
    return { fns: {}, db: {} };
  },
}));

const { call, command, resetBackendState, warm } = await import('../data/api');

const fail = (code: string, message = code, details?: unknown) => Object.assign(new FirebaseError(`functions/${code}`, message), details === undefined ? {} : { details });
/** What the SDK reports when the function is not deployed: outside a browser, and in one (the 404 cannot be read there). */
const missing = () => fail('not-found', 'not-found [404]');
const noAnswer = () => fail('internal', 'internal [0]');
const names = () => calls.map((c) => c.name);
const MINUTE = 60_000;

beforeEach(() => {
  calls.length = 0;
  outcomes = [];
  servicesReady = true;
  resetBackendState();
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
});

describe('the one backend function', () => {
  it('serves every action, whatever its area', async () => {
    outcomes = [{ ok: 1 }, { ok: 2 }, { ok: 3 }];
    await expect(call('books-get', { bookId: 'b1' })).resolves.toEqual({ ok: 1 });
    await command('payments-recordOffline', { amount: 100 });
    await command('attendance-punch', {});
    expect(names()).toEqual(['api', 'api', 'api']);
    expect(calls[0].data).toEqual({ action: 'books-get', bookId: 'b1' });
    expect(calls[1].data).toMatchObject({ action: 'payments-recordOffline', amount: 100, requestId: expect.any(String) });
  });

  it('an action the backend does not know is still explained as an older backend', async () => {
    outcomes = [fail('not-found', 'Unknown action. [404]')];
    await expect(call('books-brandNew', {})).rejects.toMatchObject({ reason: 'SERVER_OUTDATED' });
    expect(names()).toEqual(['api']);
  });
});

describe('while the backend is older than the app', () => {
  it('sends the same request once more to the older router, then stays with the older routers', async () => {
    outcomes = [missing(), { loanId: 'l1' }, { ok: true }];
    await expect(command('circulation-issue', { copyId: 'c1' })).resolves.toEqual({ loanId: 'l1' });
    expect(names()).toEqual(['api', 'circulation']);
    expect(calls[1].data).toEqual(calls[0].data); // same requestId: the command cannot run twice
    await call('books-get', {});
    expect(names()).toEqual(['api', 'circulation', 'catalogue']);
  });

  it('does the same in a browser, where a missing function looks like a request with no answer', async () => {
    outcomes = [noAnswer(), { ok: true }];
    await expect(command('members-register', { name: 'A' })).resolves.toEqual({ ok: true });
    expect(names()).toEqual(['api', 'members']);
    expect(calls[1].data.requestId).toBe(calls[0].data.requestId);
  });

  it('looks for the new function again after about 5 minutes, and never falls back once it has answered', async () => {
    outcomes = [missing(), {}, {}];
    await call('books-get', {});
    await call('books-get', {});
    expect(names()).toEqual(['api', 'catalogue', 'catalogue']);

    vi.setSystemTime(Date.now() + 5 * MINUTE + 1000);
    outcomes = [missing(), {}]; // still not there: back to the older router for another while
    await call('books-get', {});
    expect(names().slice(3)).toEqual(['api', 'catalogue']);

    vi.setSystemTime(Date.now() + 5 * MINUTE + 1000);
    outcomes = [{}, noAnswer()]; // the backend has been updated meanwhile
    await call('books-get', {});
    await expect(call('books-get', {})).rejects.toMatchObject({ reason: 'INTERNAL' });
    expect(names().slice(5)).toEqual(['api', 'api']);
  });

  it('passes on what the older router answers, and remembers that it is there', async () => {
    outcomes = [missing(), fail('permission-denied', "You don't have permission to perform this action. [403]", { reason: 'FORBIDDEN' }), {}];
    await expect(call('payments-list', {})).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    await call('plans-list', {});
    expect(names()).toEqual(['api', 'billing', 'billing']);
  });

  it('reports the first failure when neither function answers, and remembers nothing', async () => {
    outcomes = [missing(), noAnswer(), {}];
    await expect(call('books-get', {})).rejects.toMatchObject({ reason: 'SERVER_OUTDATED' });
    await call('books-get', {});
    expect(names()).toEqual(['api', 'catalogue', 'api']);
  });

  it('reports a dropped connection on the older router as it is, so a command is retried', async () => {
    outcomes = [missing(), fail('unavailable', 'unavailable [503]'), missing(), { ok: true }];
    await expect(command('copies-add', { n: 1 })).resolves.toEqual({ ok: true });
    expect(names()).toEqual(['api', 'inventory', 'api', 'inventory']);
    expect(new Set(calls.map((c) => c.data.requestId)).size).toBe(1);
  });

  it('has no older router to try for an action it cannot place', async () => {
    outcomes = [missing()];
    await expect(call('nope-x', {})).rejects.toMatchObject({ reason: 'SERVER_OUTDATED' });
    expect(names()).toEqual(['api']);
  });
});

describe('once the backend function has answered', () => {
  it('a request with no answer is a dropped connection: retried on the same function, never on an older one', async () => {
    outcomes = [{}, noAnswer(), noAnswer(), noAnswer()];
    await call('books-get', {});
    await expect(command('copies-receive', { a: 1 })).rejects.toBeTruthy();
    expect(names()).toEqual(['api', 'api', 'api', 'api']);
  });

  it('an error of its own counts as an answer too', async () => {
    outcomes = [fail('not-found', 'Book was not found. [404]', { reason: 'NOT_FOUND' }), missing()];
    await expect(call('books-get', {})).rejects.toMatchObject({ reason: 'NOT_FOUND', message: 'Book was not found.' });
    await expect(call('books-get', {})).rejects.toMatchObject({ reason: 'SERVER_OUTDATED' });
    expect(names()).toEqual(['api', 'api']);
  });
});

describe('warm', () => {
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('sends one ping, then nothing more for 10 minutes', async () => {
    outcomes = [{ ok: true }, { ok: true }];
    warm();
    warm();
    await settle();
    expect(calls).toEqual([{ name: 'api', data: { action: 'ping' } }]);
    vi.setSystemTime(Date.now() + 9 * MINUTE);
    warm();
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2 * MINUTE);
    warm();
    expect(calls).toHaveLength(2);
  });

  it('never fails, and tries again after a ping that did not get through', async () => {
    outcomes = [noAnswer(), fail('not-found', 'Unknown action. [404]'), { ok: true }];
    expect(() => warm()).not.toThrow();
    await settle();
    warm();
    await settle();
    warm();
    await settle();
    expect(names()).toEqual(['api', 'api', 'api']);
    warm();
    expect(calls).toHaveLength(3);
  });

  it('does nothing, quietly, before Firebase is set up', async () => {
    servicesReady = false;
    expect(() => warm()).not.toThrow();
    expect(calls).toHaveLength(0);
    servicesReady = true;
    warm();
    expect(calls).toHaveLength(1);
  });

  it('is not needed after a real call has just been answered', async () => {
    outcomes = [{ ok: true }];
    await command('members-register', { name: 'A' });
    warm();
    expect(names()).toEqual(['api']);
    vi.setSystemTime(Date.now() + 11 * MINUTE);
    warm();
    expect(names()).toEqual(['api', 'api']);
  });

  it('a ping that got through shows the function is there', async () => {
    outcomes = [{ ok: true }, noAnswer()];
    warm();
    await settle();
    await expect(call('books-get', {})).rejects.toBeTruthy();
    expect(names()).toEqual(['api', 'api']);
  });

  it('is skipped while the older routers are in use (there is nothing to wake)', async () => {
    outcomes = [missing(), {}];
    await call('books-get', {});
    warm();
    expect(names()).toEqual(['api', 'catalogue']);
  });
});
