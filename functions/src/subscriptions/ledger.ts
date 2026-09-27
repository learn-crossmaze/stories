import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';

import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';

export type LedgerType = 'DEPOSIT_COLLECTED' | 'DEPOSIT_DEDUCTION' | 'DEPOSIT_REFUND' | 'DEPOSIT_ADJUSTMENT';

export const depositRef = (orgId: string, memberId: string) => db.doc(`orgs/${orgId}/depositAccounts/${memberId}`);

export const balanceOf = (account: DocumentSnapshot | null) => (account?.exists ? (account.get('balanceMinor') as number) : 0);

/**
 * Write phase: the ONLY way a deposit balance changes. Appends an immutable
 * ledger entry and sets the new balance in the same transaction, so the
 * balance always equals the sum of the ledger. `account` must have been read
 * earlier in the transaction.
 */
export function postLedger(
  tx: Transaction,
  orgId: string,
  account: DocumentSnapshot,
  entry: {
    memberId: string;
    branchId: string;
    type: LedgerType;
    deltaMinor: number;
    reason: string;
    reference: Record<string, string | null>;
    actorUid: string;
    approvedBy?: string | null;
  },
): number {
  const balance = balanceOf(account) + entry.deltaMinor;
  if (balance < 0) throw errors.conflict('DEPOSIT_INSUFFICIENT', 'The deposit balance is not enough for this deduction.');
  const base = { memberId: entry.memberId, branchId: entry.branchId, balanceMinor: balance, updatedAt: FieldValue.serverTimestamp() };
  if (account.exists) tx.update(account.ref, base);
  else tx.create(account.ref, { ...base, status: 'OPEN', createdAt: FieldValue.serverTimestamp() });
  tx.create(db.collection(`${account.ref.path}/transactions`).doc(), {
    type: entry.type,
    deltaMinor: entry.deltaMinor,
    balanceAfterMinor: balance,
    reason: entry.reason,
    reference: entry.reference,
    createdBy: entry.actorUid,
    approvedBy: entry.approvedBy ?? null,
    memberId: entry.memberId,
    branchId: entry.branchId,
    at: FieldValue.serverTimestamp(),
  });
  return balance;
}
