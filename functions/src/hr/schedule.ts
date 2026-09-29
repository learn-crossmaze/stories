import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, name, reason, weekday } from '../core/schemas.js';
import { loadEmployee, requireFor } from './model.js';

/** Shifts, holidays and each employee's shift and weekly offs (docs/HRMS.md §8). */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const minutes = (max: number) => z.number().int().min(0).max(max);

export const saveShift = command(
  'shifts-save',
  z
    .strictObject({
      orgId: id,
      shiftId: id.optional(),
      name,
      start: time,
      end: time,
      breakMinutes: minutes(240).default(0),
      graceMinutes: minutes(120).default(10),
      halfDayMinutes: minutes(1440).default(240),
      fullDayMinutes: minutes(1440).default(480),
    })
    .refine((s) => s.start !== s.end, { message: 'A shift must start and end at different times.', path: ['end'] })
    .refine((s) => s.halfDayMinutes <= s.fullDayMinutes, { message: 'A half day cannot need more time than a full day.', path: ['halfDayMinutes'] }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const { orgId, shiftId, ...fields } = input;
    const ref = shiftId ? db.doc(`orgs/${orgId}/shifts/${shiftId}`) : db.collection(`orgs/${orgId}/shifts`).doc();
    const before = shiftId ? await tx.get(ref) : null;
    if (shiftId && !before?.exists) throw errors.notFound('Shift');
    const data = { ...fields, orgId, status: 'ACTIVE' };
    tx.set(ref, { ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, orgId, {
      action: shiftId ? 'shift.update' : 'shift.create',
      entityType: 'shift',
      entityId: ref.id,
      before: before?.exists ? before.data() : null,
      after: data,
    });
    return { shiftId: ref.id };
  },
);

export const archiveShift = command(
  'shifts-archive',
  z.strictObject({ orgId: id, shiftId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const ref = db.doc(`orgs/${input.orgId}/shifts/${input.shiftId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Shift');
    if (snap.get('status') === 'ARCHIVED') throw errors.conflict('ARCHIVED', 'This shift is already archived.');
    // Employees keep the shift until they are moved; it just can't be assigned any more.
    tx.update(ref, { status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'shift.archive',
      entityType: 'shift',
      entityId: input.shiftId,
      before: { status: 'ACTIVE' },
      after: { status: 'ARCHIVED' },
      reason: input.reason,
    });
    return { shiftId: input.shiftId };
  },
);

/** A holiday on a date, for the whole organization (`branchIds: []`) or some branches. */
export const saveHoliday = command(
  'holidays-save',
  z.strictObject({ orgId: id, date, name, branchIds: z.array(id).max(50).default([]) }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const ref = db.doc(`orgs/${input.orgId}/holidays/${input.date}`);
    const before = await tx.get(ref);
    const data = { orgId: input.orgId, date: input.date, year: input.date.slice(0, 4), name: input.name, branchIds: input.branchIds };
    tx.set(ref, { ...data, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'holiday.save',
      entityType: 'holiday',
      entityId: input.date,
      before: before.exists ? before.data() : null,
      after: data,
    });
    return { date: input.date };
  },
);

export const removeHoliday = command(
  'holidays-remove',
  z.strictObject({ orgId: id, date }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('hr.config', input.orgId, undefined, tx);
    const ref = db.doc(`orgs/${input.orgId}/holidays/${input.date}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Holiday');
    tx.delete(ref);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'holiday.remove',
      entityType: 'holiday',
      entityId: input.date,
      before: snap.data(),
    });
    return { date: input.date };
  },
);

/**
 * Sets an employee's shift and weekly offs. `weeklyOffs: null` uses the
 * branch's days off; `shiftId: null` means no fixed hours (no lateness).
 */
export const assignShift = command(
  'attendance-assignShift',
  z.strictObject({ orgId: id, employeeId: id, shiftId: id.nullable(), weeklyOffs: z.array(weekday).max(7).nullable() }),
  async ({ actor, input, requestId }, tx) => {
    const employee = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'attendance.manage', input.orgId, employee.get('branchId'), tx);
    let shiftName: string | null = null;
    if (input.shiftId) {
      const shift = await tx.get(db.doc(`orgs/${input.orgId}/shifts/${input.shiftId}`));
      if (!shift.exists || shift.get('status') !== 'ACTIVE') throw errors.notFound('Shift');
      shiftName = shift.get('name');
    }
    const weeklyOffs = input.weeklyOffs ? [...new Set(input.weeklyOffs)] : null;
    tx.update(employee.ref, { shiftId: input.shiftId, shiftName, weeklyOffs, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'employee.assignShift',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: employee.get('branchId') ?? null,
      before: { shiftId: employee.get('shiftId') ?? null, weeklyOffs: employee.get('weeklyOffs') ?? null },
      after: { shiftId: input.shiftId, weeklyOffs },
    });
    return { employeeId: input.employeeId };
  },
);
