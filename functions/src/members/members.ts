import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { searchTokens } from '../catalogue/search.js';
import { aadhaarInput, aadhaarKey } from '../core/aadhaar.js';
import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { branchPatterns, existingCodes, reserveCodes } from '../core/numbering.js';
import { address, id, reason } from '../core/schemas.js';
import { ageOn, audienceFor, ADULT_AGE, type Member, normalizePhone } from './model.js';
import { queueWhatsApp } from '../messaging/whatsapp.js';

const dob = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)')
  .refine((d) => !Number.isNaN(Date.parse(d)) && Date.parse(d) < Date.now(), 'must be in the past')
  .refine((d) => ageOn(d, new Date()) < 120, 'is not realistic');

export const profile = {
  fullName: z.string().trim().min(2).max(80),
  dob,
  phone: z.string().trim().max(20).default(''),
  email: z.email().or(z.literal('')).default(''),
  address: address.nullable().default(null),
  guardianMemberId: id.nullable().default(null),
  guardianRelationship: z.string().trim().max(30).default(''),
  /** Optional; '' keeps the number on file. Only the last four digits are readable (private/aadhaar holds it). */
  aadhaar: aadhaarInput,
};

export const memberRef = (orgId: string, memberId: string) => db.doc(`orgs/${orgId}/members/${memberId}`);

