import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { money } from '../catalogue/model.js';
import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { loadMember } from '../members/members.js';
import { queueWhatsApp, rupeesText } from '../messaging/whatsapp.js';
import { balanceOf, depositRef, postLedger } from './ledger.js';

/** Adjustments at or below this need no second person (orgs/{o}/config/deposits). Default 0: always maker-checker. */
async function makerCheckerThreshold(tx: FirebaseFirestore.Transaction, orgId: string) {
  const cfg = await tx.get(db.doc(`orgs/${orgId}/config/deposits`));
  return (cfg.get('makerCheckerThresholdMinor') as number | undefined) ?? 0;
}

/**
 * Proposes a deposit deduction (damage, loss) or adjustment. Nothing changes
 * until someone with deposits.approve approves it (maker-checker).
 */
export const proposeAdjustment = command(
  'deposits-proposeAdjustment',
  z.strictObject({
    orgId: id,
    memberId: id,
    kind: z.enum(['DEDUCTION', 'ADJUSTMENT']),
    amountMinor: money.refine((n) => n > 0, 'must be more than zero'),
    direction: z.enum(['CREDIT', 'DEBIT']).default('DEBIT'),
    reason,
    reference: z.string().trim().max(60).default(''),
  }),
  async ({ actor, input, requestId }, tx) => {
    const { member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('deposits.adjust', input.orgId, member.homeBranchId, tx);
    const account = await tx.get(depositRef(input.orgId, input.memberId));
    if (!account.exists) throw errors.conflict('NO_DEPOSIT', 'This member has no deposit account.');
    const delta = input.kind === 'DEDUCTION' || input.direction === 'DEBIT' ? -input.amountMinor : input.amountMinor;
    if (balanceOf(account) + delta < 0) throw errors.conflict('DEPOSIT_INSUFFICIENT', 'The deposit balance is not enough for this deduction.');
    const ref = db.collection(`orgs/${input.orgId}/depositAdjustments`).doc();
    const adj = {
      memberId: input.memberId, memberCode: member.code, memberName: member.fullName, branchId: member.homeBranchId,
      kind: input.kind, deltaMinor: delta, reason: input.reason, reference: input.reference || null,
      status: 'PENDING', proposedBy: actor.uid, proposedByEmail: actor.email,
    };
    tx.create(ref, { ...adj, createdAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'deposit.propose', entityType: 'depositAdjustment', entityId: ref.id, branchId: member.homeBranchId, memberId: input.memberId, after: adj, reason: input.reason,
    });
    return { adjustmentId: ref.id };
  },
);

/** Approves (posting to the ledger) or rejects a proposed adjustment. */
export const decideAdjustment = command(
  'deposits-decide',
  z.strictObject({ orgId: id, adjustmentId: id, decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(300).default('') }),
  async ({ actor, input, requestId }, tx) => {
    const ref = db.doc(`orgs/${input.orgId}/depositAdjustments/${input.adjustmentId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Deposit adjustment');
    const branchId = snap.get('branchId') as string;
    await actor.require('deposits.approve', input.orgId, branchId, tx);
    if (snap.get('status') !== 'PENDING') throw errors.conflict('ALREADY_DECIDED', 'This adjustment has already been decided.');
    const threshold = await makerCheckerThreshold(tx, input.orgId);
    const delta = snap.get('deltaMinor') as number;
    if (snap.get('proposedBy') === actor.uid && Math.abs(delta) > threshold) {
      throw errors.forbidden('A different person must approve an adjustment you proposed.');
    }
    const memberId = snap.get('memberId') as string;
    const account = await tx.get(depositRef(input.orgId, memberId));
    if (input.decision === 'APPROVE') {
      postLedger(tx, input.orgId, account, {
        memberId, branchId, type: snap.get('kind') === 'DEDUCTION' ? 'DEPOSIT_DEDUCTION' : 'DEPOSIT_ADJUSTMENT', deltaMinor: delta,
        reason: snap.get('reason'), reference: { adjustmentId: input.adjustmentId, ref: snap.get('reference') }, actorUid: snap.get('proposedBy'), approvedBy: actor.uid,
      });
    }
    tx.update(ref, { status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.uid, decidedAt: FieldValue.serverTimestamp(), note: input.note || null });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: `deposit.${input.decision.toLowerCase()}`, entityType: 'depositAdjustment', entityId: input.adjustmentId, branchId, memberId,
      before: { status: 'PENDING' }, after: { status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', deltaMinor: delta }, reason: input.note || null,
    });
    return { adjustmentId: input.adjustmentId };
  },
);

/**
 * Starts deposit settlement (BUSINESS_RULES §29): only once the subscription is
 * over and every book is back. New subscriptions are blocked while settling.
 */
export const startSettlement = command(
  'deposits-startSettlement',
  z.strictObject({ orgId: id, memberId: id }),
  async ({ actor, input, requestId }, tx) => {
    const { member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('deposits.adjust', input.orgId, member.homeBranchId, tx);
    const account = await tx.get(depositRef(input.orgId, input.memberId));
    const subs = await Promise.all(
      [member.activeSubscriptionId, member.nextSubscriptionId].filter(Boolean).map((s) => tx.get(db.doc(`orgs/${input.orgId}/subscriptions/${s}`))),
    );
    if (!account.exists || account.get('status') !== 'OPEN') throw errors.conflict('NOT_OPEN', 'There is no open deposit to settle.');
    if (member.activeLoanCount > 0) throw errors.conflict('LOANS_OUTSTANDING', 'All borrowed books must be returned before settlement.');
    if (subs.some((s) => s.get('status') === 'ACTIVE' && s.get('endAt').toMillis() > Date.now())) {
      throw errors.conflict('SUBSCRIPTION_ACTIVE', 'The subscription is still active. Settlement starts after it ends.');
    }
    tx.update(account.ref, { status: 'SETTLING', settlementStartedBy: actor.uid, settlementStartedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'deposit.startSettlement', entityType: 'depositAccount', entityId: input.memberId, branchId: member.homeBranchId, memberId: input.memberId,
      before: { status: 'OPEN', balanceMinor: balanceOf(account) }, after: { status: 'SETTLING' },
    });
    return { balanceMinor: balanceOf(account) };
  },
);

/** Refunds the remaining deposit (balance → 0) and closes the account. */
export const refund = command(
  'deposits-refund',
  z
    .strictObject({ orgId: id, memberId: id, method: z.enum(['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER']), reference: z.string().trim().max(60).default('') })
    .refine((p) => p.method === 'OFFLINE_CASH' || p.reference.length >= 4, 'needs the UPI/bank reference number'),
  async ({ actor, input, requestId }, tx) => {
    const { member } = await loadMember(tx, input.orgId, input.memberId);
    await actor.require('deposits.refund', input.orgId, member.homeBranchId, tx);
    const account = await tx.get(depositRef(input.orgId, input.memberId));
    const pending = await tx.get(
      db.collection(`orgs/${input.orgId}/depositAdjustments`).where('memberId', '==', input.memberId).where('status', '==', 'PENDING').limit(1),
    );
    if (!account.exists || account.get('status') !== 'SETTLING') throw errors.conflict('NOT_SETTLING', 'Start the settlement first.');
    if (member.activeLoanCount > 0) throw errors.conflict('LOANS_OUTSTANDING', 'All borrowed books must be returned before a refund.');
    if (!pending.empty) throw errors.conflict('ADJUSTMENTS_PENDING', 'Approve or reject the pending deposit adjustments first.');
    const amount = balanceOf(account);
    const payRef = db.collection(`orgs/${input.orgId}/payments`).doc();
    tx.create(payRef, {
      memberId: input.memberId, memberCode: member.code, branchId: member.homeBranchId, subscriptionId: null, purpose: 'DEPOSIT_REFUND',
      direction: 'OUT', lines: [{ type: 'DEPOSIT_REFUND', amountMinor: amount }], amountMinor: amount, currency: 'INR',
      method: input.method, reference: input.reference || null, status: 'SUCCESS', recordedBy: actor.uid, at: FieldValue.serverTimestamp(),
    });
    if (amount > 0) {
      postLedger(tx, input.orgId, account, {
        memberId: input.memberId, branchId: member.homeBranchId, type: 'DEPOSIT_REFUND', deltaMinor: -amount, reason: 'Deposit refunded on settlement',
        reference: { paymentId: payRef.id }, actorUid: actor.uid, approvedBy: actor.uid,
      });
    }
    tx.update(account.ref, { status: 'CLOSED', closedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'deposit.refund', entityType: 'depositAccount', entityId: input.memberId, branchId: member.homeBranchId, memberId: input.memberId,
      before: { status: 'SETTLING', balanceMinor: amount }, after: { status: 'CLOSED', balanceMinor: 0, paymentId: payRef.id },
    });
    if (amount > 0) {
      queueWhatsApp(tx, { orgId: input.orgId, branchId: member.homeBranchId, event: 'deposit_refunded', memberId: input.memberId, vars: { amount: rupeesText(amount) }, ref: { paymentId: payRef.id } });
    }
    return { refundedMinor: amount, paymentId: payRef.id };
  },
);
