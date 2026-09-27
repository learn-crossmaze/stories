import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { findByBarcode, loadCopy, transition } from '../inventory/copyOps.js';
import { CONDITIONS } from '../inventory/copyState.js';
import { makeAvailable, nextWaiting, readCirculationConfig } from './allocation.js';

interface Item {
  copyId: string;
  code: string;
  bookTitle: string;
  received: boolean;
  conditionIn: string | null;
}

async function loadTransfer(tx: FirebaseFirestore.Transaction, orgId: string, transferId: string) {
  const snap = await tx.get(db.doc(`orgs/${orgId}/transfers/${transferId}`));
  if (!snap.exists) throw errors.notFound('Transfer');
  return snap;
}

/**
 * Drafts a transfer of shelf copies from one branch to another in the same
 * organization. Copies are only locked when the transfer is dispatched.
 */
export const create = command(
  'transfers-create',
  z.strictObject({
    orgId: id,
    fromBranchId: id,
    toBranchId: id,
    barcodes: z.array(z.string().trim().toUpperCase().min(4).max(32)).min(1).max(50),
    note: z.string().trim().max(300).default(''),
  }).refine((t) => t.fromBranchId !== t.toBranchId, 'must go to a different branch'),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('books.transfer', input.orgId, input.fromBranchId, tx);
    const to = await tx.get(db.doc(`orgs/${input.orgId}/branches/${input.toBranchId}`));
    if (!to.exists || to.get('status') !== 'ACTIVE') throw errors.notFound('Destination branch');
    const items: Item[] = [];
    for (const code of new Set(input.barcodes)) {
      const { snap, copy } = await findByBarcode(tx, input.orgId, code);
      if (copy.currentBranchId !== input.fromBranchId || copy.status !== 'AVAILABLE') {
        throw errors.conflict('COPY_NOT_AVAILABLE', `Copy ${copy.code} is not on this branch's shelf.`);
      }
      items.push({ copyId: snap.id, code: copy.code, bookTitle: copy.bookTitle, received: false, conditionIn: null });
    }
    const ref = db.collection(`orgs/${input.orgId}/transfers`).doc();
    tx.create(ref, {
      fromBranchId: input.fromBranchId, toBranchId: input.toBranchId, items, itemCount: items.length, status: 'DRAFT',
      note: input.note || null, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'transfer.create', entityType: 'transfer', entityId: ref.id, branchId: input.fromBranchId,
      after: { to: input.toBranchId, copies: items.map((i) => i.code) },
    });
    return { transferId: ref.id };
  },
);

/** Sends the copies: each must still be on the shelf; they become IN_TRANSIT. */
export const dispatch = command(
  'transfers-dispatch',
  z.strictObject({ orgId: id, transferId: id }),
  async ({ actor, input, requestId }, tx) => {
    const t = await loadTransfer(tx, input.orgId, input.transferId);
    await actor.require('books.transfer', input.orgId, t.get('fromBranchId'), tx);
    if (t.get('status') !== 'DRAFT') throw errors.conflict('TRANSFER_STATE', 'Only a draft transfer can be dispatched.');
    const items = t.get('items') as Item[];
    const copies = await Promise.all(items.map((i) => loadCopy(tx, input.orgId, i.copyId)));
    const bad = copies.find((c) => c.copy.status !== 'AVAILABLE' || c.copy.currentBranchId !== t.get('fromBranchId'));
    if (bad) throw errors.conflict('COPY_NOT_AVAILABLE', `Copy ${bad.copy.code} is no longer on the shelf. Remove it from the transfer first.`);
    for (const { snap } of copies) {
      transition(tx, snap, 'IN_TRANSIT', { transferId: t.id, locationId: null }, {
        type: 'TRANSFER_DISPATCHED', actorUid: actor.uid, ref: { transferId: t.id, to: t.get('toBranchId') },
      });
    }
    tx.update(t.ref, { status: 'IN_TRANSIT', dispatchedBy: actor.uid, dispatchedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'transfer.dispatch', entityType: 'transfer', entityId: t.id, branchId: t.get('fromBranchId'),
      before: { status: 'DRAFT' }, after: { status: 'IN_TRANSIT' },
    });
    return { transferId: t.id };
  },
);

