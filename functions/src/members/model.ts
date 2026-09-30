import type { AgeGroup } from '../catalogue/model.js';

export const ADULT_AGE = 18;
export const TEEN_AGE = 13;

/** Whole years between a YYYY-MM-DD birth date and `on`. */
export function ageOn(dob: string, on: Date): number {
  const [y, m, d] = dob.split('-').map(Number);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age--;
  return age;
}

export const audienceFor = (age: number): AgeGroup => (age < TEEN_AGE ? 'CHILDREN' : age < ADULT_AGE ? 'TEENS' : 'ADULTS');

/** Normalizes Indian mobile numbers to E.164 (+91XXXXXXXXXX). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  const d = digits.replace(/^\+/, '');
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `+91${d.slice(1)}`;
  return null;
}

export interface Member {
  code: string;
  fullName: string;
  dob: string;
  audience: AgeGroup;
  isMinor: boolean;
  phone: string | null;
  email: string | null;
  emailLower?: string | null;
  homeBranchId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  guardian: { memberId: string; name: string; relationship: string } | null;
  accountHolderUid: string | null;
  activeSubscriptionId: string | null;
  nextSubscriptionId: string | null;
  subscriptionEndsAt: FirebaseFirestore.Timestamp | null;
  /** Plan of the latest paid term (for the member list; kept after it expires). */
  planName?: string | null;
  /** End of the latest paid term, including a pre-paid renewal: the date to renew by (kept after it expires). */
  renewalDueAt?: FirebaseFirestore.Timestamp | null;
  activeLoanCount: number;
  allocatedCount: number;
  waitingCount: number;
  lifetimeLoans: number;
  lifetimeExchanges: number;
  /** Last four digits of the Aadhaar number (the full number is in private/aadhaar, functions only). */
  aadhaarLast4?: string | null;
}
