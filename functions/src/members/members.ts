import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { searchTokens } from '../catalog/search.js';
import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { pad, reserveCounter } from '../core/counters.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { address, id, reason } from '../core/schemas.js';
import { ageOn, audienceFor, ADULT_AGE, type Member, normalizePhone } from './model.js';

const dob = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)')
  .refine((d) => !Number.isNaN(Date.parse(d)) && Date.parse(d) < Date.now(), 'must be in the past')
  .refine((d) => ageOn(d, new Date()) < 120, 'is not realistic');

const profile = {
  fullName: z.string().trim().min(2).max(80),
  dob,
  phone: z.string().trim().max(20).default(''),
  email: z.email().or(z.literal('')).default(''),
  address: address.nullable().default(null),
  guardianMemberId: id.nullable().default(null),
  guardianRelationship: z.string().trim().max(30).default(''),
};

export const memberRef = (orgId: string, memberId: string) => db.doc(`orgs/${orgId}/members/${memberId}`);

export async function loadMember(tx: Transaction, orgId: string, memberId: string) {
  const snap = await tx.get(memberRef(orgId, memberId));
  if (!snap.exists) throw errors.notFound('Member');
  return { snap, member: snap.data() as Member };
}

const memberTokens = (fullName: string, code: string, phone: string | null) =>
  searchTokens(fullName, code, phone?.replace('+91', '') ?? null);

/**
 * Validates the person-level rules shared by register/update: adults need a
 * phone; anyone under 18 needs an active adult guardian member (BUSINESS_RULES
 * D8); a phone number belongs to one member per organization.
 */
async function checkPerson(
  tx: Transaction,
  orgId: string,
  input: { dob: string; phone: string; guardianMemberId: string | null; guardianRelationship: string },
  selfId: string | null,
) {
  const age = ageOn(input.dob, new Date());
  const minor = age < ADULT_AGE;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw errors.invalid('Enter a valid mobile number, e.g. 98765 43210.');
  if (!minor && !phone) throw errors.invalid('Adult members need a mobile number.');

  let guardian: Member['guardian'] = null;
  if (minor) {
    if (!input.guardianMemberId) {
      throw errors.conflict('GUARDIAN_REQUIRED', 'Members under 18 need a guardian. Register the parent or guardian first.');
    }
    const g = await tx.get(memberRef(orgId, input.guardianMemberId));
    if (!g.exists || g.get('status') !== 'ACTIVE') throw errors.notFound('Guardian member');
    if (g.get('isMinor')) throw errors.conflict('GUARDIAN_MINOR', 'The guardian must be an adult member.');
    guardian = { memberId: g.id, name: g.get('fullName'), relationship: input.guardianRelationship || 'Guardian' };
  }

  const phoneRef = phone ? db.doc(`orgs/${orgId}/phoneIndex/${phone}`) : null;
  if (phoneRef) {
    const owner = await tx.get(phoneRef);
    if (owner.exists && owner.get('memberId') !== selfId) {
      throw errors.conflict('DUPLICATE_PHONE', 'Another member already uses this mobile number.');
    }
  }
  return { age, minor, phone, phoneRef, guardian };
}

