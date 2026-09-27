/** Adds calendar months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Calendar date in India (branch-local business day), e.g. 2026-09-27. */
export function dateKeyIST(date: Date): string {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
