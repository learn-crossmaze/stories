import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import { money } from '../catalog/model.js';
import { makeAvailable, nextWaiting, readCirculationConfig } from '../circulation/allocation.js';
import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { branchPatterns, bookNumber, existingCodes, reserveCodes } from '../core/numbering.js';
import { id, reason } from '../core/schemas.js';
import { copyRef, loadCopy, requireStatus, transition } from './copyOps.js';
import { CONDITIONS, IN_STOCK } from './copyState.js';

const barcode = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,32}$/, 'must be 4–32 letters, digits or dashes');
const note = z.string().trim().max(300).default('');

async function activeBranch(tx: FirebaseFirestore.Transaction, orgId: string, branchId: string) {
  const b = await tx.get(db.doc(`orgs/${orgId}/branches/${branchId}`));
  if (!b.exists || b.get('status') !== 'ACTIVE') throw errors.notFound('Branch');
  return b;
}

async function activeLocation(tx: FirebaseFirestore.Transaction, orgId: string, branchId: string, locationId: string | null) {
  if (!locationId) return;
  const l = await tx.get(db.doc(`orgs/${orgId}/branches/${branchId}/locations/${locationId}`));
  if (!l.exists || l.get('status') !== 'ACTIVE') throw errors.notFound('Shelf location');
}

/**
 * Adds physical copies of a catalogue title to a branch. Codes follow the
 * branch's copy pattern (default COPY-<book number>-NN); each barcode (defaults to the code) is unique in the
 * organization via orgs/{o}/barcodes. New copies go to waiting reservations first.
 */
