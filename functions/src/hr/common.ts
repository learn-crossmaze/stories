import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { AuditContext } from '../core/audit.js';
import type { Weekday } from './attendanceRules.js';

/** Building blocks shared by the HRMS modules (docs/HRMS.md). */

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month (YYYY-MM)');
export const year = z.string().regex(/^\d{4}$/, 'must be a year');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
export const phone = z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, 'must be a valid phone number')]).default('');
export const optionalEmail = z.union([z.literal(''), z.email().transform((e) => e.toLowerCase())]).default('');

/** Employee statuses in which someone works here: they punch, take leave and accrue it. */
export const WORKING: readonly string[] = ['ONBOARDING', 'ACTIVE', 'NOTICE_PERIOD', 'OFFBOARDING'];

export const auditCtx = (actor: { uid: string; email: string | null }, requestId?: string): AuditContext => ({ actorUid: actor.uid, actorEmail: actor.email, requestId });

/** Whether a holiday (its `branchIds`; empty = the whole organization) applies at a branch. */
export function holidayApplies(holidayBranchIds: readonly string[] | null | undefined, branchId: string | null): boolean {
  const b = holidayBranchIds ?? [];
  return b.length === 0 || (!!branchId && b.includes(branchId));
}

/** An employee's weekly days off: their own, else their branch's. */
export const weeklyOffsOf = (employee: DocumentSnapshot, branch: DocumentSnapshot | null | undefined): Weekday[] =>
  ((employee.get('weeklyOffs') as Weekday[] | null | undefined) ?? (branch?.get('weeklyOffs') as Weekday[] | undefined) ?? []) as Weekday[];

/** Last four characters of a statutory number (PAN, UAN), or null. */
export const last4 = (value: unknown) => (typeof value === 'string' && value ? value.slice(-4) : null);
