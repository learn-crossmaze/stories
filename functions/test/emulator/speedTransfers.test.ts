import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import * as catalog from '../../src/catalogue/books.js';
import * as res from '../../src/circulation/reservations.js';
import * as xfer from '../../src/circulation/transfers.js';
import { db } from '../../src/core/firebase.js';
import * as copies from '../../src/inventory/copies.js';
import * as locations from '../../src/inventory/locations.js';
import * as members from '../../src/members/members.js';
import { clearSwitchboardCache } from '../../src/messaging/whatsapp.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as roles from '../../src/organization/roles.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// Transfers between branches: sent in one command from copy ids, received against the transfer's own copies,
// shelved on receipt, and the copies held for waiting members named.

let sa: TestUser, lib: TestUser, central1: TestUser;
let org: string, central: string, north: string, authorId: string, bookId: string, planId: string;

const get = async (p: string) => (await db.doc(`orgs/${org}/${p}`).get()).data()!;
const count = async (p: string) => (await db.collection(`orgs/${org}/${p}`).get()).size;
const events = async (copyId: string, type: string) =>
  (await db.collection(`orgs/${org}/copies/${copyId}/events`).where('type', '==', type).get()).docs.map((d) => d.data());
const audit = async (action: string) => (await db.collection(`orgs/${org}/auditLogs`).where('action', '==', action).get()).docs.map((d) => d.data());

async function newBook(title: string) {
  return (await call<{ bookId: string }>(catalog.create, sa, {
    title, isbn: '', authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
  })).bookId;
}
/** New copies (condition NEW) at a branch: their ids and codes. */
function acquire(quantity: number, extra: Record<string, unknown> = {}) {
  return call<{ copyIds: string[]; codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: central, bookId, quantity, acquisitionCostMinor: 39900, ...extra });
}
/** A member of the North branch with a paid plan, so they can reserve. */
async function reader(fullName: string) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const { memberId } = await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: north, fullName, dob: '1990-05-01', phone });
  const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId });
  await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
  return memberId;
}
const waitAtNorth = (memberId: string, book = bookId) =>
  call<{ reservationId: string; status: string }>(res.place, lib, { orgId: org, memberId, bookId: book, branchId: north });
const shelfAt = async (branchId: string, code: string) =>
  (await call<{ locationId: string }>(locations.create, lib, { orgId: org, branchId, code, label: `Shelf ${code}`, kind: 'SHELF' })).locationId;
/** Central to North, dispatched in the same command. */
const send = (copyIds: string[], requestId: string = randomUUID()) =>
  call<{ transferId: string }>(xfer.create, lib, { orgId: org, fromBranchId: central, toBranchId: north, copyIds, dispatch: true }, requestId);
interface Received {
  transferId: string;
  complete: boolean;
  shelved: number;
  allocated: { code: string; bookTitle: string; memberName: string | null; memberCode: string | null }[];
}
const receive = (transferId: string, items: Record<string, unknown>[], extra: Record<string, unknown> = {}, by = lib) =>
  call<Received>(xfer.receive, by, { orgId: org, transferId, items, ...extra });

beforeEach(async () => {
  await resetEmulators();
  clearSwitchboardCache();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [lib, central1] = await Promise.all(['lib', 'central1'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central, north] });
  await call(staff.setRoles, sa, { orgId: org, email: central1.email, roles: ['LIBRARIAN'], branchIds: [central] });
  authorId = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Robert Louis Stevenson' })).id;
  bookId = await newBook('Treasure Island');
  planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Monthly Two', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 100000, maxSimultaneousBooks: 2, audiences: ['CHILDREN', 'TEENS', 'ADULTS'],
  })).planId;
});

