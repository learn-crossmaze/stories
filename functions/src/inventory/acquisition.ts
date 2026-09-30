import { type DocumentSnapshot, FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';

import { nextWaiting, readCirculationConfig } from '../circulation/allocation.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { branchPatterns, existingCodes, reserveCodeBatch } from '../core/numbering.js';

/** One title's copies to add. `isNew`: created in the same transaction (so nobody can be waiting for it yet). */
export interface AcquisitionLine {
  bookId: string;
  bookCode: string;
  /** The catalogue number behind {BOOK} in copy codes (bookNumber() for an existing title). */
  bookNumber: string;
  title: string;
  quantity: number;
  acquisitionCostMinor: number;
  /** Pre-printed barcodes, one per copy; empty = the copy code is the barcode. */
  barcodes?: string[];
  isNew?: boolean;
}

/**
 * Plans adding copies of one or more titles to a branch (copies-acquire for
 * one title, copies-receive for a delivery): the reads — copy codes from the
 * branch's pattern, barcode uniqueness, members waiting for each title — and
 * a `write()` for the write phase. New copies go to waiting reservations first.
 */
export async function planAcquisition(
  tx: Transaction,
  opts: { orgId: string; branch: DocumentSnapshot; locationId: string | null; condition: string; actorUid: string; lines: AcquisitionLine[] },
) {
  const { orgId, branch } = opts;
  const batch = await reserveCodeBatch(tx, {
    kind: 'copy',
    pattern: branchPatterns(branch).copy,
    base: `orgs/${orgId}/counters`,
    requests: opts.lines.map((l) => ({ values: { BRANCH: branch.get('code') as string, BOOK: l.bookNumber }, count: l.quantity, bookCode: l.bookCode })),
    taken: (c) => existingCodes(tx, `orgs/${orgId}/copies`, c),
  });
  const barcodes = opts.lines.map((l, i) => (l.barcodes?.length ? l.barcodes : batch.codes[i]));
  const all = barcodes.flat();
  if (new Set(all).size !== all.length) throw errors.invalid('The same barcode is listed twice.');
  const barcodeSnaps = await Promise.all(all.map((b) => tx.get(db.doc(`orgs/${orgId}/barcodes/${b}`))));
  const taken = barcodeSnaps.find((s) => s.exists);
  if (taken) throw errors.conflict('DUPLICATE_BARCODE', `Barcode ${taken.id} is already used by another copy.`);
  const waiting = await Promise.all(opts.lines.map((l) => (l.isNew ? Promise.resolve([]) : nextWaiting(tx, orgId, branch.id, l.bookId, l.quantity))));
  const { holdHours } = waiting.some((w) => w.length) ? await readCirculationConfig(tx, orgId) : { holdHours: 0 };

  const results = opts.lines.map((l, i) => ({ bookId: l.bookId, codes: batch.codes[i], copyIds: batch.codes[i].map(() => db.collection(`orgs/${orgId}/copies`).doc().id) }));

  function write() {
    batch.commit();
    opts.lines.forEach((l, i) => {
      const { codes, copyIds } = results[i];
      codes.forEach((code, k) => {
        const ref = db.doc(`orgs/${orgId}/copies/${copyIds[k]}`);
        tx.create(db.doc(`orgs/${orgId}/barcodes/${barcodes[i][k]}`), { copyId: ref.id });
        tx.create(ref, {
          code,
          barcode: barcodes[i][k],
          bookId: l.bookId,
          bookCode: l.bookCode,
          bookTitle: l.title,
          orgId,
          owningBranchId: branch.id,
          currentBranchId: branch.id,
          locationId: opts.locationId,
          status: 'AVAILABLE',
          condition: opts.condition,
          acquisitionCostMinor: l.acquisitionCostMinor,
          acquiredAt: FieldValue.serverTimestamp(),
          activeLoanId: null,
          activeReservationId: null,
          transferId: null,
          lifetimeLoans: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(db.collection(`${ref.path}/events`).doc(), {
          type: 'ACQUIRED', actorUid: opts.actorUid, fromStatus: null, toStatus: 'AVAILABLE', condition: opts.condition,
          note: null, ref: null, at: FieldValue.serverTimestamp(),
        });
      });
      // Hand new copies to members already waiting for this title here.
      waiting[i].forEach((res, k) => {
        const ref = db.doc(`orgs/${orgId}/copies/${copyIds[k]}`);
        tx.update(res.ref, {
          status: 'ALLOCATED', allocatedCopyId: ref.id, allocatedCopyCode: codes[k], allocatedAt: FieldValue.serverTimestamp(),
          holdUntil: Timestamp.fromMillis(Date.now() + holdHours * 3_600_000), updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(db.doc(`orgs/${orgId}/members/${res.get('memberId')}`), {
          allocatedCount: FieldValue.increment(1),
          waitingCount: FieldValue.increment(-1),
        });
        tx.update(ref, { status: 'RESERVED', activeReservationId: res.id });
        tx.create(db.collection(`${ref.path}/events`).doc(), {
          type: 'RESERVATION_ALLOCATED', actorUid: opts.actorUid, fromStatus: 'AVAILABLE', toStatus: 'RESERVED', condition: opts.condition,
          note: null, ref: { reservationId: res.id, memberId: res.get('memberId') }, at: FieldValue.serverTimestamp(),
        });
      });
    });
  }
  return { results, allocated: waiting.reduce((n, w) => n + w.length, 0), write };
}
