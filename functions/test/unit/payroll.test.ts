import { describe, expect, it } from 'vitest';

import { computePay, DEFAULT_SETTINGS, inForce, inWords, NO_INPUTS, professionalTax, type SalaryStructure } from '../../src/hr/payrollRules.js';

const structure = (basic: number, hra: number, special: number, extra: Partial<SalaryStructure> = {}): SalaryStructure => ({
  effectiveFrom: '2026-04',
  earnings: [
    { code: 'BASIC', name: 'Basic', amount: basic },
    { code: 'HRA', name: 'House rent allowance', amount: hra },
    { code: 'SPECIAL', name: 'Special allowance', amount: special },
  ],
  pf: true,
  esi: true,
  pt: true,
  ...extra,
});
const month = { month: '2026-09', daysInMonth: 30, settings: DEFAULT_SETTINGS };

describe('payroll rules', () => {
  it('picks the version in force for a month', () => {
    const v = [{ effectiveFrom: '2025-04' }, { effectiveFrom: '2026-04' }, { effectiveFrom: '2026-10' }];
    expect(inForce(v, '2026-09')?.effectiveFrom).toBe('2026-04');
    expect(inForce(v, '2026-10')?.effectiveFrom).toBe('2026-10');
    expect(inForce(v, '2025-01')).toBeNull();
  });

  it('a full month above the ESI limit: PF capped at the ceiling, PT by slab, TDS as entered', () => {
    const line = computePay({ ...month, structure: structure(20000, 8000, 7000), payableDays: 30, inputs: { ...NO_INPUTS, tds: 1500 } });
    expect(line).toMatchObject({ gross: 35000, pfWage: 20000, pfEmployee: 1800, pfEmployer: 1800, eps: 1250, epfEmployer: 550, esiCovered: false, esiEmployee: 0, pt: 200, tds: 1500 });
    expect(line.deductions).toBe(1800 + 200 + 1500);
    expect(line.net).toBe(35000 - 3500);
    expect(line.employerCost).toBe(36800);
  });

  it('prorates for payable days; ESI covers low salaries and rounds up', () => {
    const line = computePay({ ...month, structure: structure(9000, 3600, 2400), payableDays: 27.5, inputs: NO_INPUTS });
    expect(line.earnings.map((e) => e.amount)).toEqual([8250, 3300, 2200]);
    expect(line).toMatchObject({ gross: 13750, pfEmployee: 990, esiCovered: true, esiEmployee: 104, esiEmployer: 447, pt: 0 });
    expect(line.net).toBe(13750 - 990 - 104);
  });

  it('other earnings and deductions, opt-outs, and a month with no pay', () => {
    const line = computePay({
      ...month,
      structure: structure(15000, 6000, 4000, { pf: false, pt: false }),
      payableDays: 30,
      inputs: { tds: 0, otherEarnings: [{ name: 'Festival bonus', amount: 5000 }], otherDeductions: [{ name: 'Advance recovery', amount: 2000 }] },
    });
    expect(line).toMatchObject({ gross: 30000, pfEmployee: 0, pt: 0, deductions: 2000, net: 28000 });
    const none = computePay({ ...month, structure: structure(15000, 6000, 4000), payableDays: 0, inputs: { ...NO_INPUTS, tds: 100 } });
    expect(none).toMatchObject({ gross: 0, pfEmployee: 0, esiEmployee: 0, pt: 0, net: -100 });
    expect(none.problems).toHaveLength(1);
  });

  it('professional tax slabs and February', () => {
    const pt = { enabled: true, slabs: [{ from: 0, amount: 0 }, { from: 7500, amount: 175 }, { from: 10000, amount: 200 }], februaryAmount: 300 };
    expect(professionalTax(pt, 7000, '2026-09')).toBe(0);
    expect(professionalTax(pt, 8000, '2026-09')).toBe(175);
    expect(professionalTax(pt, 50000, '2026-09')).toBe(200);
    expect(professionalTax(pt, 50000, '2027-02')).toBe(300);
    expect(professionalTax({ ...pt, enabled: false }, 50000, '2026-09')).toBe(0);
  });

  it('writes rupees in words', () => {
    expect(inWords(0)).toBe('Zero');
    expect(inWords(31500)).toBe('Thirty One Thousand Five Hundred');
    expect(inWords(125000)).toBe('One Lakh Twenty Five Thousand');
    expect(inWords(12_34_56_789)).toBe('Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
  });
});