describe('sending a transfer in one command', () => {
  it('creates the transfer already on its way: copies in transit, one event each, both audit entries, and a replay changes nothing', async () => {
    const shelf = await shelfAt(central, 'A-1');
    const { copyIds, codes } = await acquire(2, { locationId: shelf });
    const requestId = randomUUID();
    const { transferId } = await send(copyIds, requestId);

    for (const copyId of copyIds) {
      expect(await get(`copies/${copyId}`)).toMatchObject({ status: 'IN_TRANSIT', transferId, locationId: null, currentBranchId: central });
      const sent = await events(copyId, 'TRANSFER_DISPATCHED');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ fromStatus: 'AVAILABLE', toStatus: 'IN_TRANSIT', actorUid: lib.uid, ref: { transferId, to: north } });
    }
    const transfer = await get(`transfers/${transferId}`);
    expect(transfer).toMatchObject({ status: 'IN_TRANSIT', fromBranchId: central, toBranchId: north, itemCount: 2, createdBy: lib.uid, dispatchedBy: lib.uid });
    expect(transfer.dispatchedAt).toBeTruthy();
    expect(transfer.items).toEqual(copyIds.map((copyId, n) => ({ copyId, code: codes[n], barcode: codes[n], bookTitle: 'Treasure Island', received: false, conditionOut: 'NEW', conditionIn: null })));
    // The trail reads as a draft dispatched later would: two entries, here from the one request.
    expect(await audit('transfer.create')).toEqual([expect.objectContaining({ entityId: transferId, requestId, branchId: central, after: { to: north, copies: codes } })]);
    expect(await audit('transfer.dispatch')).toEqual([expect.objectContaining({ entityId: transferId, requestId, before: { status: 'DRAFT' }, after: { status: 'IN_TRANSIT' } })]);

    // The same request again (a retry after a lost reply) answers the same and writes nothing.
    expect(await send(copyIds, requestId)).toEqual({ transferId });
    expect(await count('transfers')).toBe(1);
    expect(await events(copyIds[0], 'TRANSFER_DISPATCHED')).toHaveLength(1);
    expect(await audit('transfer.dispatch')).toHaveLength(1);
  });

  it('is all or nothing: a copy that is elsewhere or not on the shelf, a copy named twice or an unknown one stops it', async () => {
    const { copyIds: [a, b] } = await acquire(2);
    const { copyIds: [atNorth] } = await acquire(1, { branchId: north });
    expect(await failure(send([a, atNorth]))).toBe('COPY_NOT_AVAILABLE');
    expect(await failure(send([a, a]))).toBe('INVALID_INPUT');
    expect(await failure(send([a, 'no-such-copy']))).toBe('NOT_FOUND');
    expect(await failure(send(Array.from({ length: 51 }, (_, n) => `copy-${n}`)))).toBe('INVALID_INPUT');
    expect(await failure(call(xfer.create, lib, { orgId: org, fromBranchId: central, toBranchId: central, copyIds: [a], dispatch: true }))).toBe('INVALID_INPUT');
    // Barcodes are no longer accepted: the caller sends the copies it already looked up.
    expect(await failure(call(xfer.create, lib, { orgId: org, fromBranchId: central, toBranchId: north, barcodes: ['COPY-000001-01'] }))).toBe('INVALID_INPUT');
    // The permission is checked at the sending branch before anything is read.
    expect(await failure(call(xfer.create, central1, { orgId: org, fromBranchId: north, toBranchId: central, copyIds: ['no-such-copy'], dispatch: true }))).toBe('FORBIDDEN');
    expect(await count('transfers')).toBe(0);
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'AVAILABLE', transferId: null });

    await send([a]);
    // Already on its way: it can't go into a second transfer.
    expect(await failure(send([a, b]))).toBe('COPY_NOT_AVAILABLE');
    expect(await get(`copies/${b}`)).toMatchObject({ status: 'AVAILABLE' });
    expect(await count('transfers')).toBe(1);
  });

  it('still drafts when not asked to dispatch, and records the condition each copy leaves in when the draft is sent', async () => {
    const { copyIds: [a] } = await acquire(1);
    const { transferId } = await call<{ transferId: string }>(xfer.create, lib, { orgId: org, fromBranchId: central, toBranchId: north, copyIds: [a] });
    expect(await get(`transfers/${transferId}`)).toMatchObject({ status: 'DRAFT', items: [expect.objectContaining({ copyId: a, conditionOut: null })] });
    expect((await get(`transfers/${transferId}`)).dispatchedBy).toBeUndefined();
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'AVAILABLE' });
    expect(await audit('transfer.dispatch')).toHaveLength(0);
    // A draft's copy is still on the shelf, where its condition can change.
    await call(copies.recordCondition, lib, { orgId: org, copyId: a, condition: 'FAIR', note: '' });
    await call(xfer.dispatch, lib, { orgId: org, transferId });
    expect(await get(`transfers/${transferId}`)).toMatchObject({ status: 'IN_TRANSIT', dispatchedBy: lib.uid, items: [expect.objectContaining({ copyId: a, conditionOut: 'FAIR', received: false })] });
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'IN_TRANSIT', transferId });
    expect(await events(a, 'TRANSFER_DISPATCHED')).toHaveLength(1);
  });
});

