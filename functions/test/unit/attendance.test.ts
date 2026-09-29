import { describe, expect, it } from 'vitest';

import { atIST, datesOfMonth, DEFAULT_RULES, evaluateDay, summarize, weekdayOf } from '../../src/hr/attendanceRules.js';

const shift = { start: '09:30', end: '18:00', breakMinutes: 30, graceMinutes: 10, halfDayMinutes: 240, fullDayMinutes: 480 };
const day = '2026-10-05'; // a Monday
const at = (t: string, d = day) => atIST(d, t);

describe('attendance rules', () => {
  it('knows the calendar', () => {
    expect(weekdayOf(day)).toBe('MON');
    expect(weekdayOf('2026-10-04')).toBe('SUN');
    expect(datesOfMonth('2026-02')).toHaveLength(28);
    expect(datesOfMonth('2028-02').at(-1)).toBe('2028-02-29');
  });

  it('a full day on time is present; the break is not worked time', () => {
    const r = evaluateDay({ date: day, rules: shift, checkIn: at('09:35'), checkOut: at('18:05'), weeklyOff: false, holiday: false });
    expect(r).toMatchObject({ status: 'PRESENT', late: false, lateMinutes: 5, earlyExit: false, workedMinutes: 480 });
  });

  it('late beyond the grace period, half day, and too short', () => {
    expect(evaluateDay({ date: day, rules: shift, checkIn: at('09:41'), checkOut: at('18:30'), weeklyOff: false, holiday: false })).toMatchObject({ status: 'PRESENT', late: true, lateMinutes: 11 });
    expect(evaluateDay({ date: day, rules: shift, checkIn: at('09:30'), checkOut: at('14:30'), weeklyOff: false, holiday: false })).toMatchObject({ status: 'HALF_DAY', earlyExit: true, workedMinutes: 270 });
    expect(evaluateDay({ date: day, rules: shift, checkIn: at('09:30'), checkOut: at('11:00'), weeklyOff: false, holiday: false })).toMatchObject({ status: 'ABSENT', workedMinutes: 60 });
  });

  it('open days, missed check-outs at month end, overnight shifts', () => {
    expect(evaluateDay({ date: day, rules: shift, checkIn: at('09:30'), checkOut: null, weeklyOff: false, holiday: false }).status).toBe('IN_PROGRESS');
    expect(evaluateDay({ date: day, rules: shift, checkIn: at('09:30'), checkOut: null, weeklyOff: false, holiday: false, closing: true })).toMatchObject({ status: 'HALF_DAY', missedCheckout: true });
    const night = { ...shift, start: '22:00', end: '06:00', breakMinutes: 0 };
    expect(evaluateDay({ date: day, rules: night, checkIn: at('22:00'), checkOut: at('06:00', '2026-10-06'), weeklyOff: false, holiday: false })).toMatchObject({ status: 'PRESENT', workedMinutes: 480, earlyExit: false });
  });

  it('no punches: holiday, weekly off or absent; working on an off day counts as present', () => {
    const base = { date: day, rules: DEFAULT_RULES, checkIn: null, checkOut: null };
    expect(evaluateDay({ ...base, weeklyOff: true, holiday: true }).status).toBe('HOLIDAY');
    expect(evaluateDay({ ...base, weeklyOff: true, holiday: false }).status).toBe('WEEKLY_OFF');
    expect(evaluateDay({ ...base, weeklyOff: false, holiday: false }).status).toBe('ABSENT');
    expect(evaluateDay({ date: day, rules: DEFAULT_RULES, checkIn: at('09:00'), checkOut: at('17:00'), weeklyOff: true, holiday: false }).status).toBe('PRESENT');
  });

  it('summarizes a month into payable days', () => {
    const d = (status: string, extra = {}) => ({ status, workedMinutes: 0, lateMinutes: 0, late: false, earlyExit: false, missedCheckout: false, ...extra }) as never;
    const s = summarize([d('PRESENT', { late: true, workedMinutes: 480 }), d('HALF_DAY', { missedCheckout: true }), d('ABSENT'), d('WEEKLY_OFF'), d('HOLIDAY')]);
    expect(s).toMatchObject({ present: 1, halfDays: 1, absent: 1, weeklyOffs: 1, holidays: 1, lateDays: 1, missedCheckouts: 1, workedMinutes: 480, payableDays: 3.5, days: 5 });
  });
});
