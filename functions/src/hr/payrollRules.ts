/**
 * Payroll arithmetic (docs/HRMS.md §10), free of Firestore so it can be unit
 * tested. Amounts are whole rupees per month. A month is 'YYYY-MM'.
 */

export interface Component {
  /** BASIC and DA make up PF wages; any other code is an allowance. */
  code: string;
  name: string;
  amount: number;
}

export interface SalaryStructure {
  effectiveFrom: string;
  earnings: Component[];
  /** Which statutory deductions apply to this employee. */
  pf: boolean;
  esi: boolean;
  pt: boolean;
}

export interface StatutorySettings {
  effectiveFrom: string;
  pf: {
    enabled: boolean;
    employeeRate: number;
    employerRate: number;
    /** Part of the employer share that goes to the pension scheme (EPS), on wages up to the ceiling. */
    epsRate: number;
    wageCeiling: number;
    /** Contributions on wages up to the ceiling only. */
    capAtCeiling: boolean;
  };
  esi: {
    enabled: boolean;
    employeeRate: number;
    employerRate: number;
    /** Employees whose monthly gross (by their salary structure) is at most this are covered. */
    grossLimit: number;
  };
  pt: {
    enabled: boolean;
    /** Monthly professional tax: the amount of the highest slab whose `from` the gross reaches. */
    slabs: { from: number; amount: number }[];
    /** Some states collect a different amount in February (e.g. 300); null = same as other months. */
    februaryAmount: number | null;
  };
}

/** Rates in force since 2014 (PF), 2019 (ESI) and Karnataka's slabs for PT; every organization can change them. */
export const DEFAULT_SETTINGS: StatutorySettings = {
  effectiveFrom: '2000-01',
  pf: { enabled: true, employeeRate: 12, employerRate: 12, epsRate: 8.33, wageCeiling: 15000, capAtCeiling: true },
  esi: { enabled: true, employeeRate: 0.75, employerRate: 3.25, grossLimit: 21000 },
  pt: { enabled: true, slabs: [{ from: 0, amount: 0 }, { from: 25000, amount: 200 }], februaryAmount: null },
};

export interface Adjustment {
  name: string;
  amount: number;
}

export interface MonthInputs {
  /** Income tax deducted at source, entered each month. */
  tds: number;
  otherEarnings: Adjustment[];
  otherDeductions: Adjustment[];
}

export const NO_INPUTS: MonthInputs = { tds: 0, otherEarnings: [], otherDeductions: [] };

export interface PayLine {
  earnings: (Component & { full: number })[];
  otherEarnings: Adjustment[];
  gross: number;
  pfWage: number;
  pfEmployee: number;
  pfEmployer: number;
  eps: number;
  epfEmployer: number;
  esiCovered: boolean;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  tds: number;
  otherDeductions: Adjustment[];
  deductions: number;
  net: number;
  /** Gross plus the employer's PF and ESI. */
  employerCost: number;
  /** Problems that stop the run being submitted. */
  problems: string[];
}

const PF_CODES = ['BASIC', 'DA'];
const pct = (n: number, rate: number) => (n * rate) / 100;
const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);

/** The version in force for a month: the latest `effectiveFrom` not after it. */
export function inForce<T extends { effectiveFrom: string }>(versions: T[], month: string): T | null {
  return versions.filter((v) => v.effectiveFrom <= month).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

export const monthlyGross = (s: Pick<SalaryStructure, 'earnings'>) => sum(s.earnings);

/** Professional tax on a month's gross. */
export function professionalTax(settings: StatutorySettings['pt'], gross: number, month: string): number {
  if (!settings.enabled || gross <= 0) return 0;
  const slab = [...settings.slabs].sort((a, b) => b.from - a.from).find((s) => gross >= s.from);
  if (!slab || !slab.amount) return 0;
  return month.endsWith('-02') && settings.februaryAmount !== null ? settings.februaryAmount : slab.amount;
}

/**
 * One employee's month. Structure earnings are paid for payable days out of
 * the days in the month (rounded to the rupee); other earnings are paid as
 * entered. PF is on earned basic and DA; ESI (rounded up, as ESIC does) on the
 * earned gross for employees whose structure gross is within the limit; PT by
 * slab on the month's gross; TDS as entered.
 */
export function computePay(input: { structure: SalaryStructure; settings: StatutorySettings; month: string; payableDays: number; daysInMonth: number; inputs: MonthInputs }): PayLine {
  const { structure, settings, month, inputs } = input;
  const ratio = input.daysInMonth > 0 ? Math.min(1, Math.max(0, input.payableDays / input.daysInMonth)) : 0;
  const earnings = structure.earnings.map((c) => ({ ...c, full: c.amount, amount: Math.round(c.amount * ratio) }));
  const earned = sum(earnings);
  const gross = earned + sum(inputs.otherEarnings);

  const pfOn = settings.pf.enabled && structure.pf;
  const pfWage = pfOn ? sum(earnings.filter((c) => PF_CODES.includes(c.code.toUpperCase()))) : 0;
  const pfBase = settings.pf.capAtCeiling ? Math.min(pfWage, settings.pf.wageCeiling) : pfWage;
  const pfEmployee = Math.round(pct(pfBase, settings.pf.employeeRate));
  const pfEmployer = Math.round(pct(pfBase, settings.pf.employerRate));
  const eps = Math.min(pfEmployer, Math.round(pct(Math.min(pfWage, settings.pf.wageCeiling), settings.pf.epsRate)));

  const esiCovered = settings.esi.enabled && structure.esi && monthlyGross(structure) <= settings.esi.grossLimit;
  const esiEmployee = esiCovered && earned > 0 ? Math.ceil(pct(earned, settings.esi.employeeRate)) : 0;
  const esiEmployer = esiCovered && earned > 0 ? Math.ceil(pct(earned, settings.esi.employerRate)) : 0;

  const pt = structure.pt ? professionalTax(settings.pt, gross, month) : 0;
  const tds = Math.round(inputs.tds);
  const deductions = pfEmployee + esiEmployee + pt + tds + sum(inputs.otherDeductions);
  const net = gross - deductions;
  const problems: string[] = [];
  if (net < 0) problems.push('Deductions are more than the pay for the month.');
  return {
    earnings,
    otherEarnings: inputs.otherEarnings,
    gross,
    pfWage,
    pfEmployee,
    pfEmployer,
    eps,
    epfEmployer: pfEmployer - eps,
    esiCovered,
    esiEmployee,
    esiEmployer,
    pt,
    tds,
    otherDeductions: inputs.otherDeductions,
    deductions,
    net,
    employerCost: gross + pfEmployer + esiEmployer,
    problems,
  };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', below100(n % 100)].filter(Boolean).join(' ');

/** Rupees in words, Indian style (lakh, crore): 125000 → "One Lakh Twenty Five Thousand". */
export function inWords(rupees: number): string {
  let n = Math.floor(Math.abs(rupees));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  for (const [size, label] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (n >= size) {
      parts.push(`${size === 10_000_000 ? inWords(Math.floor(n / size)) : below100(Math.floor(n / size))} ${label}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

/** ₹1,23,456 (Indian digit grouping). */
export const rupees = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-IN')}`;