describe('receiving a transfer', () => {
  it('matches scans against the transfer itself: by label or by copy code, refusing strangers, repeats and a copy named twice', async () => {
    const { copyIds: [a, b, c], codes: [codeA, codeB, codeC] } = await acquire(3, { barcodes: ['PRE-0001', 'PRE-0002', 'PRE-0003'] });
    const { codes: [stranger] } = await acquire(1);
    const { transferId } = await send([a, b, c]);
    expect((await get(`transfers/${transferId}`)).items[0]).toMatchObject({ code: codeA, barcode: 'PRE-0001' });

    // A copy of this organization that is not in the transfer, and a code nobody knows, are refused alike.
    expect(await failure(receive(transferId, [{ barcode: stranger }]))).toBe('NOT_IN_TRANSFER');
    expect(await failure(receive(transferId, [{ barcode: 'NO-SUCH-CODE' }]))).toBe('NOT_IN_TRANSFER');
    // Its label and its code name one copy: together they are refused, and nothing is received.
    expect(await failure(receive(transferId, [{ barcode: 'PRE-0001' }, { barcode: codeA }]))).toBe('INVALID_INPUT');
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'IN_TRANSIT' });

    // By pre-printed label (lower case as typed), then by copy code; the transfer stays open until all are in.
    expect(await receive(transferId, [{ barcode: 'pre-0001' }])).toMatchObject({ complete: false, shelved: 0, allocated: [] });
    expect(await receive(transferId, [{ barcode: codeB }])).toMatchObject({ complete: false });
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'AVAILABLE', currentBranchId: north, owningBranchId: central, transferId: null, locationId: null });
    expect(await get(`copies/${b}`)).toMatchObject({ status: 'AVAILABLE', currentBranchId: north });
    expect(await failure(receive(transferId, [{ barcode: codeA }]))).toBe('ALREADY_RECEIVED');
    expect(await failure(receive(transferId, [{ barcode: codeC }, { barcode: 'PRE-0002' }]))).toBe('ALREADY_RECEIVED');
    expect(await get(`copies/${c}`)).toMatchObject({ status: 'IN_TRANSIT', currentBranchId: central });
    expect(await receive(transferId, [{ barcode: codeC }])).toMatchObject({ complete: true });
    expect(await get(`transfers/${transferId}`)).toMatchObject({ status: 'RECEIVED', receivedBy: lib.uid });
  });

  it('keeps the condition a copy arrived in unless one is sent, and records the one it used', async () => {
    const { copyIds: [a, b, c], codes: [codeA, codeB, codeC] } = await acquire(3);
    const { transferId } = await send([a, b, c]);
    await receive(transferId, [{ barcode: codeA }, { barcode: codeB, condition: 'GOOD' }, { barcode: codeC, damaged: true }]);
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'AVAILABLE', condition: 'NEW' });
    expect(await get(`copies/${b}`)).toMatchObject({ status: 'AVAILABLE', condition: 'GOOD' });
    expect(await get(`copies/${c}`)).toMatchObject({ status: 'DAMAGED', condition: 'NEW', currentBranchId: north });
    expect((await get(`transfers/${transferId}`)).items.map((i: { conditionIn: string }) => i.conditionIn)).toEqual(['NEW', 'GOOD', 'NEW']);
    expect((await events(a, 'TRANSFER_RECEIVED'))[0]).toMatchObject({ condition: 'NEW', ref: { transferId, from: central } });
    expect((await events(b, 'TRANSFER_RECEIVED'))[0]).toMatchObject({ condition: 'GOOD' });
    expect(await audit('transfer.receive')).toEqual([
      expect.objectContaining({
        entityId: transferId, branchId: north,
        after: {
          received: [
            { code: codeA, condition: 'NEW', damaged: false, reservationId: null },
            { code: codeB, condition: 'GOOD', damaged: false, reservationId: null },
            { code: codeC, condition: 'NEW', damaged: true, reservationId: null },
          ],
          complete: true, locationId: null,
        },
      }),
    ]);
  });

  it('hands arriving copies to the members waiting there, oldest first, never a damaged one, and says which to set aside', async () => {
    await db.doc(`orgs/${org}/config/whatsapp`).set({ branches: { [north]: ['reservation_ready'] } });
    clearSwitchboardCache();
    const shelf = await shelfAt(north, 'N-1');
    const [ava, ben] = [await reader('Ava Rao'), await reader('Ben Das')];
    const first = await waitAtNorth(ava);
    const second = await waitAtNorth(ben);
    expect([first.status, second.status]).toEqual(['WAITING', 'WAITING']);
    const other = await newBook('Kidnapped');
    const { copyIds: [a, b, c], codes: [codeA, codeB, codeC] } = await acquire(3);
    const { copyIds: [d], codes: [codeD] } = await acquire(1, { bookId: other });
    const { transferId } = await send([a, b, c, d]);

    // The damaged copy is skipped: Ava (first in line) gets the next good one, and nobody waits for the other title.
    const done = await receive(transferId, [{ barcode: codeA, damaged: true }, { barcode: codeB }, { barcode: codeD }], { locationId: shelf });
    expect(done).toMatchObject({ complete: false, shelved: 1 });
    expect(done.allocated).toEqual([{ code: codeB, bookTitle: 'Treasure Island', memberName: 'Ava Rao', memberCode: (await get(`members/${ava}`)).code }]);
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'DAMAGED', locationId: null });
    // Held for a member: not on the shelf that was picked for the rest.
    expect(await get(`copies/${b}`)).toMatchObject({ status: 'RESERVED', activeReservationId: first.reservationId, locationId: null, currentBranchId: north });
    expect(await get(`copies/${d}`)).toMatchObject({ status: 'AVAILABLE', locationId: shelf });
    expect((await events(d, 'TRANSFER_RECEIVED'))[0].ref).toEqual({ transferId, from: central, locationId: shelf });
    expect((await events(b, 'TRANSFER_RECEIVED'))[0].ref).toEqual({ transferId, from: central });
    expect(await events(b, 'RESERVATION_ALLOCATED')).toHaveLength(1);
    expect(await get(`reservations/${first.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: b, allocatedCopyCode: codeB });
    expect(await get(`reservations/${second.reservationId}`)).toMatchObject({ status: 'WAITING' });
    expect(await get(`members/${ava}`)).toMatchObject({ allocatedCount: 1, waitingCount: 0 });
    expect(await get(`members/${ben}`)).toMatchObject({ allocatedCount: 0, waitingCount: 1 });
    const ready = await db.collection(`orgs/${org}/whatsappOutbox`).where('event', '==', 'reservation_ready').get();
    expect(ready.docs.map((m) => m.get('ref.reservationId'))).toEqual([first.reservationId]);
    // The audit entry carries the shelf and the reservation, never a member's name.
    const [entry] = await audit('transfer.receive');
    expect(entry.after).toEqual({
      received: [
        { code: codeA, condition: 'NEW', damaged: true, reservationId: null },
        { code: codeB, condition: 'NEW', damaged: false, reservationId: first.reservationId },
        { code: codeD, condition: 'NEW', damaged: false, reservationId: null },
      ],
      complete: false, locationId: shelf,
    });

    // The last copy goes to Ben, the next in line.
    const rest = await receive(transferId, [{ barcode: codeC }]);
    expect(rest).toMatchObject({ complete: true, shelved: 0, allocated: [expect.objectContaining({ code: codeC, memberName: 'Ben Das' })] });
    expect(await get(`reservations/${second.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: c });
  });

  it('shelves on receipt, a part at a time, only on an open shelf of the receiving branch', async () => {
    const [n1, n2, c1] = [await shelfAt(north, 'N-1'), await shelfAt(north, 'N-2'), await shelfAt(central, 'C-1')];
    const closed = await shelfAt(north, 'N-9');
    await call(locations.archive, lib, { orgId: org, branchId: north, locationId: closed });
    const { copyIds: [a, b, c], codes: [codeA, codeB, codeC] } = await acquire(3);
    const { transferId } = await send([a, b, c]);

    // A shelf of the sending branch, a closed shelf and a shelf that doesn't exist are all "not found".
    expect(await failure(receive(transferId, [{ barcode: codeA }], { locationId: c1 }))).toBe('NOT_FOUND');
    expect(await failure(receive(transferId, [{ barcode: codeA }], { locationId: closed }))).toBe('NOT_FOUND');
    expect(await failure(receive(transferId, [{ barcode: codeA }], { locationId: 'no-such-shelf' }))).toBe('NOT_FOUND');
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'IN_TRANSIT' });

    expect(await receive(transferId, [{ barcode: codeA }], { locationId: n1 })).toMatchObject({ complete: false, shelved: 1 });
    expect(await receive(transferId, [{ barcode: codeB }], { locationId: n2 })).toMatchObject({ complete: false, shelved: 1 });
    expect(await receive(transferId, [{ barcode: codeC }])).toMatchObject({ complete: true, shelved: 0 });
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'AVAILABLE', locationId: n1, currentBranchId: north });
    expect(await get(`copies/${b}`)).toMatchObject({ status: 'AVAILABLE', locationId: n2 });
    expect(await get(`copies/${c}`)).toMatchObject({ status: 'AVAILABLE', locationId: null });
    // The shelf rides in the receipt: no separate shelving event.
    expect(await events(a, 'SHELVED')).toHaveLength(0);
    expect((await audit('transfer.receive')).map((e) => e.after.locationId).sort()).toEqual([n1, n2, null].sort());
  });

  it('needs copies.manage to shelve but not to receive, and names members only to staff who may see them', async () => {
    const mover = await createUser('mover@stories.test');
    const { roleId } = await call<{ roleId: string }>(roles.save, sa, { orgId: org, name: 'Transfers only', permissions: ['books.view', 'books.transfer'], branchIds: [north] });
    await call(staff.setRoles, sa, { orgId: org, email: mover.email, roles: [], customRoles: [roleId], branchIds: [north] });
    const shelf = await shelfAt(north, 'N-1');
    const ava = await reader('Ava Rao');
    const waiting = await waitAtNorth(ava);
    const { copyIds: [a, b], codes: [codeA, codeB] } = await acquire(2);
    const { transferId } = await send([a, b]);

    expect(await failure(receive(transferId, [{ barcode: codeA }], { locationId: shelf }, mover))).toBe('FORBIDDEN');
    // Refused before the shelf is looked at: a shelf that isn't there answers the same.
    expect(await failure(receive(transferId, [{ barcode: codeA }], { locationId: 'no-such-shelf' }, mover))).toBe('FORBIDDEN');
    expect(await get(`copies/${a}`)).toMatchObject({ status: 'IN_TRANSIT' });
    const done = await receive(transferId, [{ barcode: codeA }, { barcode: codeB }], {}, mover);
    expect(done).toMatchObject({ complete: true, shelved: 0 });
    // The copy is set aside all the same; the member's name is for staff with members.view.
    expect(done.allocated).toEqual([{ code: codeA, bookTitle: 'Treasure Island', memberName: null, memberCode: null }]);
    expect(await get(`reservations/${waiting.reservationId}`)).toMatchObject({ status: 'ALLOCATED', allocatedCopyId: a });
    expect(await get(`copies/${b}`)).toMatchObject({ status: 'AVAILABLE', locationId: null });
    // Someone with no part in the receiving branch is refused before the transfer's state is told.
    expect(await failure(receive(transferId, [{ barcode: codeA }], {}, central1))).toBe('FORBIDDEN');
  });
});
