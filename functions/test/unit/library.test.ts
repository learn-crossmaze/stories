import { describe, expect, it } from 'vitest';

import { normalizeIsbn } from '../../src/catalogue/isbn.js';
import { queryToken, searchTokens } from '../../src/catalogue/search.js';
import { addMonths } from '../../src/core/time.js';
import { canTransition, COPY_STATUSES } from '../../src/inventory/copyState.js';
import { ageOn, audienceFor, normalizePhone } from '../../src/members/model.js';
import { planOptions, priceFor } from '../../src/billing/plans.js';

describe('ISBN', () => {
  it('accepts valid ISBN-13 with or without hyphens', () => {
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
  });
  it('converts ISBN-10 to ISBN-13', () => {
    expect(normalizeIsbn('0-306-40615-2')).toBe('9780306406157');
  });
  it('rejects bad check digits and junk', () => {
    expect(normalizeIsbn('9780306406158')).toBeNull();
    expect(normalizeIsbn('0306406153')).toBeNull();
    expect(normalizeIsbn('hello')).toBeNull();
  });
});

describe('search tokens', () => {
  it('indexes words and prefixes, case and accent insensitive', () => {
    const t = searchTokens('Alice’s Adventures', 'Lewis Carroll');
    expect(t).toEqual(expect.arrayContaining(['alice', 'al', 'ali', 'adventures', 'adv', 'lewis', 'carroll', 'ca']));
    expect(searchTokens('Émile')).toContain('emile');
  });
  it('queries by the longest word, capped to the indexed prefix length', () => {
    expect(queryToken('the Jungle')).toBe('jungle');
    expect(queryToken('x')).toBeNull();
    expect(queryToken('extraordinarily')).toBe('extraordinar');
  });
});

describe('copy state machine', () => {
  it('rejects every transition not in the diagram', () => {
    const allowed = new Set([
      'AVAILABLE>RESERVED', 'AVAILABLE>ISSUED', 'AVAILABLE>IN_TRANSIT', 'AVAILABLE>UNDER_INSPECTION', 'AVAILABLE>DAMAGED', 'AVAILABLE>LOST', 'AVAILABLE>RETIRED',
      'RESERVED>AVAILABLE', 'RESERVED>ISSUED', 'ISSUED>UNDER_INSPECTION', 'ISSUED>LOST',
      'IN_TRANSIT>AVAILABLE', 'IN_TRANSIT>DAMAGED', 'IN_TRANSIT>UNDER_INSPECTION', 'UNDER_INSPECTION>AVAILABLE', 'UNDER_INSPECTION>DAMAGED',
      'DAMAGED>AVAILABLE', 'DAMAGED>RETIRED', 'DAMAGED>LOST', 'LOST>UNDER_INSPECTION', 'LOST>RETIRED',
    ]);
    for (const from of COPY_STATUSES) for (const to of COPY_STATUSES) {
      expect(canTransition(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
    }
  });
  it('never lets a retired copy come back', () => {
    for (const to of COPY_STATUSES) expect(canTransition('RETIRED', to)).toBe(false);
  });
});

describe('members', () => {
  it('computes age and audience', () => {
    const on = new Date('2026-09-27T00:00:00Z');
    expect(ageOn('2014-09-28', on)).toBe(11);
    expect(audienceFor(ageOn('2010-01-01', on))).toBe('TEENS');
    expect(audienceFor(ageOn('2008-09-27', on))).toBe('ADULTS');
  });
  it('normalizes Indian mobile numbers', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('dates and prices', () => {
  it('adds calendar months, clamping month ends', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2026-03-15T00:00:00Z'), 12).toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });
  it('applies promotional prices only inside their window (older single-option plans)', () => {
    const plan = { duration: 'MONTHLY', priceMinor: 50000, promo: { priceMinor: 40000, from: '2026-09-01', to: '2026-09-30' } } as Parameters<typeof priceFor>[0];
    expect(priceFor(plan, 'MONTHLY', new Date('2026-09-15T06:00:00Z')).priceMinor).toBe(40000);
    expect(priceFor(plan, 'MONTHLY', new Date('2026-10-01T06:00:00Z')).priceMinor).toBe(50000);
  });

  it('prices each billing option, with an amount or percentage discount in its window', () => {
    const options = [
      { duration: 'ANNUAL' as const, priceMinor: 300000 },
      { duration: 'MONTHLY' as const, priceMinor: 30000 },
      { duration: 'QUARTERLY' as const, priceMinor: 85000 },
    ];
    expect(planOptions({ options }).map((o) => o.duration)).toEqual(['MONTHLY', 'QUARTERLY', 'ANNUAL']);
    const during = new Date('2026-09-15T06:00:00Z');
    const pct = { options, discount: { type: 'PERCENT' as const, value: 15, from: '2026-09-01', to: '2026-09-30', durations: ['ANNUAL' as const], label: '' } };
    expect(priceFor(pct, 'ANNUAL', during)).toMatchObject({ months: 12, listPriceMinor: 300000, discountMinor: 45000, priceMinor: 255000, discountLabel: '15% off' });
    expect(priceFor(pct, 'MONTHLY', during)).toMatchObject({ discountMinor: 0, priceMinor: 30000, discountLabel: null });
    expect(priceFor(pct, 'ANNUAL', new Date('2026-10-02T06:00:00Z')).priceMinor).toBe(300000);
    // Percentages round to whole rupees.
    const odd = { options: [{ duration: 'MONTHLY' as const, priceMinor: 29900 }], discount: { type: 'PERCENT' as const, value: 10, from: '2026-09-01', to: '2026-09-30', durations: [], label: 'Diwali offer' } };
    expect(priceFor(odd, 'MONTHLY', during)).toMatchObject({ discountMinor: 3000, priceMinor: 26900, discountLabel: 'Diwali offer' });
    const amt = { options, discount: { type: 'AMOUNT' as const, value: 10000, from: '2026-09-01', to: '2026-09-30', durations: [], label: '' } };
    expect(priceFor(amt, 'QUARTERLY', during)).toMatchObject({ discountMinor: 10000, priceMinor: 75000, discountLabel: 'Rs. 100 off' });
    expect(() => priceFor(amt, 'HALF_YEARLY', during)).toThrow();
  });
});
