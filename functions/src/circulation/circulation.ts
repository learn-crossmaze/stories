import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { id, reason } from '../core/schemas.js';
import { type Copy, findByBarcode, loadCopy, transition } from '../inventory/copyOps.js';
import { loadMember } from '../members/members.js';
import type { Member } from '../members/model.js';
import { balanceOf, depositRef } from '../billing/ledger.js';
import { requireActiveTerm, type Term } from '../billing/term.js';

const barcodes = z
  .array(z.string().trim().toUpperCase().min(4).max(32))
  .min(1)
  .max(10)
  .refine((b) => new Set(b).size === b.length, 'lists the same copy twice');

// ------------------------------------------------------------------ shared read/write phases
//
// Circulation rules (BUSINESS_RULES 5–8): borrowing needs an active term; the
// plan's limit is on books held *at the same time* (loans + allocated holds);
// exchanges are unlimited; there is no due date and no fine — ever.

interface IssuePlan {
  copies: { snap: DocumentSnapshot; copy: Copy; reservation: DocumentSnapshot | null }[];
}

async function readIssue(tx: Transaction, orgId: string, branchId: string, memberId: string, codes: string[]): Promise<IssuePlan> {
  const copies = [];
  for (const code of codes) {
    const { snap, copy } = await findByBarcode(tx, orgId, code);
    if (copy.currentBranchId !== branchId) throw errors.conflict('WRONG_BRANCH', `Copy ${copy.code} belongs on another branch's shelf.`);
    let reservation: DocumentSnapshot | null = null;
    if (copy.status === 'RESERVED') {
      reservation = await tx.get(db.doc(`orgs/${orgId}/reservations/${copy.activeReservationId}`));
      if (reservation.get('memberId') !== memberId || reservation.get('status') !== 'ALLOCATED') {
        throw errors.conflict('RESERVED_FOR_OTHER', `Copy ${copy.code} is being held for another member.`);
      }
    } else if (copy.status !== 'AVAILABLE') {
      throw errors.conflict('COPY_NOT_AVAILABLE', `Copy ${copy.code} is not available (${copy.status.toLowerCase().replace('_', ' ')}).`);
    }
    copies.push({ snap, copy, reservation });
  }
  return { copies };
}

function checkLimit(member: Member, term: Term, returning: number, plan: IssuePlan) {
  const fulfilled = plan.copies.filter((c) => c.reservation).length;
  const held = member.activeLoanCount - returning + plan.copies.length + (member.allocatedCount - fulfilled);
  if (held > term.max) {
    const holds = member.allocatedCount - fulfilled;
    throw errors.conflict(
      'LIMIT_REACHED',
      `The plan allows ${term.max} book${term.max === 1 ? '' : 's'} at a time. After this, ${member.fullName} would hold ${held}` +
        `${holds > 0 ? ` (including ${holds} reserved)` : ''}. Return a book first or choose fewer.`,
    );
  }
}

function writeIssue(tx: Transaction, orgId: string, branchId: string, member: Member, memberId: string, term: Term, plan: IssuePlan, actorUid: string, exchangeId: string | null) {
  const loanIds: string[] = [];
  for (const { snap, copy, reservation } of plan.copies) {
    const loanRef = db.collection(`orgs/${orgId}/loans`).doc();
    loanIds.push(loanRef.id);
    tx.create(loanRef, {
      memberId, memberCode: member.code, memberName: member.fullName, subscriptionId: term.snap.id,
      copyId: snap.id, copyCode: copy.code, bookId: copy.bookId, bookTitle: copy.bookTitle, branchId,
      status: 'ACTIVE', channel: 'COUNTER', issuedAt: FieldValue.serverTimestamp(), issuedBy: actorUid,
      returnedAt: null, returnedBy: null, returnBranchId: null, returnCondition: null, exchangeId,
      reservationId: reservation?.id ?? null,
    });
    transition(tx, snap, 'ISSUED', {
      activeLoanId: loanRef.id, activeReservationId: null, locationId: null, lifetimeLoans: FieldValue.increment(1),
    }, { type: 'ISSUED', actorUid, ref: { loanId: loanRef.id, memberId } });
    if (reservation) {
      tx.update(reservation.ref, { status: 'FULFILLED', fulfilledLoanId: loanRef.id, updatedAt: FieldValue.serverTimestamp() });
    }
  }
  return loanIds;
}

interface ReturnItem {
  snap: DocumentSnapshot;
  copy: Copy;
  loan: DocumentSnapshot;
}