export async function loadMember(tx: Pick<Transaction, 'get'>, orgId: string, memberId: string) {
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

export type MemberProfile = Omit<z.infer<z.ZodObject<typeof profile>>, 'aadhaar'> & { aadhaar?: string };

const aadhaarRef = (orgId: string, memberId: string) => db.doc(`orgs/${orgId}/members/${memberId}/private/aadhaar`);

/**
 * Reads for recording a member's Aadhaar number: one person, one membership
 * per organization (orgs/{o}/aadhaarIndex/{hash} — the number itself is not in
 * the index). Returns the writes, or null when the number is left as it is.
 */
async function planAadhaar(tx: Transaction, orgId: string, memberId: string, number: string | undefined, isNew: boolean) {
  if (!number) return null;
  const indexRef = db.doc(`orgs/${orgId}/aadhaarIndex/${aadhaarKey(orgId, number)}`);
  const [owner, old] = await Promise.all([tx.get(indexRef), isNew ? Promise.resolve(null) : tx.get(aadhaarRef(orgId, memberId))]);
  if (owner.exists && owner.get('memberId') !== memberId) {
    throw errors.conflict('DUPLICATE_AADHAAR', 'Another member is already registered with this Aadhaar number.');
  }
  const previous = old?.exists ? (old.get('number') as string) : null;
  return (actorUid: string) => {
    if (previous === number) return;
    if (previous) tx.delete(db.doc(`orgs/${orgId}/aadhaarIndex/${aadhaarKey(orgId, previous)}`));
    tx.set(indexRef, { memberId });
    tx.set(aadhaarRef(orgId, memberId), { number, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid });
  };
}

/**
 * Creates a member record (reads first, then writes): checks the person
 * (phone, guardian for minors), numbers them with the branch's member pattern
 * and writes the record. Staff registration and self sign-up share it.
 */
export async function createMember(
  tx: Transaction,
  input: MemberProfile & { orgId: string; homeBranchId: string },
  opts: { actorUid: string; actorEmail: string | null; requestId?: string; accountHolderUid: string | null; source: 'STAFF' | 'SELF' },
) {
  const branch = await tx.get(db.doc(`orgs/${input.orgId}/branches/${input.homeBranchId}`));
  if (!branch.exists || branch.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
  const person = await checkPerson(tx, input.orgId, input, null);
  const counter = await reserveCodes(tx, {
    kind: 'member',
    pattern: branchPatterns(branch).member,
    values: { BRANCH: branch.get('code') },
    base: `orgs/${input.orgId}/counters`,
    taken: (c) => existingCodes(tx, `orgs/${input.orgId}/members`, c),
  });
  const [code] = counter.codes;
  const ref = db.collection(`orgs/${input.orgId}/members`).doc();
  const aadhaar = await planAadhaar(tx, input.orgId, ref.id, input.aadhaar, true);

  const member: Member & Record<string, unknown> = {
    code,
    fullName: input.fullName,
    dob: input.dob,
    audience: audienceFor(person.age),
    isMinor: person.minor,
    phone: person.phone,
    email: input.email || null,
    // Lower-case copy: members sign in to the app with this email (me-overview links by it).
    emailLower: input.email ? input.email.toLowerCase() : null,
    address: input.address,
    homeBranchId: input.homeBranchId,
    branchId: input.homeBranchId,
    status: 'ACTIVE',
    guardian: person.guardian,
    accountHolderUid: opts.accountHolderUid,
    householdId: null,
    activeSubscriptionId: null,
    nextSubscriptionId: null,
    subscriptionEndsAt: null,
    planName: null,
    renewalDueAt: null,
    activeLoanCount: 0,
    allocatedCount: 0,
    waitingCount: 0,
    lifetimeLoans: 0,
    lifetimeExchanges: 0,
    searchTokens: memberTokens(input.fullName, code, person.phone),
    source: opts.source,
    aadhaarLast4: input.aadhaar ? input.aadhaar.slice(-4) : null,
  };
  counter.commit();
  aadhaar?.(opts.actorUid);
  if (person.phoneRef) tx.create(person.phoneRef, { memberId: ref.id });
  tx.create(ref, { ...member, createdBy: opts.actorUid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  queueWhatsApp(tx, { orgId: input.orgId, branchId: input.homeBranchId, event: 'member_welcome', memberId: ref.id, ref: { memberId: ref.id } });
  recordAudit(tx, { actorUid: opts.actorUid, actorEmail: opts.actorEmail, requestId: opts.requestId }, input.orgId, {
    action: opts.source === 'SELF' ? 'member.selfRegister' : 'member.register',
    entityType: 'member',
    entityId: ref.id,
    branchId: input.homeBranchId,
    memberId: ref.id,
    after: { code, audience: member.audience, guardian: person.guardian?.memberId ?? null, accountHolderUid: opts.accountHolderUid },
  });
  return { memberId: ref.id, code };
}

/** Registers a member at the counter. Members can also sign themselves up (me-join). */
export const register = command(
  'members-register',
  z.strictObject({ orgId: id, homeBranchId: id, ...profile }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('members.manage', input.orgId, input.homeBranchId, tx);
    return createMember(tx, input, { actorUid: actor.uid, actorEmail: actor.email, requestId, accountHolderUid: null, source: 'STAFF' });
  },
);

/** Edits a member's personal details (home branch and status have their own commands). */
export const update = command(
  'members-update',
  z.strictObject({ orgId: id, memberId: id, ...profile, whatsappOptOut: z.boolean().optional() }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('members.manage', input.orgId, member.homeBranchId, tx);
    if (member.status === 'CLOSED') throw errors.conflict('MEMBER_CLOSED', 'This membership is closed.');
    const person = await checkPerson(tx, input.orgId, input, input.memberId);
    const aadhaar = await planAadhaar(tx, input.orgId, input.memberId, input.aadhaar, false);

    aadhaar?.(actor.uid);
    if (member.phone && member.phone !== person.phone) tx.delete(db.doc(`orgs/${input.orgId}/phoneIndex/${member.phone}`));
    if (person.phoneRef && member.phone !== person.phone) tx.set(person.phoneRef, { memberId: input.memberId });
    const changes = {
      fullName: input.fullName,
      dob: input.dob,
      audience: audienceFor(person.age),
      isMinor: person.minor,
      phone: person.phone,
      email: input.email || null,
      // Lower-case copy: members sign in to the app with this email (me-overview links by it).
      emailLower: input.email ? input.email.toLowerCase() : null,
      address: input.address,
      guardian: person.guardian,
      searchTokens: memberTokens(input.fullName, member.code, person.phone),
      ...(input.aadhaar ? { aadhaarLast4: input.aadhaar.slice(-4) } : {}),
      ...(input.whatsappOptOut !== undefined ? { whatsappOptOut: input.whatsappOptOut } : {}),
    };
    tx.update(snap.ref, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'member.update', entityType: 'member', entityId: input.memberId, branchId: member.homeBranchId, memberId: input.memberId,
      before: { fullName: member.fullName, phone: member.phone, guardian: member.guardian?.memberId ?? null },
      after: { fullName: changes.fullName, phone: changes.phone, guardian: changes.guardian?.memberId ?? null, ...(input.aadhaar ? { aadhaarLast4: input.aadhaar.slice(-4) } : {}) },
    });
    return { memberId: input.memberId };
  },
);

/** Shows a member's full Aadhaar number to staff who manage members at the branch, and records that they did. */
export const revealAadhaar = command(
  'members-revealAadhaar',
  z.strictObject({ orgId: id, memberId: id }),
  async ({ actor, input, requestId }, tx) => {
    const { member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('members.manage', input.orgId, member.homeBranchId, tx);
    const doc = await tx.get(aadhaarRef(input.orgId, input.memberId));
    if (!doc.exists) throw errors.notFound('Aadhaar number');
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'member.revealAadhaar', entityType: 'member', entityId: input.memberId, branchId: member.homeBranchId, memberId: input.memberId,
    });
    return { aadhaar: doc.get('number') as string };
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
      action: 'member.setStatus', entityType: 'member', entityId: input.memberId, branchId: member.homeBranchId, memberId: input.memberId,
      before: { status: member.status }, after: { status: input.status }, reason: input.reason,
    });
    const statusText = { ACTIVE: 'active again', SUSPENDED: 'paused', CLOSED: 'closed' }[input.status];
    queueWhatsApp(tx, { orgId: input.orgId, branchId: member.homeBranchId, event: 'membership_status', memberId: input.memberId, vars: { status: statusText }, ref: { memberId: input.memberId } });
    return { memberId: input.memberId };
  },
);

