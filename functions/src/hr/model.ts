import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { ALL_BRANCHES, type Actor } from '../core/rbac.js';
import type { Permission } from '../generated/rbac.js';

/**
 * Employee lifecycle (docs/HRMS.md §2):
 * DRAFT → ONBOARDING → ACTIVE → NOTICE_PERIOD → OFFBOARDING → OFFBOARDED.
 * A resignation can be withdrawn (NOTICE_PERIOD → ACTIVE); a termination skips
 * the notice period (ACTIVE → OFFBOARDING); a former employee can be rehired
 * (OFFBOARDED → ONBOARDING).
 */
export const EMPLOYEE_STATUSES = ['DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING', 'OFFBOARDED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const TRANSITIONS = {
  START_ONBOARDING: { from: ['DRAFT'], to: 'ONBOARDING' },
  ACTIVATE: { from: ['ONBOARDING'], to: 'ACTIVE' },
  RESIGN: { from: ['ACTIVE'], to: 'NOTICE_PERIOD' },
  WITHDRAW_RESIGNATION: { from: ['NOTICE_PERIOD'], to: 'ACTIVE' },
  START_OFFBOARDING: { from: ['ACTIVE', 'NOTICE_PERIOD'], to: 'OFFBOARDING' },
  COMPLETE_OFFBOARDING: { from: ['OFFBOARDING'], to: 'OFFBOARDED' },
  REHIRE: { from: ['OFFBOARDED'], to: 'ONBOARDING' },
} as const satisfies Record<string, { from: readonly EmployeeStatus[]; to: EmployeeStatus }>;
export type Transition = keyof typeof TRANSITIONS;

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;

export interface ChecklistTemplateItem {
  key: string;
  label: string;
  required: boolean;
}

export interface ChecklistItem extends ChecklistTemplateItem {
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
}

export type ChecklistKind = 'onboarding' | 'offboarding';

export const DEFAULT_CHECKLISTS: Record<ChecklistKind, ChecklistTemplateItem[]> = {
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

/**
 * Personal details an employee fills in themselves (self-onboarding). HR
 * chooses which are mandatory (config/hr.selfOnboardingFields); `emergency`
 * is the contact's name and phone, `bank` the salary account.
 */
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

export const hrConfigRef = (orgId: string) => db.doc(`orgs/${orgId}/config/hr`);
export const employeeRef = (orgId: string, employeeId: string) => db.doc(`orgs/${orgId}/employees/${employeeId}`);
export const employeesCol = (orgId: string) => db.collection(`orgs/${orgId}/employees`);
export const employeeCodeRef = (orgId: string, code: string) => db.doc(`orgs/${orgId}/employeeIds/${code}`);

/** The org's checklist templates (its own, or the defaults). */
export async function checklistTemplate(tx: Transaction, orgId: string, kind: ChecklistKind): Promise<ChecklistTemplateItem[]> {
  const snap = await tx.get(hrConfigRef(orgId));
  const own = snap.get(kind) as ChecklistTemplateItem[] | undefined;
  return own?.length ? own : DEFAULT_CHECKLISTS[kind];
}

export const startChecklist = (items: ChecklistTemplateItem[]): ChecklistItem[] =>
  items.map((i) => ({ ...i, done: false, doneBy: null, doneAt: null }));

export async function loadEmployee(tx: Transaction, orgId: string, employeeId: string): Promise<DocumentSnapshot> {
  const snap = await tx.get(employeeRef(orgId, employeeId));
  if (!snap.exists) throw errors.notFound('Employee');
  return snap;
}

/**
 * Requires `perm` for an employee's branch. Employees without a branch (head
 * office staff) need the permission across all branches.
 */
export async function requireFor(actor: Actor, perm: Permission, orgId: string, branchId: string | null, tx: Transaction) {
  if (branchId) return actor.require(perm, orgId, branchId, tx);
  if (actor.isSuperAdmin) return;
  const m = await actor.membership(orgId, tx);
  if (!(await actor.can(perm, orgId, undefined, tx)) || !m?.branchIds.includes(ALL_BRANCHES)) throw errors.forbidden();
}

/** Finds the org's employee record for an account: by uid, else an unlinked record with the same email. */
export async function findEmployeeFor(tx: Transaction, orgId: string, uid: string, email: string | null): Promise<DocumentSnapshot | null> {
  const byUid = await tx.get(employeesCol(orgId).where('uid', '==', uid).limit(1));
  if (!byUid.empty) return byUid.docs[0];
  if (!email) return null;
  const byEmail = await tx.get(employeesCol(orgId).where('emailLower', '==', email.toLowerCase()).where('uid', '==', null).limit(1));
  return byEmail.empty ? null : byEmail.docs[0];
}

/** A new employee record (fields not given start empty). */
export function newEmployee(fields: {
  orgId: string;
  code: string;
  fullName: string;
  status: EmployeeStatus;
  source: 'HR' | 'ROLES' | 'BACKFILL';
  uid?: string | null;
  email?: string | null;
  phone?: string;
  branchId?: string | null;
  joiningDate?: string | null;
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
}) {
  const email = fields.email ?? null;
  return {
    orgId: fields.orgId,
    code: fields.code,
    uid: fields.uid ?? null,
    email,
    emailLower: email?.toLowerCase() ?? null,
    fullName: fields.fullName,
    phone: fields.phone ?? '',
    designationId: null,
    designationName: null,
    departmentId: null,
    departmentName: null,
    branchId: fields.branchId ?? null,
    employmentType: fields.employmentType ?? 'FULL_TIME',
    joiningDate: fields.joiningDate ?? null,
    managerId: null,
    managerName: null,
    status: fields.status,
    noticeEndDate: null,
    exitDate: null,
    exitReason: null,
    onboarding: null as ChecklistItem[] | null,
    offboarding: null as ChecklistItem[] | null,
    source: fields.source,
  };
}

/** Whether `actor` holds `perm` for an employee's branch (head-office records need all branches). */
export async function canFor(actor: Actor, perm: Permission, orgId: string, branchId: string | null, tx: Transaction): Promise<boolean> {
  try {
    await requireFor(actor, perm, orgId, branchId, tx);
    return true;
  } catch {
    return false;
  }
}
