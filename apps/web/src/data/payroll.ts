// Payroll: statutory settings, salary structures, monthly inputs, runs and payslips (docs/HRMS.md §10).
import { collection, doc, getDoc, getDocs, limit, query, type QueryConstraint, Timestamp, where } from 'firebase/firestore';

import { callAction, command, toApiError } from './api';
import { services } from './services';

export interface Component {
  code: string;
  name: string;
  amount: number;
}

export interface Adjustment {
  name: string;
  amount: number;
}

export interface StatutorySettings {
  effectiveFrom: string;
  pf: { enabled: boolean; employeeRate: number; employerRate: number; epsRate: number; wageCeiling: number; capAtCeiling: boolean };
  esi: { enabled: boolean; employeeRate: number; employerRate: number; grossLimit: number };
  pt: { enabled: boolean; slabs: { from: number; amount: number }[]; februaryAmount: number | null };
}

/** Mirrors functions/src/hr/payrollRules.ts DEFAULT_SETTINGS. */
export const DEFAULT_SETTINGS: StatutorySettings = {
  effectiveFrom: '2000-01',
  pf: { enabled: true, employeeRate: 12, employerRate: 12, epsRate: 8.33, wageCeiling: 15000, capAtCeiling: true },
  esi: { enabled: true, employeeRate: 0.75, employerRate: 3.25, grossLimit: 21000 },
  pt: { enabled: true, slabs: [{ from: 0, amount: 0 }, { from: 25000, amount: 200 }], februaryAmount: null },
};

export interface Salary {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  earnings: Component[];
  pf: boolean;
  esi: boolean;
  pt: boolean;
  monthlyGross: number;
  reason: string;
  updatedByEmail: string;
}

export interface MonthInputs {
  tds: number;
  otherEarnings: Adjustment[];
  otherDeductions: Adjustment[];
}

export type RunStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED';

export interface PayrollRun {
  id: string;
  month: string;
  branchId: string | null;
  status: RunStatus;
  stale: boolean;
  employees: number;
  totals: { gross: number; deductions: number; net: number; employerCost: number; pfEmployee: number; pfEmployer: number; esiEmployee: number; esiEmployer: number; pt: number; tds: number };
  problems: { employeeId: string; employeeName: string; message: string }[];
  problemCount: number;
  settingsFrom: string;
  preparedBy: string;
  preparedByEmail: string;
  submittedBy: string | null;
  submittedByEmail: string | null;
  approvedByEmail: string | null;
  rejectNote: string | null;
  preparedAt: Date | null;
}

export interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeUid: string | null;
  branchId: string | null;
  month: string;
  days: { inMonth: number; payable: number; present: number; leave: number; absent: number };
  earnings: (Component & { full: number })[];
  otherEarnings: Adjustment[];
  otherDeductions: Adjustment[];
  gross: number;
  pfEmployee: number;
  esiEmployee: number;
  pt: number;
  tds: number;
  deductions: number;
  net: number;
  employerCost: number;
  missingSalary: boolean;
  problems: string[];
  published: boolean;
}

const db = () => services().db;
const ts = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
const branchFilter = (scope: string[] | 'ALL'): QueryConstraint[] => (scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))]);
export const runId = (month: string, branchId: string | null) => `${month}_${branchId ?? 'HO'}`;

export async function listSettings(orgId: string): Promise<StatutorySettings[]> {
  const snap = await getDocs(collection(db(), `orgs/${orgId}/payrollSettings`));
  return snap.docs.map((d) => d.data() as StatutorySettings).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/** An employee's salary versions, newest first; `ownUid` for their own view. */
export async function salaryHistory(orgId: string, employeeId: string, opts: { ownUid?: string; scope?: string[] | 'ALL' }): Promise<Salary[]> {
  const filters: QueryConstraint[] = opts.ownUid ? [where('employeeUid', '==', opts.ownUid)] : [where('employeeId', '==', employeeId), ...branchFilter(opts.scope ?? 'ALL')];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/salaries`), ...filters, limit(100)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Salary, 'id'>), id: d.id })).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

export async function getInputs(orgId: string, employeeId: string, month: string): Promise<MonthInputs | null> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/payrollInputs/${employeeId}_${month}`));
  return snap.exists() ? (snap.data() as MonthInputs) : null;
}

export async function getRun(orgId: string, month: string, branchId: string | null): Promise<PayrollRun | null> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/payrollRuns/${runId(month, branchId)}`));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { ...(d as Omit<PayrollRun, 'id'>), id: snap.id, preparedAt: ts(d.preparedAt) };
}

/** Runs waiting for approval in the viewer's branches. */
export async function submittedRuns(orgId: string, scope: string[] | 'ALL'): Promise<PayrollRun[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/payrollRuns`), where('status', '==', 'SUBMITTED'), ...branchFilter(scope), limit(100)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<PayrollRun, 'id'>), id: d.id, preparedAt: ts(d.get('preparedAt')) }));
}

/** A run's payslips (for those who see all payslips). */
export async function runPayslips(orgId: string, month: string, branchId: string | null): Promise<Payslip[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/payslips`), where('month', '==', month), where('branchId', '==', branchId), limit(500)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Payslip, 'id'>), id: d.id })).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** An employee's payslips: published ones for themselves (`ownUid`), all for payslip viewers. */
export async function employeePayslips(orgId: string, employeeId: string, opts: { ownUid?: string; scope?: string[] | 'ALL' }): Promise<Payslip[]> {
  const filters: QueryConstraint[] = opts.ownUid
    ? [where('employeeUid', '==', opts.ownUid), where('published', '==', true)]
    : [where('employeeId', '==', employeeId), ...branchFilter(opts.scope ?? 'ALL')];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/payslips`), ...filters, limit(120)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Payslip, 'id'>), id: d.id })).sort((a, b) => b.month.localeCompare(a.month));
}

/** Preparing writes a payslip per employee; it is not a replayed command. */
export async function prepareRun(orgId: string, month: string, branchId: string | null) {
  try {
    return await callAction<{ runId: string; employees: number; problems: number }>(services().fns, 'payroll-prepare', { orgId, month, branchId });
  } catch (e) {
    throw toApiError(e);
  }
}

export const submitRun = (orgId: string, month: string, branchId: string | null) => command('payroll-submit', { orgId, month, branchId });

/** Downloads a payslip PDF (opening someone else's is audited). */
export async function downloadPayslip(orgId: string, employeeId: string, month: string) {
  try {
    const res = await callAction<{ fileName: string; contentType: string; content: string }>(services().fns, 'payslips-download', { orgId, employeeId, month });
    const bytes = Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: res.contentType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = res.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    throw toApiError(e);
  }
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n: number) => inr.format(n);
/** 'September 2026'. */
export const monthName = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
