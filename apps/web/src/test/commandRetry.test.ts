import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { name: string; data: Record<string, unknown> }[] = [];
let outcomes: (Error | unknown)[] = [];

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, router: string) => async (data: Record<string, unknown>) => {
    calls.push({ name: router, data });
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return { data: next };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));

const { command, isRetryable } = await import('../data/api');

const fail = (code: string, message = code) => new FirebaseError(`functions/${code}`, message);

beforeEach(() => {
  calls.length = 0;
  outcomes = [];
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
});

describe('command', () => {
  it('retries transient failures with the same requestId', async () => {
    outcomes = [fail('aborted', 'Busy'), fail('unavailable'), { ok: true }];
    await expect(command('books-create', { title: 'A' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.data.requestId)).size).toBe(1);
  });

  it('does not retry definite failures', async () => {
    outcomes = [fail('failed-precondition', 'Copy is on loan.')];
    await expect(command('books-create', { title: 'A' })).rejects.toThrow('Copy is on loan.');
    expect(calls).toHaveLength(1);
  });

  it('replays the same request when the user retries after an unknown outcome', async () => {
    outcomes = [fail('internal', 'internal'), fail('internal', 'internal'), fail('internal', 'internal')];
    await expect(command('copies-receive', { b: 2, a: 1 })).rejects.toBeTruthy();
    const first = calls[0].data.requestId;
    outcomes = [{ ok: true }];
    await command('copies-receive', { a: 1, b: 2 }); // same input, keys in another order
    expect(calls.at(-1)!.data.requestId).toBe(first);
    // Once settled, the next identical command is a new request.
    outcomes = [{ ok: true }];
    await command('copies-receive', { a: 1, b: 2 });
    expect(calls.at(-1)!.data.requestId).not.toBe(first);
  });

  it('uses a fresh requestId for different input', async () => {
    outcomes = [fail('deadline-exceeded'), fail('deadline-exceeded'), fail('deadline-exceeded'), { ok: true }];
    await expect(command('books-create', { title: 'A' })).rejects.toBeTruthy();
    await command('books-create', { title: 'B' });
    expect(calls.at(-1)!.data.requestId).not.toBe(calls[0].data.requestId);
  });

  it('treats only server-silent internal errors as a dropped connection', () => {
    expect(isRetryable(fail('internal', 'internal'))).toBe(true);
    expect(isRetryable(fail('internal', 'Something went wrong on our side. Please try again.'))).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
  });
});
