/**
 * Leave arithmetic (docs/HRMS.md §9), free of Firestore so it can be unit
 * tested. The leave year is the calendar year; dates are India business dates.
 */
import { type Weekday, weekdayOf } from './attendanceRules.js';

export interface LeaveType {
  name: string;
  /** Short code shown in tables (CL, SL…). */
  code: string;
  paid: boolean;
  /** Days a year; 0 with `unlimited` for unpaid leave that needs no balance. */
  annualQuota: number;
  /**
   * MONTHLY: a twelfth of the quota each month; YEARLY: the quota each January
   * (joiners get a share); MANUAL: never credited automatically, HR grants days
   * when needed (maternity, bereavement).
   */
  accrual: 'MONTHLY' | 'YEARLY' | 'MANUAL';
  /** Unused days carried into the next year, at most. */
  carryForwardMax: number;
  allowHalfDay: boolean;
  /** No balance is kept or checked (loss of pay). */
  unlimited: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

export const DEFAULT_LEAVE_TYPES: Record<string, LeaveType> = {
  casual: { name: 'Casual leave', code: 'CL', paid: true, annualQuota: 12, accrual: 'MONTHLY', carryForwardMax: 0, allowHalfDay: true, unlimited: false, status: 'ACTIVE' },
  sick: { name: 'Sick leave', code: 'SL', paid: true, annualQuota: 12, accrual: 'YEARLY', carryForwardMax: 0, allowHalfDay: true, unlimited: false, status: 'ACTIVE' },
  earned: { name: 'Earned leave', code: 'EL', paid: true, annualQuota: 15, accrual: 'MONTHLY', carryForwardMax: 30, allowHalfDay: false, unlimited: false, status: 'ACTIVE' },
  lop: { name: 'Loss of pay', code: 'LOP', paid: false, annualQuota: 0, accrual: 'YEARLY', carryForwardMax: 0, allowHalfDay: true, unlimited: true, status: 'ACTIVE' },
};

/** Rounds to 2 decimals (1.25 days a month for 15 a year). */
export const days2 = (n: number) => Math.round(n * 100) / 100;

/** A month's credit for a MONTHLY type. */
export const monthlyCredit = (t: Pick<LeaveType, 'annualQuota'>) => days2(t.annualQuota / 12);

/**
 * A YEARLY type's credit for `year`, given when the employee joined: the full
 * quota, or for someone joining that year a share for the months left
 * (counting the joining month), rounded down to the half day.
 */
export function yearlyCredit(t: Pick<LeaveType, 'annualQuota'>, year: string, joiningDate: string | null): number {
  if (!joiningDate || joiningDate.slice(0, 4) < year) return t.annualQuota;
  if (joiningDate.slice(0, 4) > year) return 0;
  const monthsLeft = 12 - Number(joiningDate.slice(5, 7)) + 1;
  return Math.floor(((t.annualQuota * monthsLeft) / 12) * 2) / 2;
}

/** Days from `from` to `to` inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * The days a leave request uses: every date in the range except weekly offs
 * and holidays. A half-day request is one date counting 0.5.
 */
export function leaveDays(from: string, to: string, weeklyOffs: Weekday[], holidays: Set<string>, halfDay: boolean): { dates: string[]; days: number } {
  const dates = datesBetween(from, to).filter((d) => !weeklyOffs.includes(weekdayOf(d)) && !holidays.has(d));
  return { dates, days: halfDay ? dates.length * 0.5 : dates.length };
}