/**
 * Receives scanned copies at the destination. Each must belong to this
 * transfer. Good copies go on the shelf there (or to a member waiting there);
 * damaged ones are set aside. Ownership (owningBranchId) never changes.
 */
export const receive = command(
  'transfers-receive',
  z.strictObject({
    orgId: id,
    transferId: id,
    items: z
      .array(z.strictObject({ barcode: z.string().trim().toUpperCase().min(4).max(32), condition: z.enum(CONDITIONS), damaged: z.boolean().default(false) }))
      .min(1)
      .max(50),
  }),
  async ({ actor, input, requestId }, tx) => {
    const t = await loadTransfer(tx, input.orgId, input.transferId);
    const toBranchId = t.get('toBranchId') as string;
    await actor.require('books.transfer', input.orgId, toBranchId, tx);
    if (t.get('status') !== 'IN_TRANSIT') throw errors.conflict('TRANSFER_STATE', 'This transfer is not in transit.');
    const items = (t.get('items') as Item[]).map((i) => ({ ...i }));
    const scanned = [];
    for (const it of input.items) {
      const { snap, copy } = await findByBarcode(tx, input.orgId, it.barcode);
      const line = items.find((i) => i.copyId === snap.id);
      if (!line) throw errors.conflict('NOT_IN_TRANSFER', `Copy ${copy.code} is not part of this transfer.`);
      if (line.received) throw errors.conflict('ALREADY_RECEIVED', `Copy ${copy.code} was already received.`);
      scanned.push({ snap, copy, line, it });
    }
    const { holdHours } = await readCirculationConfig(tx, input.orgId);
    const waitingByBook = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const s of scanned) {
      if (!s.it.damaged && !waitingByBook.has(s.copy.bookId)) {
        waitingByBook.set(s.copy.bookId, await nextWaiting(tx, input.orgId, toBranchId, s.copy.bookId, 10));
      }
    }

    for (const { snap, line, it, copy } of scanned) {
      line.received = true;
      line.conditionIn = it.condition;
      const event = { type: 'TRANSFER_RECEIVED', actorUid: actor.uid, ref: { transferId: t.id, from: t.get('fromBranchId') } };
      const patch = { currentBranchId: toBranchId, condition: it.condition, transferId: null };
      if (it.damaged) transition(tx, snap, 'DAMAGED', patch, event);
      else makeAvailable(tx, input.orgId, snap, patch, event, waitingByBook.get(copy.bookId)!.shift(), holdHours);
    }
    const complete = items.every((i) => i.received);
    tx.update(t.ref, {
      items,
      status: complete ? 'RECEIVED' : 'IN_TRANSIT',
      ...(complete ? { receivedBy: actor.uid, receivedAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'transfer.receive', entityType: 'transfer', entityId: t.id, branchId: toBranchId,
      after: { received: scanned.map((s) => ({ code: s.copy.code, condition: s.it.condition, damaged: s.it.damaged })), complete },
    });
    return { transferId: t.id, complete };
  },
);

/** Cancels a transfer that hasn't been dispatched yet. */
export const cancel = command(
  'transfers-cancel',
  z.strictObject({ orgId: id, transferId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const t = await loadTransfer(tx, input.orgId, input.transferId);
    await actor.require('books.transfer', input.orgId, t.get('fromBranchId'), tx);
    if (t.get('status') !== 'DRAFT') throw errors.conflict('TRANSFER_STATE', 'Only a draft transfer can be cancelled.');
    tx.update(t.ref, { status: 'CANCELLED', cancelReason: input.reason, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'transfer.cancel', entityType: 'transfer', entityId: t.id, branchId: t.get('fromBranchId'), reason: input.reason,
    });
    return { transferId: t.id };
  },
);
