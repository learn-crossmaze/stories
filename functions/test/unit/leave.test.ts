import { describe, expect, it } from 'vitest';

import { datesBetween, DEFAULT_LEAVE_TYPES, leaveDays, monthlyCredit, yearlyCredit } from '../../src/hr/leaveRules.js';

describe('leave rules', () => {
  it('credits a twelfth each month, or the year up front with a share for joiners', () => {
    expect(monthlyCredit(DEFAULT_LEAVE_TYPES.earned)).toBe(1.25);
    expect(monthlyCredit(DEFAULT_LEAVE_TYPES.casual)).toBe(1);
    expect(yearlyCredit(DEFAULT_LEAVE_TYPES.sick, '2026', null)).toBe(12);
    expect(yearlyCredit(DEFAULT_LEAVE_TYPES.sick, '2026', '2024-05-10')).toBe(12);
    expect(yearlyCredit(DEFAULT_LEAVE_TYPES.sick, '2026', '2026-07-01')).toBe(6); // July–December
    expect(yearlyCredit({ annualQuota: 7 }, '2026', '2026-10-15')).toBe(1.5); // 7 × 3/12 = 1.75 → 1.5
    expect(yearlyCredit(DEFAULT_LEAVE_TYPES.sick, '2026', '2027-01-01')).toBe(0);
  });

  it('counts leave days without weekly offs and holidays', () => {
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    // Fri 2 Oct is a holiday, Sun 4 Oct a weekly off.
    const r = leaveDays('2026-10-01', '2026-10-05', ['SUN'], new Set(['2026-10-02']), false);
    expect(r).toEqual({ dates: ['2026-10-01', '2026-10-03', '2026-10-05'], days: 3 });
    expect(leaveDays('2026-10-05', '2026-10-05', ['SUN'], new Set(), true)).toEqual({ dates: ['2026-10-05'], days: 0.5 });
    expect(leaveDays('2026-10-04', '2026-10-04', ['SUN'], new Set(), false).days).toBe(0);
  });
});
