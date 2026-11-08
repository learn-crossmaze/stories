import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, type CallContext } from '../core/callable.js';
import { syncClaims } from '../core/claims.js';
import { errors } from '../core/errors.js';
import { auth, db } from '../core/firebase.js';
import { type Actor, type Membership } from '../core/rbac.js';
import { id, name } from '../core/schemas.js';
import { dateKeyIST } from '../core/time.js';
import { assignEmployeeCode } from './codes.js';
import { auditCtx as auditFor, date, optionalEmail, phone } from './common.js';
import {
  type ChecklistItem,
  type ChecklistKind,
  checklistTemplate,
  EMPLOYMENT_TYPES,
  employeeCodeRef,
  employeeRef,
  employeesCol,
  type EmployeeStatus,
  findEmployeeFor,
  loadEmployee,
  newEmployee,
  requireFor,
  startChecklist,
  TRANSITIONS,
  type Transition,
} from './model.js';

/**
 * Employee records and their lifecycle (docs/HRMS.md §2–5). Personal, bank
 * and photo details are in employeePrivate.ts; the roles backfill in
 * employeesBackfill.ts.
 */

const code = z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, 'must be 2–24 letters, digits or dashes')]).default('');
const note = z.string().trim().max(500).default('');

type Ctx = CallContext<unknown> & { requestId?: string };
const auditCtx = ({ actor, requestId }: Ctx) => auditFor(actor, requestId);

/** Effective-dated history of an employee (job changes, status changes, links). */
function addHistory(
  tx: Transaction,
  actor: Actor,
  orgId: string,
  employeeId: string,
  entry: { type: string; effectiveDate: string; changes: Record<string, { from: unknown; to: unknown }>; note?: string },
) {
  tx.create(db.collection(`orgs/${orgId}/employees/${employeeId}/history`).doc(), {
    ...entry,
    note: entry.note ?? '',
    by: actor.uid,
    byEmail: actor.email,
    at: FieldValue.serverTimestamp(),
  });
}

/** Job placement fields, checked against the org's branches, departments, designations and staff. */
const placement = {
  branchId: id.nullable().default(null),
  departmentId: id.nullable().default(null),
  designationId: id.nullable().default(null),
  managerId: id.nullable().default(null),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  joiningDate: date.nullable().default(null),
};

async function resolvePlacement(
  tx: Transaction,
  orgId: string,
  self: string | null,
  p: { branchId: string | null; departmentId: string | null; designationId: string | null; managerId: string | null },
) {
  const [branch, dept, desig, manager] = await Promise.all([
    p.branchId ? tx.get(db.doc(`orgs/${orgId}/branches/${p.branchId}`)) : null,
    p.departmentId ? tx.get(db.doc(`orgs/${orgId}/departments/${p.departmentId}`)) : null,
    p.designationId ? tx.get(db.doc(`orgs/${orgId}/designations/${p.designationId}`)) : null,
    p.managerId ? tx.get(employeeRef(orgId, p.managerId)) : null,
  ]);
  if (branch && (!branch.exists || branch.get('status') !== 'ACTIVE')) throw errors.notFound('Branch');
  if (dept && (!dept.exists || dept.get('status') !== 'ACTIVE')) throw errors.notFound('Department');
  if (dept && dept.get('branchId') && dept.get('branchId') !== p.branchId) {
    throw errors.invalid('This department belongs to another branch.');
  }
  if (desig && (!desig.exists || desig.get('status') !== 'ACTIVE')) throw errors.notFound('Designation');
  if (manager) {
    if (!manager.exists || manager.get('status') === 'OFFBOARDED') throw errors.notFound('Reporting manager');
    if (manager.id === self) throw errors.invalid("An employee can't report to themselves.");
    if (self && manager.get('managerId') === self) throw errors.invalid('These two would report to each other. Choose another manager.');
  }
  return {
    branch,
    fields: {
      branchId: p.branchId,
      departmentId: p.departmentId,
      departmentName: dept?.get('name') ?? null,
      designationId: p.designationId,
      designationName: desig?.get('name') ?? null,
      managerId: p.managerId,
      managerName: manager?.get('fullName') ?? null,
    },
  };
}

