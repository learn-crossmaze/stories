// Which occasions fall on a day, by India's date (the visitor's own clock, read in India's time zone).
import type { Occasion } from './types';

/** What the date checks need from an occasion (the website's first, small script has only this). */
export type Schedule = Pick<Occasion, 'id' | 'when'>;

/** Each calendar occasion's dates ("2026-11-08"), from dates.json. */
export type DatesTable = Record<string, string[]>;

/** Picks each occasion's dates out of Google's calendar (dates.json `events`, keyed by Google's names). */
export function datesTable(events: Record<string, string[]>, list: Schedule[]): DatesTable {
  const table: DatesTable = {};
  for (const o of list)
    if ('calendar' in o.when) table[o.id] = [...new Set(o.when.calendar.flatMap((name) => events[name] ?? []))].sort();
  return table;
}

/** Today in India as "YYYY-MM-DD", whatever the visitor's time zone. */
export function indiaToday(now = new Date()) {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

/** The day of the month of the nth `weekday` (0 = Sunday) in a month. */
function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

/** Does an occasion fall on this day? */
export function fallsOn(o: Schedule, iso: string, dates: DatesTable) {
  const [y, m, d] = parts(iso);
  if ('fixed' in o.when) return o.when.fixed[0] === m && o.when.fixed[1] === d;
  if ('nth' in o.when) {
    const [nth, weekday, month] = o.when.nth;
    return month === m && nthWeekday(y, month, weekday, nth) === d;
  }
  return (dates[o.id] ?? []).includes(iso);
}

/** The occasions on a day, in list order. */
export const occasionsOn = <T extends Schedule>(iso: string, list: T[], dates: DatesTable) => list.filter((o) => fallsOn(o, iso, dates));

/** The next date (on or after `iso`) an occasion falls on, within the next three years; undefined if unknown. */
export function nextDate(o: Schedule, iso: string, dates: DatesTable) {
  if ('calendar' in o.when) return (dates[o.id] ?? []).find((d) => d >= iso);
  const [y] = parts(iso);
  for (let year = y; year <= y + 2; year++) {
    const [m, d] = 'fixed' in o.when ? o.when.fixed : [o.when.nth[2], nthWeekday(year, o.when.nth[2], o.when.nth[1], o.when.nth[0])];
    const date = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (date >= iso) return date;
  }
  return undefined;
}
