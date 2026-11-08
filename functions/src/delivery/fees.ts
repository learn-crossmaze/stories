import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id } from '../core/schemas.js';
import { loadMember } from '../members/members.js';
import { rupeesText } from '../messaging/whatsapp.js';
import { type Delivery, FEE_METHODS, loadDelivery } from './model.js';

// The delivery fee (docs/DELIVERY.md §3): collected at the door when the
// visit is reported, recorded at the counter later, or waived.

export type FeeMethod = (typeof FEE_METHODS)[number];

/** The fee once nothing is to be paid (waived by staff, or the visit was cancelled). */
export const WAIVED_FEE: Delivery['fee'] = { amountMinor: 0, status: 'FREE', method: 'WAIVED' };

/** Checks a fee payment's reference (needed except for cash). */
export function checkFeeReference(method: string, reference: string) {
  if (method !== 'OFFLINE_CASH' && reference.length < 4) throw errors.invalid('Enter the UPI or card reference for the fee.');
}

/**
 * Write phase: records the delivery fee as a payment from the member
 * (purpose DELIVERY_FEE) and returns the delivery's new `fee`. The caller
 * audits the change in the same transaction.
 */
export function collectFee(
  tx: Transaction,
  orgId: string,
  deliveryId: string,
  d: Pick<Delivery, 'memberId' | 'branchId' | 'fee'>,
  memberCode: string,
  method: FeeMethod,
  reference: string,
  actorUid: string,
): Delivery['fee'] {
  const payRef = db.collection(`orgs/${orgId}/payments`).doc();
  tx.create(payRef, {
    memberId: d.memberId, memberCode, branchId: d.branchId, subscriptionId: null, deliveryId,
    purpose: 'DELIVERY_FEE', direction: 'IN', lines: [{ type: 'DELIVERY_FEE', amountMinor: d.fee.amountMinor }], amountMinor: d.fee.amountMinor,
    currency: 'INR', method, reference: reference || null, gateway: null, status: 'SUCCESS', recordedBy: actorUid,
    at: FieldValue.serverTimestamp(),
  });
  return { ...d.fee, status: 'PAID', paymentId: payRef.id, method };
}

/**
 * Records the delivery fee paid at the counter later, or waives it. A fee is
 * only taken for a visit that happened (COMPLETED, or RETURNING with books
 * coming back after a delivered visit); waiving is always possible.
 */
export const recordFee = command(
  'deliveries-recordFee',
  z.strictObject({ orgId: id, deliveryId: id, method: z.enum([...FEE_METHODS, 'WAIVED']), reference: z.string().trim().max(60).default('') }),
  async ({ actor, input, requestId }, tx) => {
    const { ref, d } = await loadDelivery(tx, input.orgId, input.deliveryId);
    await actor.require('delivery.manage', input.orgId, d.branchId, tx);
    if (d.fee.status !== 'DUE') throw errors.conflict('NO_FEE_DUE', 'No delivery fee is due on this delivery.');
    let fee = WAIVED_FEE;
    if (input.method !== 'WAIVED') {
      if (!['COMPLETED', 'RETURNING'].includes(d.status) || d.outcome !== 'DELIVERED') {
        throw errors.conflict('NOT_DELIVERED', 'The fee is taken only for a visit that happened. Waive it instead.');
      }
      checkFeeReference(input.method, input.reference);
      const { member } = await loadMember(tx, input.orgId, d.memberId);
      fee = collectFee(tx, input.orgId, input.deliveryId, d, member.code, input.method, input.reference, actor.uid);
    }
    tx.update(ref, { fee, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'delivery.fee', entityType: 'delivery', entityId: input.deliveryId, branchId: d.branchId, memberId: d.memberId,
      before: { fee: d.fee.status, amount: rupeesText(d.fee.amountMinor) }, after: { fee: fee.status, method: input.method, paymentId: fee.paymentId ?? null },
    });
    return { fee: fee.status };
  },
);
