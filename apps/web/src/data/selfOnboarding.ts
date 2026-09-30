// Self-onboarding: what a staff member still has to fill in or upload
// themselves (personal details, bank account, required documents), worked out
// from their own records (functions/src/hr/employees.ts, docs/HRMS.md §14).
import { doc, getDoc } from 'firebase/firestore';

import { command } from './api';
import { db } from './common';
import { type Employee, getPrivateProfile, myEmployee, type PrivateProfile } from './hr';
import { employeeDocuments, listDocumentTypes } from './hrDocuments';

export const PROFILE_FIELDS = [
  'dob',
  'gender',
  'bloodGroup',
  'personalEmail',
  'personalPhone',
  'currentAddress',
  'permanentAddress',
  'emergency',
  'pan',
  'uan',
  'esiNumber',
  'bank',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const DEFAULT_REQUIRED_FIELDS: ProfileField[] = ['dob', 'gender', 'personalPhone', 'currentAddress', 'permanentAddress', 'emergency', 'pan', 'bank'];

export const FIELD_LABELS: Record<ProfileField, string> = {
  dob: 'Date of birth',
  gender: 'Gender',
  bloodGroup: 'Blood group',
  personalEmail: 'Personal email',
  personalPhone: 'Personal phone',
  currentAddress: 'Current address',
  permanentAddress: 'Permanent address',
  emergency: 'Emergency contact',
  pan: 'PAN',
  uan: 'UAN (PF)',
  esiNumber: 'ESI number',
  bank: 'Salary bank account',
};

/** Everyone still working here fills in their details (not once they are leaving). */
export const needsSelfOnboarding = (e: Pick<Employee, 'status' | 'uid'> | null) =>
  !!e?.uid && ['DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD'].includes(e.status);

/** The personal details HR made mandatory (config/hr), or the defaults. */
export async function requiredFields(orgId: string): Promise<ProfileField[]> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/config/hr`));
  const own = snap.data()?.selfOnboardingFields as ProfileField[] | undefined;
  return own ?? DEFAULT_REQUIRED_FIELDS;
}

export const saveRequiredFields = (orgId: string, fields: ProfileField[]) => command('hr-setSelfOnboarding', { orgId, requiredFields: fields });

export const hasField = (p: PrivateProfile, f: ProfileField) =>
  f === 'emergency' ? !!(p.emergencyName && p.emergencyPhone) : f === 'bank' ? !!p.bank?.last4 : !!(p as Record<string, unknown>)[f];

export interface OnboardingItem {
  key: string;
  label: string;
  kind: 'field' | 'document';
  done: boolean;
  /** e.g. "Awaiting verification" or why HR rejected it. */
  note: string | null;
}

export interface OnboardingStatus {
  employee: Employee;
  profile: PrivateProfile;
  required: ProfileField[];
  items: OnboardingItem[];
  missing: OnboardingItem[];
  done: number;
  total: number;
}

/**
 * The signed-in person's self-onboarding: each mandatory detail and each
 * required document they can upload themselves. A document counts once it is
 * uploaded (awaiting verification or verified); a rejected or expired one has
 * to be uploaded again. Null when there is nothing for them to do here.
 */
export async function myOnboarding(orgId: string, uid: string): Promise<OnboardingStatus | null> {
  const employee = await myEmployee(orgId, uid);
  if (!needsSelfOnboarding(employee)) return null;
  const [profile, required, types, docs] = await Promise.all([
    getPrivateProfile(orgId, employee!.id),
    requiredFields(orgId),
    listDocumentTypes(orgId),
    employeeDocuments(orgId, employee!.id, uid),
  ]);
  const items: OnboardingItem[] = PROFILE_FIELDS.filter((f) => required.includes(f)).map((f) => ({
    key: f,
    label: FIELD_LABELS[f],
    kind: 'field',
    done: hasField(profile, f),
    note: null,
  }));
  for (const type of types.filter((t) => t.status === 'ACTIVE' && t.required && t.selfUpload)) {
    // Newest first: the latest upload of this type decides.
    const latest = docs.find((d) => d.typeId === type.id && d.status !== 'REMOVED' && d.status !== 'SUPERSEDED');
    const done = latest?.status === 'VERIFIED' || latest?.status === 'PENDING';
    items.push({
      key: `doc:${type.id}`,
      label: type.name,
      kind: 'document',
      done,
      note:
        latest?.status === 'PENDING'
          ? 'Awaiting verification'
          : latest?.status === 'REJECTED'
            ? `Rejected${latest.rejectReason ? `: ${latest.rejectReason}` : ''}. Upload it again.`
            : latest?.status === 'EXPIRED'
              ? 'Expired. Upload a current copy.'
              : null,
    });
  }
  const missing = items.filter((i) => !i.done);
  return { employee: employee!, profile, required, items, missing, done: items.length - missing.length, total: items.length };
}

/** Tells the reminder and banner to look again after something was saved or uploaded. */
export const ONBOARDING_CHANGED = 'stories:onboarding-changed';
export const onboardingChanged = () => window.dispatchEvent(new Event(ONBOARDING_CHANGED));
