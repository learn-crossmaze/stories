import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { inOrder, readAll } from '../core/reads.js';
import { id, reason } from '../core/schemas.js';
import { activeLocation } from '../inventory/copies.js';
import { type Copy, copyRef, loadCopy, transition } from '../inventory/copyOps.js';
import { CONDITIONS } from '../inventory/copyState.js';
import { makeAvailable, nextWaiting, readCirculationConfig } from './allocation.js';

/** Copies in one transfer: dispatch writes two documents for each, receipt up to seven. */
export const TRANSFER_MAX = 50;

interface Item {
  copyId: string;
  code: string;
  /** The label staff scan. The destination can't read the copy while it travels, so it is kept here. */
  barcode: string;
  bookTitle: string;
  received: boolean;
  /** The copy's condition when it left: set at dispatch, null on a draft. */
  conditionOut: string | null;
  conditionIn: string | null;
}

async function loadTransfer(tx: FirebaseFirestore.Transaction, orgId: string, transferId: string) {
  const snap = await tx.get(db.doc(`orgs/${orgId}/transfers/${transferId}`));
  if (!snap.exists) throw errors.notFound('Transfer');
  return snap;
}

/** Write phase of a dispatch: every copy leaves the shelf and is on the road to the other branch. */
function sendCopies(tx: FirebaseFirestore.Transaction, copies: FirebaseFirestore.DocumentSnapshot[], transferId: string, toBranchId: string, actorUid: string) {
  for (const snap of copies) {
    transition(tx, snap, 'IN_TRANSIT', { transferId, locationId: null }, {
      type: 'TRANSFER_DISPATCHED', actorUid, ref: { transferId, to: toBranchId },
    });
  }
}

/**
 * A transfer of shelf copies from one branch to another in the same
 * organization. With `dispatch` the copies are sent in the same step (what
 * the console does); without it this is a draft, and the copies are only
 * locked when the draft is dispatched.
 */
