// Display formatting (en-IN). Amounts are stored in paise.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const money = (minor: number) => inr.format(minor / 100).replace(/\.00$/, '');
export const toMinor = (rupees: string) => Math.round(Number(rupees.replace(/[₹,\s]/g, '')) * 100);

const asDate = (v: unknown): Date | null =>
  v instanceof Date ? v : v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : null;

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
