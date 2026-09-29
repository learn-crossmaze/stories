import { describe, expect, it } from 'vitest';

import { addDays, daysUntil, todayIST } from '../shared/dates';
import { money, rupees } from '../shared/format';

describe('dates in India', () => {
  it('uses the Indian date, not the UTC one', () => {
    // 20:00 UTC is 01:30 the next day in India.
    expect(todayIST(new Date('2026-09-29T20:00:00Z'))).toBe('2026-09-30');
    expect(todayIST(new Date('2026-09-29T18:00:00Z'))).toBe('2026-09-29');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days until a date', () => {
    expect(daysUntil(todayIST())).toBe(0);
    expect(daysUntil(addDays(todayIST(), 5))).toBe(5);
    expect(daysUntil(addDays(todayIST(), -3))).toBe(-3);
  });
});

describe('money', () => {
  it('formats paise and whole rupees', () => {
    expect(money(150000)).toBe('₹1,500');
    expect(money(12550)).toBe('₹125.50');
    expect(rupees(125000)).toBe('₹1,25,000');
  });
});