export const create = command(
  'transfers-create',
  z.strictObject({
    orgId: id,
    fromBranchId: id,
    toBranchId: id,
    copyIds: z
      .array(id)
      .min(1)
      .max(TRANSFER_MAX, `send at most ${TRANSFER_MAX} copies in one transfer`)
      .refine((v) => new Set(v).size === v.length, 'contains a copy twice'),
    note: z.string().trim().max(300).default(''),
    dispatch: z.boolean().default(false),
  }).refine((t) => t.fromBranchId !== t.toBranchId, 'must go to a different branch'),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('books.transfer', input.orgId, input.fromBranchId, tx);
    const [to, ...snaps] = await tx.getAll(db.doc(`orgs/${input.orgId}/branches/${input.toBranchId}`), ...input.copyIds.map((c) => copyRef(input.orgId, c)));
    if (!to.exists || to.get('status') !== 'ACTIVE') throw errors.notFound('Destination branch');
    const items: Item[] = snaps.map((snap) => {
      if (!snap.exists) throw errors.notFound('Copy');
      const copy = snap.data() as Copy;
      // The ids come from the caller: this is what ties them to the branch the permission was checked at.
      if (copy.currentBranchId !== input.fromBranchId || copy.status !== 'AVAILABLE') {
        throw errors.conflict('COPY_NOT_AVAILABLE', `Copy ${copy.code} is not on this branch's shelf.`);
      }
      return {
        copyId: snap.id, code: copy.code, barcode: copy.barcode, bookTitle: copy.bookTitle, received: false,
        conditionOut: input.dispatch ? copy.condition : null, conditionIn: null,
      };
    });
    const ref = db.collection(`orgs/${input.orgId}/transfers`).doc();
    if (input.dispatch) sendCopies(tx, snaps, ref.id, input.toBranchId, actor.uid);
    tx.create(ref, {
      fromBranchId: input.fromBranchId, toBranchId: input.toBranchId, items, itemCount: items.length, status: input.dispatch ? 'IN_TRANSIT' : 'DRAFT',
      note: input.note || null, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
      ...(input.dispatch ? { dispatchedBy: actor.uid, dispatchedAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'transfer.create', entityType: 'transfer', entityId: ref.id, branchId: input.fromBranchId,
      after: { to: input.toBranchId, copies: items.map((i) => i.code) },
    });
    // The same two entries as a draft dispatched later, so the trail reads the same either way.
    if (input.dispatch) {
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
        action: 'transfer.dispatch', entityType: 'transfer', entityId: ref.id, branchId: input.fromBranchId,
        before: { status: 'DRAFT' }, after: { status: 'IN_TRANSIT' },
      });
    }
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
    sendCopies(tx, copies.map((c) => c.snap), t.id, t.get('toBranchId') as string, actor.uid);
    tx.update(t.ref, {
      status: 'IN_TRANSIT',
      // A draft's copies stay on the shelf, where their condition can still be changed: record it as they leave.
      items: items.map((i, k) => ({ ...i, conditionOut: copies[k].copy.condition })),
      dispatchedBy: actor.uid, dispatchedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
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
 * damaged ones are set aside. A copy keeps the condition it has unless one is
 * sent for it. With `locationId` (which also needs copies.manage there) the
 * copies that are free to shelve go straight onto that shelf; the ones held
 * for a member or damaged do not. Ownership (owningBranchId) never changes.
 */
export const receive = command(
  'transfers-receive',
  z.strictObject({
    orgId: id,
    transferId: id,
    locationId: id.nullable().default(null),
    items: z
      .array(z.strictObject({ barcode: z.string().trim().toUpperCase().min(4).max(32), condition: z.enum(CONDITIONS).optional(), damaged: z.boolean().default(false) }))
      .min(1)
      .max(TRANSFER_MAX),
  }),
  async ({ actor, input, requestId }, tx) => {
    const t = await loadTransfer(tx, input.orgId, input.transferId);
    const toBranchId = t.get('toBranchId') as string;
    await actor.require('books.transfer', input.orgId, toBranchId, tx);
    // Shelving is its own permission: receiving without a shelf needs books.transfer alone.
    if (input.locationId) await actor.require('copies.manage', input.orgId, toBranchId, tx);
    if (t.get('status') !== 'IN_TRANSIT') throw errors.conflict('TRANSFER_STATE', 'This transfer is not in transit.');
    const items = (t.get('items') as Item[]).map((i) => ({ ...i }));
    // The shelf is checked at the transfer's own destination, never at a branch the caller names.
    const [, snaps, seeMembers] = await inOrder([
      activeLocation(tx, input.orgId, toBranchId, input.locationId),
      readAll(tx, items.map((i) => copyRef(input.orgId, i.copyId))),
      actor.can('members.view', input.orgId, toBranchId, tx),
    ]);
    const copies = snaps.map((snap) => {
      if (!snap.exists) throw errors.notFound('Copy');
      return snap.data() as Copy;
    });
    // Each scan is matched against this transfer's own copies: the label first, then the copy code.
    const scanned = [];
    const seen = new Set<string>();
    for (const it of input.items) {
      let k = copies.findIndex((c) => c.barcode.trim().toUpperCase() === it.barcode);
      if (k < 0) k = copies.findIndex((c) => c.code.trim().toUpperCase() === it.barcode);
      if (k < 0) throw errors.conflict('NOT_IN_TRANSFER', `${it.barcode} is not part of this transfer.`);
      const [line, copy] = [items[k], copies[k]];
      if (line.received) throw errors.conflict('ALREADY_RECEIVED', `Copy ${copy.code} was already received.`);
      // Its label and its code both name it: received twice it would be moved twice, and could take two reservations.
      if (seen.has(line.copyId)) throw errors.invalid(`Copy ${copy.code} is listed twice.`);
      seen.add(line.copyId);
      scanned.push({ snap: snaps[k], copy, line, it, condition: it.condition ?? copy.condition });
    }
    const titles = [...new Set(scanned.filter((s) => !s.it.damaged).map((s) => s.copy.bookId))];
    const [{ holdHours }, ...queues] = await Promise.all([
      readCirculationConfig(tx, input.orgId),
      ...titles.map((bookId) => nextWaiting(tx, input.orgId, toBranchId, bookId, 10)),
    ]);
    const waitingByBook = new Map(titles.map((bookId, n) => [bookId, queues[n]]));

    const received = [];
    const allocated = [];
    let shelved = 0;
    for (const { snap, line, it, copy, condition } of scanned) {
      // Decided before the copy is written: a copy held for a member, or a damaged one, is not shelved.
      const waiting = it.damaged ? undefined : waitingByBook.get(copy.bookId)!.shift();
      const shelf = it.damaged || waiting ? null : input.locationId;
      line.received = true;
      line.conditionIn = condition;
      const event = { type: 'TRANSFER_RECEIVED', actorUid: actor.uid, ref: { transferId: t.id, from: t.get('fromBranchId') as string, ...(shelf ? { locationId: shelf } : {}) } };
      const patch = { currentBranchId: toBranchId, condition, transferId: null, ...(shelf ? { locationId: shelf } : {}) };
      if (it.damaged) transition(tx, snap, 'DAMAGED', patch, event);
      else makeAvailable(tx, input.orgId, snap, patch, event, waiting, holdHours);
      if (shelf) shelved += 1;
      if (waiting) {
        // Names only for staff who may see members here (the same rule that lets them read the reservation).
        allocated.push({
          code: copy.code, bookTitle: copy.bookTitle,
          memberName: seeMembers ? ((waiting.get('memberName') as string | undefined) ?? null) : null,
          memberCode: seeMembers ? ((waiting.get('memberCode') as string | undefined) ?? null) : null,
        });
      }
      received.push({ code: copy.code, condition, damaged: it.damaged, reservationId: waiting?.id ?? null });
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
      after: { received, complete, locationId: input.locationId },
    });
    return { transferId: t.id, complete, shelved, allocated };
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
