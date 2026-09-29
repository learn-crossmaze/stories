// Attendance: shifts, holidays, daily records, corrections and monthly summaries (docs/HRMS.md §8).
import { collection, doc, getDoc, getDocs, limit, query, type QueryConstraint, where } from 'firebase/firestore';

import { call, command } from './api';
import { db, toDate } from './common';

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export const WEEKDAYS: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'WEEKLY_OFF' | 'HOLIDAY' | 'ON_LEAVE' | 'IN_PROGRESS';

export interface Shift {
  id: string;
  name: string;
  start: string;
  end: string;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  branchIds: string[];
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  branchId: string | null;
  date: string;
  shiftName: string | null;
  shiftStart: string;
  shiftEnd: string;
  checkIn: Date | null;
  checkOut: Date | null;
  status: DayStatus;
  workedMinutes: number;
  lateMinutes: number;
  late: boolean;
  earlyExit: boolean;
  missedCheckout: boolean;
  /** Approved leave on the day (set by leave decisions). */
  leave?: { typeId: string; paid: boolean; half: boolean } | null;
  leaveDays?: number;
  payable?: number;
  source: 'SELF' | 'DESK' | 'ADJUSTED' | 'CORRECTION' | 'FINALIZE' | 'LEAVE';
  adjustReason?: string;
  finalized?: boolean;
}

export interface Correction {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeUid: string;
  branchId: string | null;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionNote: string | null;
}

export interface MonthSummary {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  branchId: string | null;
  month: string;
  present: number;
  halfDays: number;
  absent: number;
  weeklyOffs: number;
  holidays: number;
  leaveDays: number;
  paidLeaveDays: number;
  lateDays: number;
  missedCheckouts: number;
  workedMinutes: number;
  payableDays: number;
  days: number;
  stale: boolean;
}

export interface MonthLock {
  status: 'FINALIZED' | 'REOPENED';
  finalizedByEmail?: string;
  finalizedAt?: Date | null;
}

const toRecord = (id: string, d: Record<string, unknown>) => ({ ...d, id, checkIn: toDate(d.checkIn), checkOut: toDate(d.checkOut) }) as AttendanceRecord;
const branchFilter = (scope: string[] | 'ALL'): QueryConstraint[] => (scope === 'ALL' ? [] : [where('branchId', 'in', scope.slice(0, 30))]);

export const previousMonth = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
};

export async function listShifts(orgId: string): Promise<Shift[]> {
  const snap = await getDocs(collection(db(), `orgs/${orgId}/shifts`));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Shift, 'id'>), id: d.id })).sort((a, b) => a.start.localeCompare(b.start));
}

export async function listHolidays(orgId: string, year: string): Promise<Holiday[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/holidays`), where('year', '==', year)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Holiday, 'id'>), id: d.id })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Everyone's records for one day, in the viewer's branches. */
export async function dayRecords(orgId: string, date: string, scope: string[] | 'ALL'): Promise<AttendanceRecord[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/attendance`), where('date', '==', date), ...branchFilter(scope), limit(1000)));
  return snap.docs.map((d) => toRecord(d.id, d.data()));
}

/** One employee's month; `ownUid` for the employee's own view (rules require it). */
export async function employeeMonth(orgId: string, employeeId: string, month: string, opts: { ownUid?: string; scope?: string[] | 'ALL' }): Promise<AttendanceRecord[]> {
  const filters: QueryConstraint[] = opts.ownUid ? [where('employeeUid', '==', opts.ownUid)] : [where('employeeId', '==', employeeId), ...branchFilter(opts.scope ?? 'ALL')];
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/attendance`), ...filters, where('month', '==', month), limit(62)));
  return snap.docs.map((d) => toRecord(d.id, d.data())).sort((a, b) => a.date.localeCompare(b.date));
}

export async function pendingCorrections(orgId: string, scope: string[] | 'ALL'): Promise<Correction[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/attendanceCorrections`), where('status', '==', 'PENDING'), ...branchFilter(scope), limit(300)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Correction, 'id'>), id: d.id })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function myCorrections(orgId: string, uid: string): Promise<Correction[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/attendanceCorrections`), where('employeeUid', '==', uid), limit(100)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Correction, 'id'>), id: d.id })).sort((a, b) => b.date.localeCompare(a.date));
}

export async function monthSummaries(orgId: string, month: string, scope: string[] | 'ALL'): Promise<MonthSummary[]> {
  const snap = await getDocs(query(collection(db(), `orgs/${orgId}/attendanceSummaries`), where('month', '==', month), ...branchFilter(scope), limit(1000)));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<MonthSummary, 'id'>), id: d.id })).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export async function monthLock(orgId: string, month: string, branchId: string | null): Promise<MonthLock | null> {
  const snap = await getDoc(doc(db(), `orgs/${orgId}/attendanceLocks/${month}_${branchId ?? 'HO'}`));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { ...(d as MonthLock), finalizedAt: toDate(d.finalizedAt) };
}

export const punch = (orgId: string, direction: 'IN' | 'OUT', employeeId?: string) =>
  command<{ date: string; status: DayStatus; late: boolean }>('attendance-punch', { orgId, punch: direction, ...(employeeId ? { employeeId } : {}) });

/** Finalizing is not a replayed command (it writes many records); call it directly. */
export async function finalizeMonth(orgId: string, month: string, branchId: string | null) {
  return call<{ month: string; employees: number }>('attendance-finalize', { orgId, month, branchId });
}

const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const timeOf = (d: Date | null) => (d ? clock.format(d) : '—');
/** 'HH:MM' in India time, for pre-filling edit forms. */
export const hhmm = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16) : '');
export const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