export const acquire = command(
  'copies-acquire',
  z
    .strictObject({
      orgId: id,
      branchId: id,
      bookId: id,
      quantity: z.number().int().min(1).max(50),
      acquisitionCostMinor: money,
      condition: z.enum(CONDITIONS).default('NEW'),
      locationId: id.nullable().default(null),
      barcodes: z.array(barcode).max(50).default([]),
    })
    .refine((v) => v.barcodes.length === 0 || v.barcodes.length === v.quantity, 'barcodes must match the quantity')
    .refine((v) => new Set(v.barcodes).size === v.barcodes.length, 'contains a barcode twice'),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('copies.manage', input.orgId, input.branchId, tx);
    const branch = await activeBranch(tx, input.orgId, input.branchId);
    await activeLocation(tx, input.orgId, input.branchId, input.locationId);
    const book = await tx.get(db.doc(`books/${input.bookId}`));
    if (!book.exists || book.get('status') !== 'ACTIVE') throw errors.notFound('Active catalogue title');
    const bookCode = book.get('code') as string;
    const counter = await reserveCodes(tx, {
      kind: 'copy',
      pattern: branchPatterns(branch).copy,
      values: { BRANCH: branch.get('code'), BOOK: bookNumber(book) },
      base: `orgs/${input.orgId}/counters`,
      count: input.quantity,
      bookCode,
      taken: (c) => existingCodes(tx, `orgs/${input.orgId}/copies`, c),
    });
    const { codes } = counter;
    const barcodes = input.barcodes.length ? input.barcodes : codes;
    const barcodeSnaps = await Promise.all(barcodes.map((b) => tx.get(db.doc(`orgs/${input.orgId}/barcodes/${b}`))));
    const taken = barcodeSnaps.find((s) => s.exists);
    if (taken) throw errors.conflict('DUPLICATE_BARCODE', `Barcode ${taken.id} is already used by another copy.`);
    const waiting = await nextWaiting(tx, input.orgId, input.branchId, input.bookId, input.quantity);
    const { holdHours } = waiting.length ? await readCirculationConfig(tx, input.orgId) : { holdHours: 0 };

    counter.commit();
    const copyIds: string[] = [];
    codes.forEach((code, i) => {
      const ref = db.collection(`orgs/${input.orgId}/copies`).doc();
      copyIds.push(ref.id);
      tx.create(db.doc(`orgs/${input.orgId}/barcodes/${barcodes[i]}`), { copyId: ref.id });
      const copy = {
        code,
        barcode: barcodes[i],
        bookId: input.bookId,
        bookCode,
        bookTitle: book.get('title'),
        orgId: input.orgId,
        owningBranchId: input.branchId,
        currentBranchId: input.branchId,
        locationId: input.locationId,
        status: 'AVAILABLE',
        condition: input.condition,
        acquisitionCostMinor: input.acquisitionCostMinor,
        acquiredAt: FieldValue.serverTimestamp(),
        activeLoanId: null,
        activeReservationId: null,
        transferId: null,
        lifetimeLoans: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.create(ref, copy);
      tx.create(db.collection(`${ref.path}/events`).doc(), {
        type: 'ACQUIRED', actorUid: actor.uid, fromStatus: null, toStatus: 'AVAILABLE', condition: input.condition,
        note: null, ref: null, at: FieldValue.serverTimestamp(),
      });
    });
    // Hand new copies to members already waiting for this title here.
    waiting.forEach((res, i) => {
      const ref = db.doc(`orgs/${input.orgId}/copies/${copyIds[i]}`);
      tx.update(res.ref, {
        status: 'ALLOCATED', allocatedCopyId: ref.id, allocatedCopyCode: codes[i], allocatedAt: FieldValue.serverTimestamp(),
        holdUntil: Timestamp.fromMillis(Date.now() + holdHours * 3_600_000), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(db.doc(`orgs/${input.orgId}/members/${res.get('memberId')}`), {
        allocatedCount: FieldValue.increment(1),
        waitingCount: FieldValue.increment(-1),
      });
      tx.update(ref, { status: 'RESERVED', activeReservationId: res.id });
      tx.create(db.collection(`${ref.path}/events`).doc(), {
        type: 'RESERVATION_ALLOCATED', actorUid: actor.uid, fromStatus: 'AVAILABLE', toStatus: 'RESERVED', condition: input.condition,
        note: null, ref: { reservationId: res.id, memberId: res.get('memberId') }, at: FieldValue.serverTimestamp(),
      });
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'copies.acquire', entityType: 'book', entityId: input.bookId, branchId: input.branchId,
      after: { quantity: input.quantity, codes, acquisitionCostMinor: input.acquisitionCostMinor },
    });
    return { copyIds, codes };
  },
);

export const relocate = command(
  'copies-relocate',
  z.strictObject({ orgId: id, copyId: id, locationId: id.nullable() }),
  async ({ actor, input }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.manage', input.orgId, copy.currentBranchId, tx);
    await activeLocation(tx, input.orgId, copy.currentBranchId, input.locationId);
    tx.update(snap.ref, { locationId: input.locationId, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection(`${snap.ref.path}/events`).doc(), {
      type: 'RELOCATED', actorUid: actor.uid, fromStatus: copy.status, toStatus: copy.status, condition: copy.condition,
      note: null, ref: { from: copy.locationId, to: input.locationId }, at: FieldValue.serverTimestamp(),
    });
    return { copyId: input.copyId };
  },
);

export const recordCondition = command(
  'copies-recordCondition',
  z.strictObject({ orgId: id, copyId: id, condition: z.enum(CONDITIONS), note }),
  async ({ actor, input }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.manage', input.orgId, copy.currentBranchId, tx);
    requireStatus(copy, 'AVAILABLE', 'RESERVED', 'UNDER_INSPECTION', 'DAMAGED');
    tx.update(snap.ref, { condition: input.condition, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection(`${snap.ref.path}/events`).doc(), {
      type: 'CONDITION_RECORDED', actorUid: actor.uid, fromStatus: copy.status, toStatus: copy.status,
      condition: input.condition, note: input.note || null, ref: { previous: copy.condition }, at: FieldValue.serverTimestamp(),
    });
    return { copyId: input.copyId };
  },
);

/**
 * Finishes the inspection of a returned or found copy: PASS puts it back on
 * the shelf (or straight to a waiting reservation), DAMAGED takes it out.
 */
export const inspect = command(
  'copies-inspect',
  z.strictObject({ orgId: id, copyId: id, outcome: z.enum(['PASS', 'DAMAGED']), condition: z.enum(CONDITIONS), note }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.manage', input.orgId, copy.currentBranchId, tx);
    requireStatus(copy, 'UNDER_INSPECTION');
    const event = { type: 'INSPECTED', actorUid: actor.uid, note: input.note || null };
    if (input.outcome === 'DAMAGED') {
      transition(tx, snap, 'DAMAGED', { condition: input.condition }, event);
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
        action: 'copy.damaged', entityType: 'copy', entityId: input.copyId, branchId: copy.currentBranchId, reason: input.note || null,
      });
    } else {
      const [waiting] = await nextWaiting(tx, input.orgId, copy.currentBranchId, copy.bookId);
      const { holdHours } = await readCirculationConfig(tx, input.orgId);
      makeAvailable(tx, input.orgId, snap, { condition: input.condition }, event, waiting, holdHours);
    }
    return { copyId: input.copyId };
  },
);

/** A damaged copy was repaired and can circulate again. */
export const repair = command(
  'copies-repair',
  z.strictObject({ orgId: id, copyId: id, condition: z.enum(CONDITIONS), note }),
  async ({ actor, input }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.manage', input.orgId, copy.currentBranchId, tx);
    requireStatus(copy, 'DAMAGED');
    const [waiting] = await nextWaiting(tx, input.orgId, copy.currentBranchId, copy.bookId);
    const { holdHours } = await readCirculationConfig(tx, input.orgId);
    makeAvailable(tx, input.orgId, snap, { condition: input.condition }, { type: 'REPAIRED', actorUid: actor.uid, note: input.note || null }, waiting, holdHours);
    return { copyId: input.copyId };
  },
);

/** A copy on the shelf (not on loan) can't be found. Loans use circulation-declareLost. */
export const markLost = command(
  'copies-markLost',
  z.strictObject({ orgId: id, copyId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.writeOff', input.orgId, copy.currentBranchId, tx);
    requireStatus(copy, 'AVAILABLE', 'DAMAGED');
    transition(tx, snap, 'LOST', {}, { type: 'MARKED_LOST', actorUid: actor.uid, note: input.reason });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'copy.markLost', entityType: 'copy', entityId: input.copyId, branchId: copy.currentBranchId,
      before: { status: copy.status }, after: { status: 'LOST' }, reason: input.reason,
    });
    return { copyId: input.copyId };
  },
);

/** A lost copy turned up: it is inspected before circulating again. */
export const found = command(
  'copies-found',
  z.strictObject({ orgId: id, copyId: id, note }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.manage', input.orgId, copy.currentBranchId, tx);
    requireStatus(copy, 'LOST');
    transition(tx, snap, 'UNDER_INSPECTION', {}, { type: 'FOUND', actorUid: actor.uid, note: input.note || null });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'copy.found', entityType: 'copy', entityId: input.copyId, branchId: copy.currentBranchId,
    });
    return { copyId: input.copyId };
  },
);

