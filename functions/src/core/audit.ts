import { FieldValue, type Transaction } from 'firebase-admin/firestore';

import { db } from './firebase.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  /** The member this change concerns, for the member's audit trail. */
  memberId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export interface AuditContext {
  actorUid: string;
  actorEmail?: string | null;
  requestId?: string;
}

/** The stored audit record (one shape for every writer). */
function auditDoc(ctx: AuditContext, entry: AuditEntry) {
  return {
    actorUid: ctx.actorUid,
    actorEmail: ctx.actorEmail ?? null,
    requestId: ctx.requestId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    branchId: entry.branchId ?? null,
    memberId: entry.memberId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    at: FieldValue.serverTimestamp(),
  };
}

const auditCol = (orgId: string | null) => (orgId ? db.collection(`orgs/${orgId}/auditLogs`) : db.collection('platformAuditLogs'));

/**
 * Records an audit entry inside the same transaction as the change, so a
 * change can never commit without its audit trail. `orgId: null` writes to
 * the platform log (actions that are not inside one organization).
 */
export function recordAudit(tx: Transaction, ctx: AuditContext, orgId: string | null, entry: AuditEntry) {
  tx.create(auditCol(orgId).doc(), auditDoc(ctx, entry));
}

/** Records an audit entry outside a transaction (for reads worth tracing, e.g. opening a private document). */
export async function recordAuditNow(ctx: AuditContext, orgId: string, entry: AuditEntry) {
  await auditCol(orgId).doc().create(auditDoc(ctx, entry));
}
