// Business dates in India (UTC+5:30), as 'YYYY-MM-DD' strings.
const IST = 330 * 60_000;
const DAY = 86_400_000;

/** Today's date in India. */
export const todayIST = (now = new Date()) => new Date(now.getTime() + IST).toISOString().slice(0, 10);
/** This month in India ('YYYY-MM'). */
export const monthIST = () => todayIST().slice(0, 7);
/** The date `n` days after `d` (before, when negative). */
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Whole days from today until `d` (negative once it has passed). */
export const daysUntil = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayIST()}T00:00:00Z`)) / DAY);
