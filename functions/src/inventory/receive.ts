import { type DocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';

import { bulkBookSchema, planNewBooks } from '../catalogue/books.js';
import { money } from '../catalogue/model.js';
import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { pad } from '../core/counters.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { bookNumber } from '../core/numbering.js';
import { id } from '../core/schemas.js';
import { type AcquisitionLine, planAcquisition } from './acquisition.js';
import { activeBranch, activeLocation } from './copies.js';
import { CONDITIONS } from './copyState.js';

/** Titles per call and copies per call (each copy writes three documents; a transaction takes 500). */
export const RECEIVE_MAX_TITLES = 25;
export const RECEIVE_MAX_COPIES = 100;

const counts = { quantity: z.number().int().min(1).max(50), acquisitionCostMinor: money };
const item = z.union([z.strictObject({ bookId: id, ...counts }), z.strictObject({ book: bulkBookSchema, ...counts })]);

/**
 * Receives a delivery of books at a branch (Collection → Receive stock), in
 * one transaction: titles not yet in the catalogue are added (looked up by
 * ISBN, as on "Add by ISBN"), and every title gets its copies at the branch
 * (as "Add copies" does), with codes from the branch's pattern, the shelf and
 * condition chosen for the delivery, and members already waiting served
 * first. An ISBN that is already in the catalogue just gets copies.
 */
export const receive = command(
  'copies-receive',
  z
    .strictObject({
      orgId: id,
      branchId: id,
      locationId: id.nullable().default(null),
      condition: z.enum(CONDITIONS).default('NEW'),
      items: z.array(item).min(1).max(RECEIVE_MAX_TITLES, `receive at most ${RECEIVE_MAX_TITLES} titles at a time`),
    })
    .refine((v) => v.items.reduce((n, i) => n + i.quantity, 0) <= RECEIVE_MAX_COPIES, `receive at most ${RECEIVE_MAX_COPIES} copies at a time`),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('copies.manage', input.orgId, input.branchId, tx);
    const newItems = input.items.flatMap((i) => ('book' in i ? [i] : []));
    if (newItems.length) await actor.requireCatalog('books.create', tx);
    const branch = await activeBranch(tx, input.orgId, input.branchId);
    await activeLocation(tx, input.orgId, input.branchId, input.locationId);

    // Titles: new ones planned (an ISBN already in the catalogue becomes an existing title), existing ones read.
    const books = await planNewBooks(tx, newItems.map((i) => i.book));
    // The same title listed twice (or an ISBN that turns out to be in the catalogue) is one line.
    const lines = new Map<string, { quantity: number; cost: number }>();
    for (const i of input.items) {
      const bookId = 'bookId' in i ? i.bookId : books.bookIds[newItems.indexOf(i)];
      const line = lines.get(bookId);
      lines.set(bookId, line ? { quantity: line.quantity + i.quantity, cost: line.cost } : { quantity: i.quantity, cost: i.acquisitionCostMinor });
    }
    const createdIds = new Set(books.created.map((c) => c.bookId));
    const existingSnaps = new Map<string, DocumentSnapshot>();
    for (const bookId of lines.keys()) {
      if (createdIds.has(bookId)) continue;
      const snap = await tx.get(db.doc(`books/${bookId}`));
      if (!snap.exists || snap.get('status') !== 'ACTIVE') throw errors.notFound(`Active catalogue title ${snap.get('title') ?? bookId}`);
      existingSnaps.set(bookId, snap);
    }
    const acquisition: AcquisitionLine[] = [...lines.entries()].map(([bookId, l]) => {
      const made = books.created.find((c) => c.bookId === bookId);
      const snap = existingSnaps.get(bookId);
      return made
        ? { bookId, bookCode: made.code, bookNumber: pad(made.number, 6), title: made.title, quantity: l.quantity, acquisitionCostMinor: l.cost, isNew: true }
        : { bookId, bookCode: snap!.get('code') as string, bookNumber: bookNumber(snap!), title: snap!.get('title') as string, quantity: l.quantity, acquisitionCostMinor: l.cost };
    });
    const plan = await planAcquisition(tx, { orgId: input.orgId, branch, locationId: input.locationId, condition: input.condition, actorUid: actor.uid, lines: acquisition });

    books.write();
    plan.write();
    const received = plan.results.map((r, i) => ({ ...r, title: acquisition[i].title, isNew: !!acquisition[i].isNew }));
    const copies = received.reduce((n, r) => n + r.codes.length, 0);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'copies.receive', entityType: 'branch', entityId: input.branchId, branchId: input.branchId,
      after: {
        copies,
        titles: received.map((r) => `${r.title} ×${r.codes.length}`),
        newTitles: books.created.map((c) => `${c.code} ${c.isbn}`),
        newAuthorsAndPublishers: books.newRefs,
        allocatedToReservations: plan.allocated,
      },
    });
    return {
      received: received.map(({ bookId, title, codes, copyIds, isNew }) => ({ bookId, title, codes, copyIds, isNew })),
      newTitles: books.created.map(({ isbn, bookId, code }) => ({ isbn, bookId, code })),
      copies,
      allocated: plan.allocated,
    };
  },
);
