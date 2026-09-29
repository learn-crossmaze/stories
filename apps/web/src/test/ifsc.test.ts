import { afterEach, describe, expect, it, vi } from 'vitest';

import { branchLine, cleanIfsc, isIfsc, lookupIfsc } from '../shared/ifsc';

describe('IFSC', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('checks the format', () => {
    expect(cleanIfsc(' hdfc 0001234 ')).toBe('HDFC0001234');
    expect(isIfsc('hdfc0001234')).toBe(true);
    expect(isIfsc('HDFC1001234')).toBe(false);
    expect(isIfsc('HDFC000123')).toBe(false);
  });

  it('looks up the bank and branch, and remembers the answer', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ BANK: 'HDFC Bank', BRANCH: 'Koramangala', CITY: 'Bengaluru', STATE: 'Karnataka' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const r = await lookupIfsc('hdfc0000053');
    expect(r).toEqual({ found: true, details: { ifsc: 'HDFC0000053', bank: 'HDFC Bank', branch: 'Koramangala', city: 'Bengaluru', state: 'Karnataka' } });
    await lookupIfsc('HDFC0000053');
    expect(fetch).toHaveBeenCalledTimes(1);
    if (r.found) expect(branchLine(r.details)).toBe('Koramangala, Bengaluru, Karnataka');
  });

  it('tells not found from unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    expect(await lookupIfsc('SBIN0999999')).toEqual({ found: false });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await lookupIfsc('ICIC0000001')).toEqual({ found: null });
  });

  it('drops repeated parts of the branch line', () => {
    expect(branchLine({ ifsc: 'X', bank: 'B', branch: 'MUMBAI', city: 'Mumbai', state: 'Maharashtra' })).toBe('MUMBAI, Maharashtra');
  });
});
