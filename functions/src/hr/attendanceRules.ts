/**
 * Attendance arithmetic (docs/HRMS.md §8), kept free of Firestore so it can be
 * unit tested. All times are India time: a business date is 'YYYY-MM-DD' and a
 * shift time is 'HH:MM' on that date.
 */

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'WEEKLY_OFF' | 'HOLIDAY' | 'IN_PROGRESS';

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
}): DayResult {
  const { date, rules, checkIn, checkOut } = input;
  const none = { workedMinutes: 0, lateMinutes: 0, late: false, earlyExit: false, missedCheckout: false };
  if (checkIn === null) {
    return { ...none, status: input.holiday ? 'HOLIDAY' : input.weeklyOff ? 'WEEKLY_OFF' : 'ABSENT' };
  }
  const start = atIST(date, rules.start);
  let end = atIST(date, rules.end);
  if (end <= start) end += 86_400_000; // overnight shift
  const lateMinutes = Math.max(0, Math.floor((checkIn - start) / 60_000));
  const late = lateMinutes > rules.graceMinutes;
  if (checkOut === null) {
    if (!input.closing) return { ...none, status: 'IN_PROGRESS', lateMinutes, late };
    return { ...none, status: 'HALF_DAY', lateMinutes, late, missedCheckout: true };
  }
  const span = Math.max(0, Math.floor((checkOut - checkIn) / 60_000));
  const workedMinutes = Math.max(0, span - (span > rules.breakMinutes ? rules.breakMinutes : 0));
  const status: DayStatus = workedMinutes >= rules.fullDayMinutes ? 'PRESENT' : workedMinutes >= rules.halfDayMinutes ? 'HALF_DAY' : 'ABSENT';
  return { status, workedMinutes, lateMinutes, late, earlyExit: checkOut < end, missedCheckout: false };
}

export interface MonthSummary {
  present: number;
  halfDays: number;
  absent: number;
  weeklyOffs: number;
  holidays: number;
  lateDays: number;
  missedCheckouts: number;
  workedMinutes: number;
  /** Days paid for: present + half days ÷ 2 + weekly offs + holidays (paid leave joins in Phase 4). */
  payableDays: number;
  days: number;
}

export function summarize(days: DayResult[]): MonthSummary {
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  const s = {
    present: count('PRESENT'),
    halfDays: count('HALF_DAY'),
    absent: count('ABSENT'),
    weeklyOffs: count('WEEKLY_OFF'),
    holidays: count('HOLIDAY'),
    lateDays: days.filter((d) => d.late).length,
    missedCheckouts: days.filter((d) => d.missedCheckout).length,
    workedMinutes: days.reduce((n, d) => n + d.workedMinutes, 0),
    days: days.length,
  };
  return { ...s, payableDays: s.present + s.halfDays / 2 + s.weeklyOffs + s.holidays };
}