/** Registers a member at the counter (self-service sign-up arrives in Phase 2). */
export const register = command(
  'members-register',
  z.strictObject({ orgId: id, homeBranchId: id, ...profile }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('members.manage', input.orgId, input.homeBranchId, tx);
    const branch = await tx.get(db.doc(`orgs/${input.orgId}/branches/${input.homeBranchId}`));
    if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
    const person = await checkPerson(tx, input.orgId, input, null);
    const counter = await reserveCounter(tx, `orgs/${input.orgId}/counters/members`);
    const code = `MEM-${pad(counter.value, 6)}`;
    const ref = db.collection(`orgs/${input.orgId}/members`).doc();

    const member: Member & Record<string, unknown> = {
      code,
      fullName: input.fullName,
      dob: input.dob,
      audience: audienceFor(person.age),
      isMinor: person.minor,
      phone: person.phone,
      email: input.email || null,
      address: input.address,
      homeBranchId: input.homeBranchId,
      branchId: input.homeBranchId,
      status: 'ACTIVE',
      guardian: person.guardian,
      accountHolderUid: null,
      householdId: null,
      activeSubscriptionId: null,
      nextSubscriptionId: null,
      subscriptionEndsAt: null,
      activeLoanCount: 0,
      allocatedCount: 0,
      waitingCount: 0,
      lifetimeLoans: 0,
      lifetimeExchanges: 0,
      searchTokens: memberTokens(input.fullName, code, person.phone),
    };
    counter.commit();
    if (person.phoneRef) tx.create(person.phoneRef, { memberId: ref.id });
    tx.create(ref, { ...member, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'member.register', entityType: 'member', entityId: ref.id, branchId: input.homeBranchId,
      after: { code, audience: member.audience, guardian: person.guardian?.memberId ?? null },
    });
    return { memberId: ref.id, code };
  },
);

/** Edits a member's personal details (home branch and status have their own commands). */
export const update = command(
  'members-update',
  z.strictObject({ orgId: id, memberId: id, ...profile }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('members.manage', input.orgId, member.homeBranchId, tx);
    if (member.status === 'CLOSED') throw errors.conflict('MEMBER_CLOSED', 'This membership is closed.');
    const person = await checkPerson(tx, input.orgId, input, input.memberId);

    if (member.phone && member.phone !== person.phone) tx.delete(db.doc(`orgs/${input.orgId}/phoneIndex/${member.phone}`));
    if (person.phoneRef && member.phone !== person.phone) tx.set(person.phoneRef, { memberId: input.memberId });
    const changes = {
      fullName: input.fullName,
      dob: input.dob,
      audience: audienceFor(person.age),
      isMinor: person.minor,
      phone: person.phone,
      email: input.email || null,
      address: input.address,
      guardian: person.guardian,
      searchTokens: memberTokens(input.fullName, member.code, person.phone),
    };
    tx.update(snap.ref, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'member.update', entityType: 'member', entityId: input.memberId, branchId: member.homeBranchId,
      before: { fullName: member.fullName, phone: member.phone, guardian: member.guardian?.memberId ?? null },
      after: { fullName: changes.fullName, phone: changes.phone, guardian: changes.guardian?.memberId ?? null },
    });
    return { memberId: input.memberId };
  },
);

/**
 * Suspends, reactivates or closes a membership. Closing requires every book
 * returned and the deposit settled (balance zero).
 */
export const setStatus = command(
  'members-setStatus',
  z.strictObject({ orgId: id, memberId: id, status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']), reason }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('members.manage', input.orgId, member.homeBranchId, tx);
    if (member.status === 'CLOSED') throw errors.conflict('MEMBER_CLOSED', 'This membership is closed and cannot change.');
    if (input.status === 'CLOSED') {
      const deposit = await tx.get(db.doc(`orgs/${input.orgId}/depositAccounts/${input.memberId}`));
      if (member.activeLoanCount > 0) throw errors.conflict('LOANS_OUTSTANDING', 'All borrowed books must be returned first.');
      if ((deposit.get('balanceMinor') ?? 0) > 0) throw errors.conflict('DEPOSIT_HELD', 'Settle and refund the security deposit first.');
    }
    tx.update(snap.ref, { status: input.status, updatedAt: FieldValue.serverTimestamp() });
    if (input.status === 'CLOSED' && member.phone) tx.delete(db.doc(`orgs/${input.orgId}/phoneIndex/${member.phone}`));
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'member.setStatus', entityType: 'member', entityId: input.memberId, branchId: member.homeBranchId,
      before: { status: member.status }, after: { status: input.status }, reason: input.reason,
    });
    return { memberId: input.memberId };
  },
);