async function readReturns(tx: Transaction, orgId: string, codes: string[], memberId?: string): Promise<ReturnItem[]> {
  const items = [];
  for (const code of codes) {
    const { snap, copy } = await findByBarcode(tx, orgId, code);
    if (copy.status !== 'ISSUED' || !copy.activeLoanId) throw errors.conflict('NOT_ON_LOAN', `Copy ${copy.code} is not on loan.`);
    const loan = await tx.get(db.doc(`orgs/${orgId}/loans/${copy.activeLoanId}`));
    if (memberId && loan.get('memberId') !== memberId) throw errors.conflict('OTHER_MEMBER', `Copy ${copy.code} is on loan to another member.`);
    items.push({ snap, copy, loan });
  }
  return items;
}

/** Returned copies go to inspection at the branch that received them; ownership never changes. */
function writeReturns(tx: Transaction, branchId: string, items: ReturnItem[], actorUid: string, exchangeId: string | null) {
  for (const { snap, loan } of items) {
    tx.update(loan.ref, {
      status: 'RETURNED', returnedAt: FieldValue.serverTimestamp(), returnedBy: actorUid, returnBranchId: branchId,
      ...(exchangeId ? { exchangeId } : {}),
    });
    transition(tx, snap, 'UNDER_INSPECTION', { activeLoanId: null, currentBranchId: branchId }, {
      type: 'RETURNED', actorUid, ref: { loanId: loan.id, memberId: loan.get('memberId') },
    });
  }
}

// ------------------------------------------------------------------ commands

/** Issues one or more copies to a member at the counter (atomic: all or none). */
export const issue = command(
  'circulation-issue',
  z.strictObject({ orgId: id, branchId: id, memberId: id, barcodes }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('loans.issue', input.orgId, input.branchId, tx);
    const { snap: memberSnap, member } = await loadMember(tx, input.orgId, input.memberId);
    const term = await requireActiveTerm(tx, input.orgId, member);
    const plan = await readIssue(tx, input.orgId, input.branchId, input.memberId, input.barcodes);
    checkLimit(member, term, 0, plan);

    const loanIds = writeIssue(tx, input.orgId, input.branchId, member, input.memberId, term, plan, actor.uid, null);
    const fulfilled = plan.copies.filter((c) => c.reservation).length;
    tx.update(memberSnap.ref, {
      ...(term.rollover ?? {}),
      activeLoanCount: FieldValue.increment(plan.copies.length),
      allocatedCount: FieldValue.increment(-fulfilled),
      lifetimeLoans: FieldValue.increment(plan.copies.length),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'circulation.issue', entityType: 'member', entityId: input.memberId, branchId: input.branchId, memberId: input.memberId,
      after: { loanIds, copies: plan.copies.map((c) => c.copy.code), titles: plan.copies.map((c) => c.copy.bookTitle) },
    });
    return { loanIds };
  },
);

/** Takes books back. Always allowed — even after the subscription has expired. */
export const returnCopies = command(
  'circulation-return',
  z.strictObject({ orgId: id, branchId: id, barcodes }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('loans.return', input.orgId, input.branchId, tx);
    const items = await readReturns(tx, input.orgId, input.barcodes);
    const perMember = new Map<string, number>();
    for (const i of items) perMember.set(i.loan.get('memberId'), (perMember.get(i.loan.get('memberId')) ?? 0) + 1);

    writeReturns(tx, input.branchId, items, actor.uid, null);
    for (const [memberId, n] of perMember) {
      tx.update(db.doc(`orgs/${input.orgId}/members/${memberId}`), { activeLoanCount: FieldValue.increment(-n), updatedAt: FieldValue.serverTimestamp() });
    }
    // One entry per member, so each member's audit trail shows their returns.
    for (const memberId of perMember.keys()) {
      const mine = items.filter((i) => i.loan.get('memberId') === memberId);
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
        action: 'circulation.return', entityType: 'loan', entityId: mine[0].loan.id, branchId: input.branchId, memberId,
        after: { loanIds: mine.map((i) => i.loan.id), copies: mine.map((i) => i.copy.code), titles: mine.map((i) => i.copy.bookTitle) },
      });
    }
    return { loanIds: items.map((i) => i.loan.id), members: [...perMember.keys()] };
  },
);

/**
 * Exchange: return some books and take others in one step. There is no
 * exchange quota; the only limit is how many books are held at once.
 */
