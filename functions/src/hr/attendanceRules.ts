/**
 * Attendance arithmetic (docs/HRMS.md §8), kept free of Firestore so it can be
 * unit tested. All times are India time: a business date is 'YYYY-MM-DD' and a
 * shift time is 'HH:MM' on that date.
 */

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'WEEKLY_OFF' | 'HOLIDAY' | 'ON_LEAVE' | 'IN_PROGRESS';

/** Approved leave on a day: all of it, or half (the other half is worked or absent). */
export interface DayLeave {
  paid: boolean;
  half: boolean;
  typeId: string;
}

export interface ShiftRules {
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'; earlier than start = ends the next day
  breakMinutes: number;
  /** Minutes after the start that still count as on time. */
  graceMinutes: number;
  /** Least worked minutes for a half day and a full day. */
  halfDayMinutes: number;
  fullDayMinutes: number;
}

/** Used when an employee has no shift: no lateness, 8 hours for a full day. */
export const DEFAULT_RULES: ShiftRules = { start: '09:00', end: '17:00', breakMinutes: 0, graceMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 480 };

const IST_OFFSET_MS = 330 * 60_000;

/** Instant of 'HH:MM' India time on a business date. */
export const atIST = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:30`);

export const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T12:00:00+05:30`).getUTCDay()];

export const monthOf = (date: string) => date.slice(0, 7);

/** Every business date of a month ('YYYY-MM'). */
export function datesOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** The business date (India) of an instant. */
export const businessDate = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

export interface DayResult {
  status: DayStatus;
  /** Days paid for (0, 0.5 or 1). */
  payable: number;
  /** Leave taken that day (0, 0.5 or 1), and whether it was paid. */
  leaveDays: number;
  paidLeave: boolean;
  workedMinutes: number;
  lateMinutes: number;
  late: boolean;
  earlyExit: boolean;
  missedCheckout: boolean;
}

/**
 * Evaluates one day. Punches (epoch ms) take precedence: someone who works on
 * a weekly off or holiday is present. Without punches the day is a holiday,
 * a weekly off, or absent. `closing` treats a missing check-out as final (month
 * finalization): the day counts as a half day and is flagged.
 */
export function evaluateDay(input: {
  date: string;
  rules: ShiftRules;
  checkIn: number | null;
  checkOut: number | null;
  weeklyOff: boolean;
  holiday: boolean;
  closing?: boolean;
  leave?: DayLeave | null;
}): DayResult {
  const work = evaluateWork(input);
  const leave = input.leave ?? null;
  if (!leave) return work;
  const leaveDays = leave.half ? 0.5 : 1;
  const paidPart = leave.paid ? leaveDays : 0;
  if (!leave.half) {
    // A full day of leave; punches that day don't change it (cancel the leave instead).
    return { ...work, status: 'ON_LEAVE', payable: paidPart, leaveDays, paidLeave: leave.paid };
  }
  // Half a day of leave: the other half counts if at least half a day was worked.
  const worked = work.status === 'PRESENT' || work.status === 'HALF_DAY' ? 0.5 : 0;
  const status: DayStatus = work.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : worked ? 'HALF_DAY' : 'ON_LEAVE';
  return { ...work, status, payable: worked + paidPart, leaveDays, paidLeave: leave.paid };
}

const PAYABLE: Record<DayStatus, number> = { PRESENT: 1, HALF_DAY: 0.5, ABSENT: 0, WEEKLY_OFF: 1, HOLIDAY: 1, ON_LEAVE: 0, IN_PROGRESS: 0 };

function evaluateWork(input: {
  date: string;
  rules: ShiftRules;
  checkIn: number | null;
  checkOut: number | null;
  weeklyOff: boolean;
  holiday: boolean;
  closing?: boolean;
}): DayResult {
  const { date, rules, checkIn, checkOut } = input;
  const none = { workedMinutes: 0, lateMinutes: 0, late: false, earlyExit: false, missedCheckout: false, leaveDays: 0, paidLeave: false };
  const done = (status: DayStatus, rest: Partial<DayResult> = {}): DayResult => ({ ...none, ...rest, status, payable: PAYABLE[status] });
  if (checkIn === null) return done(input.holiday ? 'HOLIDAY' : input.weeklyOff ? 'WEEKLY_OFF' : 'ABSENT');
  const start = atIST(date, rules.start);
  let end = atIST(date, rules.end);
  if (end <= start) end += 86_400_000; // overnight shift
  const lateMinutes = Math.max(0, Math.floor((checkIn - start) / 60_000));
  const late = lateMinutes > rules.graceMinutes;
  if (checkOut === null) {
    if (!input.closing) return done('IN_PROGRESS', { lateMinutes, late });
    return done('HALF_DAY', { lateMinutes, late, missedCheckout: true });
  }
  const span = Math.max(0, Math.floor((checkOut - checkIn) / 60_000));
  const workedMinutes = Math.max(0, span - (span > rules.breakMinutes ? rules.breakMinutes : 0));
  const status: DayStatus = workedMinutes >= rules.fullDayMinutes ? 'PRESENT' : workedMinutes >= rules.halfDayMinutes ? 'HALF_DAY' : 'ABSENT';
  return done(status, { workedMinutes, lateMinutes, late, earlyExit: checkOut < end });
}

export interface MonthSummary {
  present: number;
  halfDays: number;
  absent: number;
  weeklyOffs: number;
  holidays: number;
  /** Leave days taken (half days count 0.5), and how many of them were paid. */
  leaveDays: number;
  paidLeaveDays: number;
  lateDays: number;
  missedCheckouts: number;
  workedMinutes: number;
  /** Days paid for: present, half days ÷ 2, weekly offs, holidays and paid leave. */
  payableDays: number;
  days: number;
}

export function summarize(days: DayResult[]): MonthSummary {
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  const sum = (f: (d: DayResult) => number) => days.reduce((n, d) => n + f(d), 0);
  return {
    present: count('PRESENT'),
    halfDays: count('HALF_DAY'),
    absent: count('ABSENT'),
    weeklyOffs: count('WEEKLY_OFF'),
    holidays: count('HOLIDAY'),
    leaveDays: sum((d) => d.leaveDays ?? 0),
    paidLeaveDays: sum((d) => (d.paidLeave ? (d.leaveDays ?? 0) : 0)),
    lateDays: days.filter((d) => d.late).length,
    missedCheckouts: days.filter((d) => d.missedCheckout).length,
    workedMinutes: sum((d) => d.workedMinutes),
    payableDays: sum((d) => d.payable ?? PAYABLE[d.status]),
    days: days.length,
  };
}