/** A Stories account for this email, if there is one. */
async function accountFor(email: string) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return null;
  }
}

/**
 * Adds a person to People as a DRAFT record (hiring in progress). If a Stories
 * account uses the email it is linked now; roles are granted separately.
 */
export const create = command(
  'employees-create',
  z.strictObject({ orgId: id, fullName: name, email: optionalEmail, phone, employeeId: code, ...placement }),
  async (ctx, tx) => {
    const { actor, input } = ctx;
    // HR adds anyone; branch managers add people at their own branches (docs/HRMS.md §4).
    await requireFor(actor, 'employees.add', input.orgId, input.branchId, tx);
    const { branch, fields } = await resolvePlacement(tx, input.orgId, null, input);
    const ref = employeesCol(input.orgId).doc();

    let uid: string | null = null;
    let current: string | null = null;
    if (input.email) {
      const dup = await tx.get(employeesCol(input.orgId).where('emailLower', '==', input.email).limit(1));
      if (!dup.empty) throw errors.conflict('DUPLICATE_EMPLOYEE', `${dup.docs[0].get('fullName')} (${dup.docs[0].get('code')}) already uses this email.`);
      const account = await accountFor(input.email);
      if (account) {
        if (await findEmployeeFor(tx, input.orgId, account.uid, null)) {
          throw errors.conflict('DUPLICATE_EMPLOYEE', 'This Stories account already has an employee record here.');
        }
        uid = account.uid;
        const m = await tx.get(db.doc(`users/${uid}/memberships/${input.orgId}`));
        current = (m.get('employeeId') as string | undefined) ?? null;
      }
    }
    const staffId = await assignEmployeeCode(tx, input.orgId, { uid, employeeDocId: ref.id }, current, input.employeeId, branch ?? null);
    if (uid && current && staffId.employeeId !== current) {
      tx.update(db.doc(`users/${uid}/memberships/${input.orgId}`), { employeeId: staffId.employeeId });
    }
    staffId.commit();
    const record = {
      ...newEmployee({ orgId: input.orgId, code: staffId.employeeId, fullName: input.fullName, status: 'DRAFT', source: 'HR', uid, email: input.email || null, phone: input.phone }),
      ...fields,
      employmentType: input.employmentType,
      joiningDate: input.joiningDate,
    };
    tx.create(ref, { ...record, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    addHistory(tx, actor, input.orgId, ref.id, { type: 'CREATED', effectiveDate: dateKeyIST(new Date()), changes: { status: { from: null, to: 'DRAFT' } } });
    recordAudit(tx, auditCtx(ctx), input.orgId, { action: 'employee.create', entityType: 'employee', entityId: ref.id, branchId: input.branchId, after: { code: record.code, fullName: record.fullName, uid } });
    return { employeeId: ref.id, code: staffId.employeeId, linked: uid !== null };
  },
);

const JOB_FIELDS = ['branchId', 'departmentId', 'designationId', 'managerId', 'employmentType'] as const;
const DETAIL_FIELDS = ['fullName', 'phone', 'email', 'joiningDate'] as const;

/**
 * Updates details and job placement. Job changes (branch, department,
 * designation, manager, employment type) are recorded in the history with
 * their effective date.
 */
export const update = command(
  'employees-update',
  z.strictObject({ orgId: id, employeeId: id, fullName: name, email: optionalEmail, phone, effectiveDate: date.optional(), note, ...placement }),
  async (ctx, tx) => {
    const { actor, input } = ctx;
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'employees.edit', input.orgId, snap.get('branchId'), tx);
    if (input.branchId !== snap.get('branchId')) await requireFor(actor, 'employees.edit', input.orgId, input.branchId, tx);
    if (snap.get('status') === 'OFFBOARDED') throw errors.conflict('OFFBOARDED', 'Offboarded records are kept as they were. Rehire the person to change them.');
    const { fields } = await resolvePlacement(tx, input.orgId, input.employeeId, input);
    const linked = snap.get('uid') !== null;
    const email = linked ? snap.get('email') : input.email || null;
    if (email && email !== snap.get('email')) {
      const dup = await tx.get(employeesCol(input.orgId).where('emailLower', '==', email).limit(1));
      if (!dup.empty && dup.docs[0].id !== input.employeeId) throw errors.conflict('DUPLICATE_EMPLOYEE', `${dup.docs[0].get('fullName')} already uses this email.`);
    }

    const next: Record<string, unknown> = { ...fields, fullName: input.fullName, phone: input.phone, email, emailLower: email?.toLowerCase() ?? null, employmentType: input.employmentType, joiningDate: input.joiningDate };
    const diff = (keys: readonly string[]) =>
      Object.fromEntries(keys.filter((k) => (snap.get(k) ?? null) !== (next[k] ?? null)).map((k) => [k, { from: snap.get(k) ?? null, to: next[k] ?? null }]));
    const job = diff(JOB_FIELDS);
    const details = diff(DETAIL_FIELDS);
    if (!Object.keys(job).length && !Object.keys(details).length) return { employeeId: input.employeeId, changed: false };
    // History shows names, not ids.
    for (const [k, label] of [['departmentId', 'departmentName'], ['designationId', 'designationName'], ['managerId', 'managerName']] as const) {
      if (job[k]) job[k] = { from: snap.get(label) ?? job[k].from, to: next[label] ?? job[k].to };
    }

    const today = dateKeyIST(new Date());
    tx.update(snap.ref, { ...next, updatedAt: FieldValue.serverTimestamp() });
    if (Object.keys(job).length) addHistory(tx, actor, input.orgId, input.employeeId, { type: 'JOB_CHANGE', effectiveDate: input.effectiveDate ?? today, changes: job, note: input.note });
    if (Object.keys(details).length) addHistory(tx, actor, input.orgId, input.employeeId, { type: 'DETAILS', effectiveDate: today, changes: details, note: input.note });
    recordAudit(tx, auditCtx(ctx), input.orgId, {
      action: 'employee.update',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: input.branchId ?? snap.get('branchId'),
      before: Object.fromEntries(Object.entries({ ...job, ...details }).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries({ ...job, ...details }).map(([k, v]) => [k, v.to])),
      reason: input.note || null,
    });
    return { employeeId: input.employeeId, changed: true };
  },
);

const requiredOpen = (items: ChecklistItem[] | null) => (items ?? []).filter((i) => i.required && !i.done);

/** Moves an employee through the lifecycle (model.ts TRANSITIONS). */
export const transition = command(
  'employees-transition',
  z.strictObject({
    orgId: id,
    employeeId: id,
    transition: z.enum(Object.keys(TRANSITIONS) as [Transition, ...Transition[]]),
    /** Joining date (ACTIVATE, REHIRE), last working day (RESIGN) or exit date (START_OFFBOARDING). */
    date: date.optional(),
    reason: z.string().trim().max(500).default(''),
  }),
  async (ctx, tx) => {
    const { actor, input } = ctx;
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'employees.lifecycle', input.orgId, snap.get('branchId'), tx);
    if (snap.get('uid') && snap.get('uid') === actor.uid && !actor.isSuperAdmin) throw errors.forbidden("You can't change your own employment status.");
    const status = snap.get('status') as EmployeeStatus;
    const rule = TRANSITIONS[input.transition];
    if (!(rule.from as readonly EmployeeStatus[]).includes(status)) {
      throw errors.conflict('INVALID_TRANSITION', `This can't be done while the employee is ${status.toLowerCase().replace('_', ' ')}.`);
    }
    const needReason = input.transition === 'RESIGN' || input.transition === 'START_OFFBOARDING';
    if (needReason && input.reason.length < 3) throw errors.invalid('Please give a reason.');

    const changes: Record<string, unknown> = { status: rule.to, statusChangedAt: FieldValue.serverTimestamp() };
    let membershipRef: FirebaseFirestore.DocumentReference | null = null;
    let membership: Membership | null = null;
    switch (input.transition) {
      case 'START_ONBOARDING':
        changes.onboarding = startChecklist(await checklistTemplate(tx, input.orgId, 'onboarding'));
        break;
      case 'REHIRE':
        changes.onboarding = startChecklist(await checklistTemplate(tx, input.orgId, 'onboarding'));
        Object.assign(changes, { offboarding: null, exitDate: null, exitReason: null, noticeEndDate: null, joiningDate: input.date ?? null });
        break;
      case 'ACTIVATE': {
        const open = requiredOpen(snap.get('onboarding'));
        if (open.length) throw errors.conflict('CHECKLIST_OPEN', `Finish the onboarding checklist first: ${open.map((i) => i.label).join(', ')}.`);
        const joining = input.date ?? snap.get('joiningDate');
        if (!joining) throw errors.invalid('Enter the joining date.');
        changes.joiningDate = joining;
        break;
      }
      case 'RESIGN':
        if (!input.date) throw errors.invalid('Enter the last working day.');
        Object.assign(changes, { noticeEndDate: input.date, exitReason: input.reason });
        break;
      case 'WITHDRAW_RESIGNATION':
        Object.assign(changes, { noticeEndDate: null, exitReason: null });
        break;
      case 'START_OFFBOARDING': {
        const exit = input.date ?? snap.get('noticeEndDate');
        if (!exit) throw errors.invalid('Enter the exit date.');
        Object.assign(changes, { exitDate: exit, exitReason: input.reason, offboarding: startChecklist(await checklistTemplate(tx, input.orgId, 'offboarding')) });
        break;
      }
      case 'COMPLETE_OFFBOARDING': {
        const open = requiredOpen(snap.get('offboarding'));
        if (open.length) throw errors.conflict('CHECKLIST_OPEN', `Finish the offboarding checklist first: ${open.map((i) => i.label).join(', ')}.`);
        // Offboarding ends system access in this organization.
        if (snap.get('uid')) {
          membershipRef = db.doc(`users/${snap.get('uid')}/memberships/${input.orgId}`);
          const m = await tx.get(membershipRef);
          membership = m.exists && m.get('status') === 'ACTIVE' ? (m.data() as Membership) : null;
        }
        break;
      }
    }

    tx.update(snap.ref, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    if (membershipRef && membership) {
      tx.update(membershipRef, { status: 'REVOKED', roles: [], revokedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
      recordAudit(tx, auditCtx(ctx), input.orgId, {
        action: 'staff.revoke',
        entityType: 'membership',
        entityId: snap.get('uid'),
        before: { roles: membership.roles, branchIds: membership.branchIds, status: membership.status },
        after: { roles: [], status: 'REVOKED' },
        reason: 'Offboarded',
      });
    }
    const effective = input.date ?? dateKeyIST(new Date());
    addHistory(tx, actor, input.orgId, input.employeeId, { type: 'STATUS', effectiveDate: effective, changes: { status: { from: status, to: rule.to } }, note: input.reason });
    recordAudit(tx, auditCtx(ctx), input.orgId, {
      action: `employee.${input.transition.toLowerCase()}`,
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: snap.get('branchId'),
      before: { status },
      after: { status: rule.to, date: input.date ?? null },
      reason: input.reason || null,
    });
    return { employeeId: input.employeeId, status: rule.to, revokedUid: membership ? (snap.get('uid') as string) : null };
  },
  async ({ revokedUid }) => {
    if (revokedUid) await syncClaims(revokedUid);
  },
);

/** Ticks (or unticks) an item of the current onboarding or offboarding checklist. */
export const checkItem = command(
  'employees-checkItem',
  z.strictObject({ orgId: id, employeeId: id, list: z.enum(['onboarding', 'offboarding']), key: z.string().min(1).max(40), done: z.boolean() }),
  async (ctx, tx) => {
    const { actor, input } = ctx;
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'employees.lifecycle', input.orgId, snap.get('branchId'), tx);
    const phase: Record<ChecklistKind, EmployeeStatus> = { onboarding: 'ONBOARDING', offboarding: 'OFFBOARDING' };
    if (snap.get('status') !== phase[input.list]) throw errors.conflict('INVALID_STATE', `The ${input.list} checklist is closed.`);
    const items = (snap.get(input.list) ?? []) as ChecklistItem[];
    const item = items.find((i) => i.key === input.key);
    if (!item) throw errors.notFound('Checklist item');
    const next = items.map((i) => (i.key === input.key ? { ...i, done: input.done, doneBy: input.done ? actor.email ?? actor.uid : null, doneAt: input.done ? new Date().toISOString() : null } : i));
    tx.update(snap.ref, { [input.list]: next, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, auditCtx(ctx), input.orgId, {
      action: 'employee.checklist',
      entityType: 'employee',
      entityId: input.employeeId,
      branchId: snap.get('branchId'),
      before: { [item.key]: item.done },
      after: { [item.key]: input.done },
    });
    return { employeeId: input.employeeId };
  },
);

/**
 * Links an employee record to a Stories account (for sign-in, roles and
 * self-service). A roles-only employee ID the account had is replaced by the
 * record's ID.
 */
export const linkAccount = command(
  'employees-linkAccount',
  z.strictObject({ orgId: id, employeeId: id, email: z.email().transform((e) => e.toLowerCase()) }),
  async (ctx, tx) => {
    const { actor, input } = ctx;
    const snap = await loadEmployee(tx, input.orgId, input.employeeId);
    await requireFor(actor, 'employees.edit', input.orgId, snap.get('branchId'), tx);
    if (snap.get('uid')) throw errors.conflict('ALREADY_LINKED', 'This employee is already linked to a Stories account.');
    const account = await accountFor(input.email);
    if (!account) throw errors.conflict('USER_NOT_FOUND', 'No Stories account uses this email. Ask the person to sign up first, then try again.');
    const other = await findEmployeeFor(tx, input.orgId, account.uid, null);
    if (other) throw errors.conflict('DUPLICATE_EMPLOYEE', `This account already belongs to ${other.get('fullName')} (${other.get('code')}).`);
    const dup = await tx.get(employeesCol(input.orgId).where('emailLower', '==', input.email).limit(2));
    const clash = dup.docs.find((d) => d.id !== input.employeeId);
    if (clash) throw errors.conflict('DUPLICATE_EMPLOYEE', `${clash.get('fullName')} (${clash.get('code')}) already uses this email.`);

    const mRef = db.doc(`users/${account.uid}/memberships/${input.orgId}`);
    const m = await tx.get(mRef);
    const oldCode = (m.get('employeeId') as string | undefined) ?? null;
    const code = snap.get('code') as string;
    const oldIndex = oldCode && oldCode !== code ? await tx.get(employeeCodeRef(input.orgId, oldCode)) : null;
    if (oldIndex?.exists && oldIndex.get('employeeDocId') && oldIndex.get('employeeDocId') !== input.employeeId) {
      throw errors.conflict('DUPLICATE_EMPLOYEE', `This account already uses employee ID ${oldCode}.`);
    }

    if (oldIndex?.exists && oldIndex.get('uid') === account.uid) tx.delete(oldIndex.ref);
    if (m.exists) tx.update(mRef, { employeeId: code });
    tx.set(employeeCodeRef(input.orgId, code), { uid: account.uid, employeeDocId: input.employeeId });
    tx.update(snap.ref, { uid: account.uid, email: input.email, emailLower: input.email, updatedAt: FieldValue.serverTimestamp() });
    addHistory(tx, actor, input.orgId, input.employeeId, { type: 'ACCOUNT', effectiveDate: dateKeyIST(new Date()), changes: { account: { from: null, to: input.email } } });
    recordAudit(tx, auditCtx(ctx), input.orgId, { action: 'employee.linkAccount', entityType: 'employee', entityId: input.employeeId, branchId: snap.get('branchId'), after: { uid: account.uid, email: input.email, replacedEmployeeId: oldCode !== code ? oldCode : null } });
    return { employeeId: input.employeeId, uid: account.uid };
  },
);

