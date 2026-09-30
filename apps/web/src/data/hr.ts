import { collection, doc, getDoc, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { db, toDate } from './common';

/** Employee lifecycle (docs/HRMS.md §2). */
export const EMPLOYEE_STATUSES = ['DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING', 'OFFBOARDED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type Transition = 'START_ONBOARDING' | 'ACTIVATE' | 'RESIGN' | 'WITHDRAW_RESIGNATION' | 'START_OFFBOARDING' | 'COMPLETE_OFFBOARDING' | 'REHIRE';

/** Transitions offered in each status (the server enforces the same table). */
export const NEXT_STEPS: Record<EmployeeStatus, Transition[]> = {
  DRAFT: ['START_ONBOARDING'],
  ONBOARDING: ['ACTIVATE'],
  ACTIVE: ['RESIGN', 'START_OFFBOARDING'],
  NOTICE_PERIOD: ['START_OFFBOARDING', 'WITHDRAW_RESIGNATION'],
  OFFBOARDING: ['COMPLETE_OFFBOARDING'],
  OFFBOARDED: ['REHIRE'],
};

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
}

export interface Employee {
  id: string;
  orgId: string;
  code: string;
  uid: string | null;
  email: string | null;
  fullName: string;
  /** Profile picture (employees-setPhoto), or null for initials. */
  photoUrl?: string | null;
  phone: string;
  designationId: string | null;
  designationName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  branchId: string | null;
  employmentType: EmploymentType;
  joiningDate: string | null;
  managerId: string | null;
  managerName: string | null;
  status: EmployeeStatus;
  noticeEndDate: string | null;
  exitDate: string | null;
  exitReason: string | null;
  onboarding: ChecklistItem[] | null;
  offboarding: ChecklistItem[] | null;
  source: 'HR' | 'ROLES' | 'BACKFILL';
  /** Attendance: assigned shift and weekly days off (null = the branch's). */
  shiftId?: string | null;
  shiftName?: string | null;
  weeklyOffs?: ('MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN')[] | null;
}

export interface PrivateProfile {
  dob?: string;
  gender?: '' | 'FEMALE' | 'MALE' | 'OTHER';
  bloodGroup?: string;
  personalEmail?: string;
  personalPhone?: string;
  currentAddress?: string;
  permanentAddress?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  emergencyPhone?: string;
  pan?: string;
  /** Last four digits; the full Aadhaar number is only on the server (employees-revealAadhaar). */
  aadhaarLast4?: string;
  uan?: string;
  esiNumber?: string;
  bank?: { accountHolder: string; bankName: string; ifsc: string; last4: string };
}

export interface HistoryEntry {
  id: string;
  type: 'CREATED' | 'JOB_CHANGE' | 'DETAILS' | 'STATUS' | 'ACCOUNT';
  effectiveDate: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string;
  byEmail: string | null;
  at: Date | null;
}

export interface Designation {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface ChecklistTemplateItem {
  key: string;
  label: string;
  required: boolean;
}


/**
 * The directory. Branch-scoped viewers must filter to their own branches (the
 * security rules only allow that query shape); sorted by name here.
 */
export async function listEmployees(orgId: string, scope: string[] | 'ALL'): Promise<Employee[]> {
  const filters: QueryConstraint[] = scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/employees`), ...filters, limit(1000)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Employee).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getEmployee(orgId: string, employeeId: string): Promise<Employee | null> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/employees/${employeeId}`));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Employee) : null;
}

/** The signed-in user's own employee record in an organization, if any. */
export async function myEmployee(orgId: string, uid: string): Promise<Employee | null> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/employees`), where('uid', '==', uid), limit(1)));
  return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as Employee);
}

export async function getPrivateProfile(orgId: string, employeeId: string): Promise<PrivateProfile> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/employees/${employeeId}/private/profile`));
  return (snap.data() as PrivateProfile | undefined) ?? {};
}

export async function listHistory(orgId: string, employeeId: string): Promise<HistoryEntry[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/employees/${employeeId}/history`), orderBy('at', 'desc'), limit(200)));
  return snap.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, at: toDate(data.at) } as HistoryEntry;
  });
}

export async function listDesignations(orgId: string): Promise<Designation[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/designations`), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Designation);
}

export const DEFAULT_CHECKLISTS: Record<'onboarding' | 'offboarding', ChecklistTemplateItem[]> = {
  onboarding: [
    { key: 'offer-letter', label: 'Offer letter signed', required: true },
    { key: 'id-proof', label: 'Identity proof collected', required: true },
    { key: 'address-proof', label: 'Address proof collected', required: false },
    { key: 'pan', label: 'PAN recorded', required: true },
    { key: 'bank', label: 'Bank account recorded', required: true },
    { key: 'emergency-contact', label: 'Emergency contact recorded', required: false },
    { key: 'photo', label: 'Photo collected', required: false },
    { key: 'access', label: 'Stories account and roles set up', required: false },
    { key: 'induction', label: 'Induction completed', required: false },
  ],
  offboarding: [
    { key: 'exit-letter', label: 'Resignation or termination letter filed', required: true },
    { key: 'handover', label: 'Work handed over', required: true },
    { key: 'assets', label: 'Keys, ID card and equipment returned', required: true },
    { key: 'books', label: 'Library books returned', required: false },
    { key: 'settlement', label: 'Full and final settlement done', required: true },
    { key: 'exit-interview', label: 'Exit interview held', required: false },
    { key: 'experience-letter', label: 'Experience letter issued', required: false },
  ],
};

/** The org's checklist templates (its own, or the defaults). */
export async function getChecklistTemplates(orgId: string): Promise<Record<'onboarding' | 'offboarding', ChecklistTemplateItem[]>> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/config/hr`));
  const data = snap.data() ?? {};
  return {
    onboarding: data.onboarding?.length ? data.onboarding : DEFAULT_CHECKLISTS.onboarding,
    offboarding: data.offboarding?.length ? data.offboarding : DEFAULT_CHECKLISTS.offboarding,
  };
}
