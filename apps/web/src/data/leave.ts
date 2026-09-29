// Leave: types, balances, the ledger and requests (docs/HRMS.md §9).
import { collection, doc, getDoc, getDocs, limit, query, type QueryConstraint, where } from 'firebase/firestore';

import { call, command } from './api';
import { db, toDate } from './common';

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  annualQuota: number;
  accrual: 'MONTHLY' | 'YEARLY' | 'MANUAL';
  carryForwardMax: number;
  allowHalfDay: boolean;
  unlimited: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

/** Mirrors functions/src/hr/leaveRules.ts DEFAULT_LEAVE_TYPES. */
export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { id: 'casual', name: 'Casual leave', code: 'CL', paid: true, annualQuota: 12, accrual: 'MONTHLY', carryForwardMax: 0, allowHalfDay: true, unlimited: false, status: 'ACTIVE' },
  { id: 'sick', name: 'Sick leave', code: 'SL', paid: true, annualQuota: 12, accrual: 'YEARLY', carryForwardMax: 0, allowHalfDay: true, unlimited: false, status: 'ACTIVE' },
  { id: 'earned', name: 'Earned leave', code: 'EL', paid: true, annualQuota: 15, accrual: 'MONTHLY', carryForwardMax: 30, allowHalfDay: false, unlimited: false, status: 'ACTIVE' },
  { id: 'lop', name: 'Loss of pay', code: 'LOP', paid: false, annualQuota: 0, accrual: 'YEARLY', carryForwardMax: 0, allowHalfDay: true, unlimited: true, status: 'ACTIVE' },
];

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type HalfDay = 'NONE' | 'FIRST' | 'SECOND';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeUid: string | null;
  branchId: string | null;
  typeId: string;
  typeName: string;
  typeCode: string;
  paid: boolean;
  from: string;
  to: string;
  halfDay: HalfDay;
  dates: string[];
  days: number;
  year: string;
  reason: string;
  status: LeaveStatus;
  decidedByEmail: string | null;
  decisionNote: string | null;
  cancelNote?: string | null;
}

export interface TypeBalance {
  credited: number;
  adjusted: number;
  used: number;
  pending: number;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  branchId: string | null;
  year: string;
  types: Record<string, Partial<TypeBalance>>;
}

export interface LedgerEntry {
  id: string;
  typeId: string;
  kind: 'ACCRUAL' | 'CARRY' | 'ADJUST' | 'TAKEN' | 'RETURNED';
  days: number;
  period: string | null;
  note: string | null;
  at: Date | null;
}

const branchFilter = (scope: string[] | 'ALL'): QueryConstraint[] => (scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))]);
const toRequest = (id: string, d: Record<string, unknown>) => ({ ...d, id }) as LeaveRequest;

/** Days left of a type: credited + adjusted − used − pending. */
export const available = (b: Partial<TypeBalance> | undefined) => Math.round(((b?.credited ?? 0) + (b?.adjusted ?? 0) - (b?.used ?? 0) - (b?.pending ?? 0)) * 100) / 100;

export async function listLeaveTypes(orgId: string): Promise<LeaveType[]> {
  const snap = await getDocs(collection(db(), `orgs/${orgId}/leaveTypes`));
  const own = new Map(snap.docs.map((d) => [d.id, { ...(d.data() as Omit<LeaveType, 'id'>), id: d.id }]));
  const merged = DEFAULT_LEAVE_TYPES.map((t) => own.get(t.id) ?? t);
  for (const [id, t] of own) if (!DEFAULT_LEAVE_TYPES.some((d) => d.id === id)) merged.push(t);
  return merged;
}

/** One employee's balance for a year; `ownUid` for their own view (rules require the filter only on queries). */
export async function leaveBalance(orgId: string, employeeId: string, year: string): Promise<LeaveBalance | null> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/leaveBalances/${employeeId}_${year}`));
  return snap.exists() ? ({ ...(snap.data() as Omit<LeaveBalance, 'id'>), id: snap.id } as LeaveBalance) : null;
}

export async function balancesFor(orgId: string, year: string, scope: string[] | 'ALL'): Promise<LeaveBalance[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/leaveBalances`), where('year', '==', year), ...branchFilter(scope), limit(1000)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<LeaveBalance, 'id'>), id: d.id })).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** An employee's requests for a year, newest first; `ownUid` for their own view. */
export async function employeeRequests(orgId: string, employeeId: string, year: string, opts: { ownUid?: string; scope?: string[] | 'ALL' }): Promise<LeaveRequest[]> {
  const filters: QueryConstraint[] = opts.ownUid ? [where('employeeUid', '==', opts.ownUid)] : [where('employeeId', '==', employeeId), ...branchFilter(opts.scope ?? 'ALL')];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/leaveRequests`), ...filters, where('year', '==', year), limit(200)));
  return snap.docs.map((d) => toRequest(d.id, d.data())).sort((a, b) => b.from.localeCompare(a.from));
}

export async function pendingLeave(orgId: string, scope: string[] | 'ALL'): Promise<LeaveRequest[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/leaveRequests`), where('status', '==', 'PENDING'), ...branchFilter(scope), limit(300)));
  return snap.docs.map((d) => toRequest(d.id, d.data())).sort((a, b) => a.from.localeCompare(b.from));
}

/** Approved leave touching a month (for "who's away"). */
export async function approvedLeaveIn(orgId: string, month: string, scope: string[] | 'ALL'): Promise<LeaveRequest[]> {
  const snap = await getDocs(
    query(collection(db(), `orgs/${orgId}/leaveRequests`), where('months', 'array-contains', month), where('status', '==', 'APPROVED'), ...branchFilter(scope), limit(500)),
  );
  return snap.docs.map((d) => toRequest(d.id, d.data())).sort((a, b) => a.from.localeCompare(b.from));
}

/** The ledger behind a balance (HR and attendance viewers; employees see their own). */
export async function ledgerFor(orgId: string, employeeId: string, year: string, opts: { ownUid?: string; scope?: string[] | 'ALL' }): Promise<LedgerEntry[]> {
  const filters: QueryConstraint[] = opts.ownUid ? [where('employeeUid', '==', opts.ownUid)] : [where('employeeId', '==', employeeId), ...branchFilter(opts.scope ?? 'ALL')];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/leaveLedger`), ...filters, where('year', '==', year), limit(500)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<LedgerEntry, 'id' | 'at'>), id: d.id, at: toDate(d.get('at')) })).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

export const applyLeave = (input: { orgId: string; employeeId?: string; typeId: string; from: string; to: string; halfDay: HalfDay; reason: string }) =>
  command<{ leaveId: string; days: number }>('leave-apply', input);

/** Accrual writes many documents; it is not a replayed command. */
export async function accrueLeave(orgId: string, month: string) {
  return call<{ employees: number; days: number }>('leave-accrue', { orgId, month });
}

/** '2 days', '½ day', '1.25 days'. */
export const daysLabel = (n: number) => (n === 0.5 ? '½ day' : `${Math.round(n * 100) / 100} day${n === 1 ? '' : 's'}`);