/**
 * One-time fill of the member list fields (`planName`, `renewalDueAt`) for a
 * branch's members registered before those fields existed. The member list
 * calls it once per branch; afterwards payments keep the fields current.
 * Safe to repeat (recomputed from the subscriptions).
 */
export const indexList = query('members-indexList', z.strictObject({ orgId: id, branchId: id }), async ({ actor, input }) => {
  await actor.require('members.view', input.orgId, input.branchId);
  const branchRef = db.doc(`orgs/${input.orgId}/branches/${input.branchId}`);
  const branch = await branchRef.get();
  if (!branch.exists) throw errors.notFound('Branch');
  if (branch.get('memberListIndexedAt')) return { updated: 0 };
  const members = await db.collection(`orgs/${input.orgId}/members`).where('homeBranchId', '==', input.branchId).select().get();
  const ids = members.docs.map((d) => d.id);
  const latest = new Map<string, { endAt: FirebaseFirestore.Timestamp; planName: string }>();
  for (let i = 0; i < ids.length; i += 30) {
    const subs = await db
      .collection(`orgs/${input.orgId}/subscriptions`)
      .where('memberId', 'in', ids.slice(i, i + 30))
      .select('memberId', 'status', 'endAt', 'planSnapshot.name')
      .get();
    for (const s of subs.docs) {
      if (!['ACTIVE', 'EXPIRED'].includes(s.get('status')) || !s.get('endAt')) continue;
      const endAt = s.get('endAt') as FirebaseFirestore.Timestamp;
      const prev = latest.get(s.get('memberId'));
      if (!prev || prev.endAt.toMillis() < endAt.toMillis()) latest.set(s.get('memberId'), { endAt, planName: s.get('planSnapshot.name') });
    }
  }
  const writer = db.bulkWriter();
  // A member changed since it was read (e.g. paid just now) already has fresh fields: skip it, don't retry.
  writer.onWriteError(() => false);
  for (const d of members.docs) {
    const l = latest.get(d.id);
    writer.update(d.ref, { planName: l?.planName ?? null, renewalDueAt: l?.endAt ?? null }, { lastUpdateTime: d.updateTime }).catch(() => undefined);
  }
  await writer.close();
  await branchRef.update({ memberListIndexedAt: FieldValue.serverTimestamp() });
  return { updated: members.size };
});
