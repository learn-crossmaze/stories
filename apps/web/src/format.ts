// Display formatting (en-IN). Amounts are stored in paise.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const money = (minor: number) => inr.format(minor / 100).replace(/\.00$/, '');
export const toMinor = (rupees: string) => Math.round(Number(rupees.replace(/[₹,\s]/g, '')) * 100);

/** Firestore Timestamp, Date, or an ISO date string (member data from the server). */
const asDate = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : null;
};

export const day = (v: unknown) => {
  const d = asDate(v);
  return d ? dateFmt.format(d) : '—';
};
export const when = (v: unknown) => {
  const d = asDate(v);
  return d ? dateTimeFmt.format(d) : '—';
};

/** "12 days" style duration since a timestamp (borrowing has no due date; this is informational). */
export const since = (v: unknown) => {
  const d = asDate(v);
  if (!d) return '—';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
};

/** "in 5 days" / "today" / "3 days ago" relative to now. */
export const relativeDays = (v: unknown) => {
  const d = asDate(v);
  if (!d) return '';
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};