export const exchange = command(
  'circulation-exchange',
  z.strictObject({ orgId: id, branchId: id, memberId: id, returnBarcodes: barcodes, issueBarcodes: barcodes }),
  async ({ actor, input, requestId }, tx) => {
    await actor.require('exchanges.process', input.orgId, input.branchId, tx);
    const { snap: memberSnap, member } = await loadMember(tx, input.orgId, input.memberId);
    const term = await requireActiveTerm(tx, input.orgId, member);
    const returns = await readReturns(tx, input.orgId, input.returnBarcodes, input.memberId);
    const plan = await readIssue(tx, input.orgId, input.branchId, input.memberId, input.issueBarcodes);
    checkLimit(member, term, returns.length, plan);

    const exRef = db.collection(`orgs/${input.orgId}/exchanges`).doc();
    writeReturns(tx, input.branchId, returns, actor.uid, exRef.id);
    const loanIds = writeIssue(tx, input.orgId, input.branchId, member, input.memberId, term, plan, actor.uid, exRef.id);
    const count = Math.min(returns.length, plan.copies.length);
    const fulfilled = plan.copies.filter((c) => c.reservation).length;
    tx.create(exRef, {
      memberId: input.memberId, memberCode: member.code, branchId: input.branchId, subscriptionId: term.snap.id,
      returnedLoanIds: returns.map((r) => r.loan.id), issuedLoanIds: loanIds, count, by: actor.uid, at: FieldValue.serverTimestamp(),
    });
    tx.update(term.snap.ref, { exchangesThisTerm: FieldValue.increment(count) });
    tx.update(memberSnap.ref, {
      ...(term.rollover ?? {}),
      activeLoanCount: FieldValue.increment(plan.copies.length - returns.length),
      allocatedCount: FieldValue.increment(-fulfilled),
      lifetimeLoans: FieldValue.increment(plan.copies.length),
      lifetimeExchanges: FieldValue.increment(count),
      updatedAt: FieldValue.serverTimestamp(),
    });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'circulation.exchange', entityType: 'member', entityId: input.memberId, branchId: input.branchId, memberId: input.memberId,
      after: { exchangeId: exRef.id, returned: returns.map((r) => r.copy.code), issued: plan.copies.map((c) => c.copy.code) },
    });
    return { exchangeId: exRef.id, loanIds };
  },
);

/**
 * A borrowed book is lost. The loan and copy become LOST, the member's slot is
 * freed, and a deposit deduction is *proposed* for approval (BUSINESS_RULES
 * D5) — charge = the title's replacement price, else the copy's cost.
 */
export const declareLost = command(
  'circulation-declareLost',
  z.strictObject({ orgId: id, loanId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    const loanRef = db.doc(`orgs/${input.orgId}/loans/${input.loanId}`);
    const loan = await tx.get(loanRef);
    if (!loan.exists) throw errors.notFound('Loan');
    const branchId = loan.get('branchId') as string;
    await actor.require('copies.writeOff', input.orgId, branchId, tx);
    if (loan.get('status') !== 'ACTIVE') throw errors.conflict('NOT_ACTIVE', 'Only an active loan can be declared lost.');
    const memberId = loan.get('memberId') as string;
    const { snap: memberSnap, member } = await loadMember(tx, input.orgId, memberId);
    const { snap: copySnap, copy } = await loadCopy(tx, input.orgId, loan.get('copyId'));
    const book = await tx.get(db.doc(`books/${copy.bookId}`));
    const account = await tx.get(depositRef(input.orgId, memberId));

    const charge = (book.get('replacementPriceMinor') as number) || copy.acquisitionCostMinor;
    const proposed = Math.min(charge, balanceOf(account));
    tx.update(loanRef, { status: 'LOST', lostAt: FieldValue.serverTimestamp(), lostReason: input.reason });
    transition(tx, copySnap, 'LOST', { activeLoanId: null }, { type: 'LOST_ON_LOAN', actorUid: actor.uid, note: input.reason, ref: { loanId: loan.id, memberId } });
    tx.update(memberSnap.ref, { activeLoanCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
    let adjustmentId: string | null = null;
    if (proposed > 0) {
      const adjRef = db.collection(`orgs/${input.orgId}/depositAdjustments`).doc();
      adjustmentId = adjRef.id;
      tx.create(adjRef, {
        memberId, memberCode: member.code, memberName: member.fullName, branchId: member.homeBranchId, kind: 'DEDUCTION',
        deltaMinor: -proposed, chargeMinor: charge, uncoveredMinor: charge - proposed,
        reason: `Lost book: ${copy.bookTitle} (${copy.code}). ${input.reason}`, reference: loan.id,
        status: 'PENDING', proposedBy: actor.uid, proposedByEmail: actor.email, createdAt: FieldValue.serverTimestamp(),
      });
    }
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, input.orgId, {
      action: 'loan.declareLost', entityType: 'loan', entityId: loan.id, branchId, memberId: loan.get('memberId'),
      before: { status: 'ACTIVE' }, after: { status: 'LOST', chargeMinor: charge, proposedDeductionMinor: proposed, adjustmentId }, reason: input.reason,
    });
    return { adjustmentId, chargeMinor: charge, proposedMinor: proposed };
  },
);