/** Permanently withdraws a copy. The record and its history are kept forever. */
export const retire = command(
  'copies-retire',
  z.strictObject({ orgId: id, copyId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const { snap, copy } = await loadCopy(tx, input.orgId, input.copyId);
    await actor.require('copies.writeOff', input.orgId, copy.currentBranchId, tx);
    requireStatus(copy, 'AVAILABLE', 'DAMAGED', 'LOST');
    transition(tx, snap, 'RETIRED', { locationId: null }, { type: 'RETIRED', actorUid: actor.uid, note: input.reason });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'copy.retire', entityType: 'copy', entityId: input.copyId, branchId: copy.currentBranchId,
      before: { status: copy.status }, after: { status: 'RETIRED' }, reason: input.reason,
    });
    return { copyId: input.copyId };
  },
);

/**
 * Availability of a title per branch of an organization, counted live from
 * copies (no counters to drift). Readable by any signed-in user: it reveals
 * only counts, which members need to decide where to borrow.
 */
export const availability = query(
  'copies-availability',
  z.strictObject({ orgId: id, bookId: id }),
  async ({ input }) => {
    const branches = await db.collection(`orgs/${input.orgId}/branches`).where('status', '==', 'ACTIVE').get();
    const copies = db.collection(`orgs/${input.orgId}/copies`).where('bookId', '==', input.bookId);
    const rows = await Promise.all(
      branches.docs.map(async (b) => {
        const here = copies.where('currentBranchId', '==', b.id);
        const [available, total] = await Promise.all([
          here.where('status', '==', 'AVAILABLE').count().get(),
          here.where('status', 'in', [...IN_STOCK]).count().get(),
        ]);
        return { branchId: b.id, branchName: b.get('name') as string, available: available.data().count, total: total.data().count };
      }),
    );
    return { branches: rows.filter((r) => r.total > 0) };
  },
);

export { copyRef };
