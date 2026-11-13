import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The built-in letter wording is the same on every call: it is asked for once per organization.
const calls: { action: string; orgId: string }[] = [];
let fail = false;
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: { action: string; orgId: string }) => {
    calls.push(data);
    if (fail) throw Object.assign(new FirebaseError('functions/permission-denied', 'Not allowed.'), { details: { reason: 'FORBIDDEN' } });
    return { data: { builtIn: {}, placeholders: { fullName: 'Full name' } } };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));

const { resetBackendState } = await import('../data/api');
const { templateDefaults } = await import('../data/letterTemplates');

beforeEach(() => {
  calls.length = 0;
  fail = false;
  resetBackendState();
});

describe('templateDefaults', () => {
  it('asks the server once per organization, also when two screens ask together', async () => {
    const [a, b] = await Promise.all([templateDefaults('org-a'), templateDefaults('org-a')]);
    expect(a).toBe(b);
    expect(await templateDefaults('org-a')).toBe(a);
    expect(calls.map((c) => c.orgId)).toEqual(['org-a']);
    // Another organization is checked on its own.
    await templateDefaults('org-b');
    expect(calls.map((c) => [c.action, c.orgId])).toEqual([
      ['letterTemplates-defaults', 'org-a'],
      ['letterTemplates-defaults', 'org-b'],
    ]);
  });

  it('forgets a failed call, so Retry asks again', async () => {
    fail = true;
    await expect(templateDefaults('org-c')).rejects.toThrow('Not allowed.');
    fail = false;
    await expect(templateDefaults('org-c')).resolves.toMatchObject({ placeholders: { fullName: 'Full name' } });
    expect(calls).toHaveLength(2);
  });
});
