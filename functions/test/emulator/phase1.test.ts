import { randomUUID } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as branches from '../../src/branches/branches.js';
import * as numbering from '../../src/branches/numbering.js';
import * as catalog from '../../src/catalog/catalog.js';
import * as covers from '../../src/catalog/covers.js';
import * as bookLookup from '../../src/catalog/lookup.js';
import * as circ from '../../src/circulation/circulation.js';
import * as res from '../../src/circulation/reservations.js';
import * as xfer from '../../src/circulation/transfers.js';
import { db } from '../../src/core/firebase.js';
import * as copies from '../../src/inventory/copies.js';
import * as locations from '../../src/inventory/locations.js';
import * as members from '../../src/members/members.js';
import * as orgs from '../../src/orgs/orgs.js';
import * as staff from '../../src/staff/roles.js';
import * as deposits from '../../src/subscriptions/deposits.js';
import * as plans from '../../src/subscriptions/plans.js';
import * as subs from '../../src/subscriptions/subscriptions.js';
import { expireDueSubscriptions } from '../../src/subscriptions/sweep.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, lib: TestUser, lib2: TestUser, fin: TestUser, fin2: TestUser, bm: TestUser;
let org: string, central: string, north: string, authorId: string, bookId: string, planId: string;

const path = (p: string) => db.doc(`orgs/${org}/${p}`);
const get = async (p: string) => (await path(p).get()).data()!;

async function grant(u: TestUser, roles: string[], branchIds: string[]) {
  await call(staff.setRoles, sa, { orgId: org, email: u.email, roles, branchIds });
}
async function newBook(title: string, isbn = '') {
  return (await call<{ bookId: string }>(catalog.create, sa, {
    title, isbn, authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
  })).bookId;
}
async function acquire(book: string, quantity: number, branchId = central) {
  return (await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId, bookId: book, quantity, acquisitionCostMinor: 39900 })).codes;
}
async function register(fullName: string, extra: Record<string, unknown> = {}) {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  return (await call<{ memberId: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName, dob: '1990-05-01', phone, ...extra })).memberId;
}
async function subscribe(memberId: string, plan = planId) {
  const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId, planId: plan });
  await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId, method: 'OFFLINE_CASH', amountMinor: amountDue.totalMinor });
  return subscriptionId;
}
const issue = (memberId: string, barcodes: string[], by = lib) => call(circ.issue, by, { orgId: org, branchId: central, memberId, barcodes });
const giveBack = (barcodes: string[]) => call(circ.returnCopies, lib, { orgId: org, branchId: central, barcodes });

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [lib, lib2, fin, fin2, bm] = await Promise.all(['lib', 'lib2', 'fin', 'fin2', 'bm'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  north = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'NTH', name: 'North', address, contact })).branchId;
  await grant(lib, ['LIBRARIAN'], [central, north]);
  await grant(lib2, ['LIBRARIAN'], [central]);
  await grant(bm, ['BRANCH_MANAGER'], [central]);
  await grant(fin, ['FINANCE_ADMIN'], ['*']);
  await grant(fin2, ['FINANCE_ADMIN'], ['*']);
  authorId = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Robert Louis Stevenson' })).id;
  bookId = await newBook('Treasure Island', '978-0-306-40615-7');
  planId = (await call<{ planId: string }>(plans.create, sa, {
    orgId: org, name: 'Monthly Two', duration: 'MONTHLY', priceMinor: 30000, depositMinor: 100000, maxSimultaneousBooks: 2, audiences: ['CHILDREN', 'TEENS', 'ADULTS'],
  })).planId;
});

describe('M1.1 catalogue', () => {
  it('allocates sequential codes and rejects duplicate ISBNs (ISBN-10 or 13)', async () => {
    const second = await newBook('Kidnapped');
    expect((await db.doc(`books/${bookId}`).get()).get('code')).toBe('BOOK-000001');
    expect((await db.doc(`books/${second}`).get()).get('code')).toBe('BOOK-000002');
    expect(await failure(newBook('Duplicate', '0306406152'))).toBe('DUPLICATE_ISBN');
    expect(await failure(newBook('Bad', '9780306406158'))).toBe('INVALID_INPUT');
  });

  it('only head office can edit the shared catalogue', async () => {
    const ho = await createUser('ho@stories.test');
    await grant(ho, ['HEAD_OFFICE_ADMIN'], ['*']);
    await call(catalog.authors.create, ho, { name: 'Jules Verne' });
    expect(await failure(call(catalog.authors.create, lib, { name: 'Someone' }))).toBe('FORBIDDEN');
    const fran = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Franchise', type: 'FRANCHISE' })).orgId;
    const fo = await createUser('fo@stories.test');
    await call(staff.setRoles, sa, { orgId: fran, email: fo.email, roles: ['FRANCHISE_OWNER'], branchIds: ['*'] });
    expect(await failure(call(catalog.authors.create, fo, { name: 'Someone' }))).toBe('FORBIDDEN');
  });

  it('keeps denormalized author names and search tokens fresh after a rename', async () => {
    await call(catalog.authors.rename, sa, { id: authorId, name: 'R. L. Stevenson' });
    const book = (await db.doc(`books/${bookId}`).get()).data()!;
    expect(book.authorNames).toEqual(['R. L. Stevenson']);
    expect(book.searchTokens).toEqual(expect.arrayContaining(['treasure', 'stevenson', '9780306406157']));
  });
});

describe('book covers', () => {
  // 1×1 PNG
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const exists = (path: string) => covers.bucket().file(path).exists().then(([e]) => e);

  it('stores the image, replaces the old file and can remove the cover', async () => {
    const first = await call<{ coverUrl: string }>(covers.setCover, sa, { bookId, image: png });
    const book = (await db.doc(`books/${bookId}`).get()).data()!;
    expect(first.coverUrl).toContain(encodeURIComponent(book.coverPath));
    expect(book.coverPath).toMatch(new RegExp(`^covers/${bookId}/.+\\.png$`));
    expect(await exists(book.coverPath)).toBe(true);
    const res = await fetch(first.coverUrl);
    expect(res.status).toBe(200);

    await call(covers.setCover, sa, { bookId, image: png });
    const second = (await db.doc(`books/${bookId}`).get()).get('coverPath');
    expect(second).not.toBe(book.coverPath);
    expect(await exists(book.coverPath)).toBe(false);

    await call(covers.setCover, sa, { bookId, image: null });
    expect((await db.doc(`books/${bookId}`).get()).get('coverUrl')).toBeNull();
    expect(await exists(second)).toBe(false);
  });

  it('only catalogue editors may change covers, and only images are accepted', async () => {
    expect(await failure(call(covers.setCover, lib, { bookId, image: png }))).toBe('FORBIDDEN');
    expect(await failure(call(covers.setCover, sa, { bookId, image: Buffer.from('<svg onload=alert(1)>').toString('base64') }))).toBe('INVALID_INPUT');
  });
});

describe('book details lookup', () => {
  const realFetch = globalThis.fetch;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
  /** Fakes the two public catalogues (and a cover host); everything else, e.g. the Storage emulator, is real. */
  function fakeInternet(opts: { google?: unknown; openLibrary?: unknown; down?: boolean } = {}) {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const host = new URL(url).hostname;
      if (!['www.googleapis.com', 'openlibrary.org', 'covers.openlibrary.org'].includes(host)) return realFetch(input, init);
      seen.push(url);
      if (opts.down) throw new TypeError('fetch failed');
      if (host === 'covers.openlibrary.org') return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
      return Response.json(host === 'openlibrary.org' ? (opts.openLibrary ?? { docs: [] }) : (opts.google ?? { totalItems: 0 }));
    });
    return seen;
  }
  afterEach(() => vi.restoreAllMocks());

  it('searches both catalogues, merges results and flags titles already in the catalogue', async () => {
    const seen = fakeInternet({
      google: { items: [{ volumeInfo: { title: 'Treasure Island', authors: ['Robert Louis Stevenson'], industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780306406157' }] } }] },
      openLibrary: { docs: [{ title: 'Kidnapped', author_name: ['Robert Louis Stevenson'], first_publish_year: 1886, cover_i: 1 }] },
    });
    const res = await call<{ candidates: { title: string; existingBookId: string | null }[] }>(bookLookup.lookup, sa, { q: 'stevenson' }, null);
    expect(res.candidates.map((c) => [c.title, c.existingBookId])).toEqual([['Treasure Island', bookId], ['Kidnapped', null]]);
    expect(seen.some((u) => u.includes('q=stevenson'))).toBe(true);

    const byIsbn = fakeInternet();
    await call(bookLookup.lookup, sa, { q: '0-306-40615-2' }, null);
    expect(byIsbn.find((u) => u.includes('googleapis'))).toContain('isbn%3A9780306406157');
    expect(byIsbn.find((u) => u.includes('openlibrary'))).toContain('isbn=9780306406157');
  });

  it('is for catalogue editors only, and says so plainly when the catalogues are unreachable', async () => {
    fakeInternet({ down: true });
    expect(await failure(call(bookLookup.lookup, lib, { q: 'stevenson' }, null))).toBe('FORBIDDEN');
    expect(await failure(call(bookLookup.lookup, sa, { q: 'stevenson' }, null))).toBe('LOOKUP_UNAVAILABLE');
  });

  it('imports a cover by URL from the public catalogues only', async () => {
    fakeInternet();
    await call(covers.setCover, sa, { bookId, imageUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' });
    const path = (await db.doc(`books/${bookId}`).get()).get('coverPath');
    expect(path).toMatch(/\.jpg$/);
    expect(await failure(call(covers.setCover, sa, { bookId, imageUrl: 'https://example.com/cover.jpg' }))).toBe('INVALID_INPUT');
    expect(await failure(call(covers.setCover, sa, { bookId, imageUrl: 'http://covers.openlibrary.org/b/id/1-L.jpg' }))).toBe('INVALID_INPUT');
  });
});

describe('M1.2 inventory', () => {
  it('creates coded copies with unique barcodes and counts availability', async () => {
    const codes = await acquire(bookId, 3);
    expect(codes).toEqual(['COPY-000001-01', 'COPY-000001-02', 'COPY-000001-03']);
    expect(await failure(call(copies.acquire, lib, { orgId: org, branchId: central, bookId, quantity: 1, acquisitionCostMinor: 0, barcodes: ['COPY-000001-02'] }))).toBe('DUPLICATE_BARCODE');
    const a = await call<{ branches: { branchId: string; available: number; total: number }[] }>(copies.availability, lib, { orgId: org, bookId }, null);
    expect(a.branches).toEqual([{ branchId: central, branchName: 'Central', available: 3, total: 3 }]);
  });

  it('shows every branch holding each search result and locates copies held elsewhere', async () => {
    const other = await newBook('Kidnapped');
    await acquire(bookId, 2);
    const [northCode] = await acquire(bookId, 1, north);
    await acquire(other, 1, north);
    const many = await call<{ books: Record<string, { branchName: string; available: number; total: number }[]> }>(copies.availabilityMany, lib2, { orgId: org, bookIds: [bookId, other] }, null);
    expect(many.books[bookId].map((a) => [a.branchName, a.available, a.total])).toEqual([['Central', 2, 2], ['North', 1, 1]]);
    expect(many.books[other].map((a) => a.branchName)).toEqual(['North']);

    // lib2 works at Central only: they can't open North's copy, but can find out where it is.
    const found = await call<{ bookTitle: string; currentBranchName: string; status: string; canOpen: boolean }>(copies.locate, lib2, { orgId: org, code: northCode.toLowerCase() }, null);
    expect(found).toMatchObject({ bookTitle: 'Treasure Island', currentBranchName: 'North', status: 'AVAILABLE', canOpen: false });
    expect((await call<{ canOpen: boolean }>(copies.locate, lib, { orgId: org, code: northCode }, null)).canOpen).toBe(true);
    expect(await failure(call(copies.locate, lib2, { orgId: org, code: 'NOPE-1' }, null))).toBe('NOT_FOUND');
    const outsider = await createUser('outsider@stories.test');
    expect(await failure(call(copies.locate, outsider, { orgId: org, code: northCode }, null))).toBe('FORBIDDEN');
  });

  it('retiring keeps the copy and its history; retired copies never return', async () => {
    const [code] = await acquire(bookId, 1);
    const copyId = (await db.doc(`orgs/${org}/barcodes/${code}`).get()).get('copyId');
    expect(await failure(call(copies.retire, lib, { orgId: org, copyId, reason: 'Worn out' }))).toBe('FORBIDDEN');
    await call(copies.retire, bm, { orgId: org, copyId, reason: 'Worn out' });
    const copy = await get(`copies/${copyId}`);
    expect(copy.status).toBe('RETIRED');
    expect((await path(`copies/${copyId}`).collection('events').get()).size).toBe(2);
    expect(await failure(call(copies.repair, lib, { orgId: org, copyId, condition: 'GOOD' }))).toBe('COPY_STATE');
  });
});

describe('M1.3 members', () => {
  it('requires a guardian for minors and a unique phone', async () => {
    expect(await failure(register('Kid', { dob: '2016-01-01', phone: '' }))).toBe('GUARDIAN_REQUIRED');
    const parent = await register('Parent');
    const child = await register('Kid', { dob: '2016-01-01', phone: '', guardianMemberId: parent, guardianRelationship: 'Mother' });
    expect((await get(`members/${child}`)).guardian).toMatchObject({ memberId: parent, relationship: 'Mother' });
    const phone = (await get(`members/${parent}`)).phone.replace('+91', '');
    expect(await failure(register('Twin', { phone }))).toBe('DUPLICATE_PHONE');
  });
});

describe('M1.4 subscriptions, payments, deposits', () => {
  it('activates on payment, collects the deposit into the ledger, and a retried payment does nothing twice', async () => {
    const m = await register('Asha');
    const { subscriptionId, amountDue } = await call<{ subscriptionId: string; amountDue: { totalMinor: number } }>(subs.create, lib, { orgId: org, memberId: m, planId });
    expect(amountDue.totalMinor).toBe(130000);
    const requestId = randomUUID();
    const pay = { orgId: org, subscriptionId, method: 'OFFLINE_UPI', amountMinor: 130000, reference: 'UPI123456' };
    const a = await call<{ paymentId: string }>(subs.recordOfflinePayment, lib, pay, requestId);
    const b = await call<{ paymentId: string }>(subs.recordOfflinePayment, lib, pay, requestId);
    expect(b.paymentId).toBe(a.paymentId);
    expect(await failure(call(subs.recordOfflinePayment, lib, pay))).toBe('NOT_PENDING');
    expect((await db.collection(`orgs/${org}/payments`).get()).size).toBe(1);
    expect((await get(`subscriptions/${subscriptionId}`)).status).toBe('ACTIVE');
    expect((await get(`members/${m}`)).activeSubscriptionId).toBe(subscriptionId);
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(100000);
  });

  it('plan edits never change terms already sold', async () => {
    const m = await register('Asha');
    const sub = await subscribe(m);
    await call(plans.update, sa, { orgId: org, planId, name: 'Monthly Two', duration: 'MONTHLY', priceMinor: 45000, depositMinor: 150000, maxSimultaneousBooks: 1, audiences: ['ADULTS'] });
    const s = await get(`subscriptions/${sub}`);
    expect(s.planSnapshot).toMatchObject({ priceMinor: 30000, maxSimultaneousBooks: 2 });
    expect(s.planVersion).toBe(1);
    const [c1, c2] = await acquire(bookId, 2);
    await issue(m, [c1, c2]); // still 2 at a time under the old terms
  });

  it('returns a custom-barcoded copy by its copy code (desk checkbox return)', async () => {
    const m = await register('Asha');
    await subscribe(m);
    const { codes } = await call<{ codes: string[] }>(copies.acquire, lib, { orgId: org, branchId: central, bookId, quantity: 1, acquisitionCostMinor: 0, barcodes: ['LBL-9001'] });
    await issue(m, ['LBL-9001']);
    await giveBack(codes);
    const copyId = (await db.doc(`orgs/${org}/barcodes/LBL-9001`).get()).get('copyId');
    expect((await get(`copies/${copyId}`)).status).toBe('UNDER_INSPECTION');
    expect(await failure(giveBack(['COPY-999999-01']))).toBe('UNKNOWN_BARCODE');
  });

  it('keeps the deposit balance equal to the ledger, with maker-checker approvals', async () => {
    const m = await register('Asha');
    await subscribe(m);
    const { adjustmentId } = await call<{ adjustmentId: string }>(deposits.proposeAdjustment, fin, { orgId: org, memberId: m, kind: 'DEDUCTION', amountMinor: 25000, reason: 'Water damage' });
    expect(await failure(call(deposits.decideAdjustment, fin, { orgId: org, adjustmentId, decision: 'APPROVE' }))).toBe('FORBIDDEN');
    await call(deposits.decideAdjustment, fin2, { orgId: org, adjustmentId, decision: 'APPROVE' });
    const account = await get(`depositAccounts/${m}`);
    const ledger = await path(`depositAccounts/${m}`).collection('transactions').get();
    const sum = ledger.docs.reduce((s, d) => s + d.get('deltaMinor'), 0);
    expect(account.balanceMinor).toBe(75000);
    expect(sum).toBe(account.balanceMinor);
  });

  it('blocks settlement and refund while a book is out, then refunds to zero', async () => {
    const m = await register('Asha');
    const sub = await subscribe(m);
    const [code] = await acquire(bookId, 1);
    await issue(m, [code]);
    await path(`subscriptions/${sub}`).update({ endAt: Timestamp.fromMillis(Date.now() - 1000) });
    expect(await failure(call(deposits.startSettlement, fin, { orgId: org, memberId: m }))).toBe('LOANS_OUTSTANDING');
    await giveBack([code]);
    await call(deposits.startSettlement, fin, { orgId: org, memberId: m });
    const r = await call<{ refundedMinor: number }>(deposits.refund, fin, { orgId: org, memberId: m, method: 'OFFLINE_CASH' });
    expect(r.refundedMinor).toBe(100000);
    expect(await get(`depositAccounts/${m}`)).toMatchObject({ balanceMinor: 0, status: 'CLOSED' });
  });

  it('expiry sweep is idempotent and members keep their books after expiry', async () => {
    const m = await register('Asha');
    const sub = await subscribe(m);
    const [c1, c2] = await acquire(bookId, 2);
    await issue(m, [c1]);
    await path(`subscriptions/${sub}`).update({ endAt: Timestamp.fromMillis(Date.now() - 1000) });
    expect(await expireDueSubscriptions()).toBe(1);
    expect(await expireDueSubscriptions()).toBe(0);
    expect(await get(`subscriptions/${sub}`)).toMatchObject({ status: 'EXPIRED' });
    expect((await get(`members/${m}`)).activeLoanCount).toBe(1);
    expect(await failure(issue(m, [c2]))).toBe('NO_ACTIVE_SUBSCRIPTION');
    expect(await failure(call(circ.exchange, lib, { orgId: org, branchId: central, memberId: m, returnBarcodes: [c1], issueBarcodes: [c2] }))).toBe('NO_ACTIVE_SUBSCRIPTION');
    await giveBack([c1]); // returns always allowed
  });
});

describe('M1.5 circulation', () => {
  it('two librarians issuing the same copy at once: exactly one succeeds', async () => {
    const [a, b] = [await register('Ava Rao'), await register('Ben Das')];
    await subscribe(a);
    await subscribe(b);
    const [code] = await acquire(bookId, 1);
    const results = await Promise.allSettled([issue(a, [code], lib), issue(b, [code], lib2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.collection(`orgs/${org}/loans`).get()).size).toBe(1);
  });

  it('enforces the simultaneous limit; a return frees exactly one slot', async () => {
    const m = await register('Asha');
    await subscribe(m);
    const codes = await acquire(bookId, 4);
    await issue(m, [codes[0], codes[1]]);
    expect(await failure(issue(m, [codes[2]]))).toBe('LIMIT_REACHED');
    await giveBack([codes[0]]);
    await issue(m, [codes[2]]);
    expect(await failure(issue(m, [codes[3]]))).toBe('LIMIT_REACHED');
    expect((await get(`members/${m}`)).activeLoanCount).toBe(2);
  });

  it('allows unlimited exchanges (100 in a row) and never computes a due date', async () => {
    const m = await register('Asha');
    const sub = await subscribe(m);
    const [x, y] = await acquire(bookId, 2);
    await issue(m, [x]);
    let [held, shelf] = [x, y];
    for (let i = 0; i < 100; i++) {
      // Returned copies need inspection before circulating again.
      await call(circ.exchange, lib, { orgId: org, branchId: central, memberId: m, returnBarcodes: [held], issueBarcodes: [shelf] });
      const copyId = (await db.doc(`orgs/${org}/barcodes/${held}`).get()).get('copyId');
      await call(copies.inspect, lib, { orgId: org, copyId, outcome: 'PASS', condition: 'GOOD' });
      [held, shelf] = [shelf, held];
    }
    expect((await get(`members/${m}`)).lifetimeExchanges).toBe(100);
    expect((await get(`subscriptions/${sub}`)).exchangesThisTerm).toBe(100);
    const loans = await db.collection(`orgs/${org}/loans`).get();
    expect(loans.size).toBe(101);
    for (const l of loans.docs) {
      expect(Object.keys(l.data()).filter((k) => /due|fine|overdue/i.test(k))).toEqual([]);
    }
  }, 120_000);

  it('declaring a loan lost frees the slot and proposes (not posts) a deposit deduction', async () => {
    const m = await register('Asha');
    await subscribe(m);
    const [code] = await acquire(bookId, 1);
    const { loanIds } = await issue(m, [code]) as { loanIds: string[] };
    const r = await call<{ adjustmentId: string; proposedMinor: number }>(circ.declareLost, bm, { orgId: org, loanId: loanIds[0], reason: 'Member reported it lost' });
    expect(r.proposedMinor).toBe(39900);
    expect((await get(`members/${m}`)).activeLoanCount).toBe(0);
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(100000);
    await call(deposits.decideAdjustment, fin, { orgId: org, adjustmentId: r.adjustmentId, decision: 'APPROVE' });
    expect((await get(`depositAccounts/${m}`)).balanceMinor).toBe(60100);
    const audit = await db.collection(`orgs/${org}/auditLogs`).where('action', 'in', ['loan.declareLost', 'deposit.approve']).get();
    expect(audit.size).toBe(2);
  });
});

describe('M1.6 reservations and transfers', () => {
  it('two members racing for the last copy: one is allocated, the other waits', async () => {
    const [a, b] = [await register('Ava Rao'), await register('Ben Das')];
    await subscribe(a);
    await subscribe(b);
    await acquire(bookId, 1);
    const place = (m: string, by: TestUser) => call<{ status: string }>(res.place, by, { orgId: org, memberId: m, bookId, branchId: central });
    const [ra, rb] = await Promise.all([place(a, lib), place(b, lib2)]);
    expect([ra.status, rb.status].sort()).toEqual(['ALLOCATED', 'WAITING']);
  });

  it('a held copy only goes to its member; an expired hold passes to the next in line', async () => {
    const [a, b] = [await register('Ava Rao'), await register('Ben Das')];
    await subscribe(a);
    await subscribe(b);
    const [code] = await acquire(bookId, 1);
    await call(res.place, lib, { orgId: org, memberId: a, bookId, branchId: central });
    await call(res.place, lib, { orgId: org, memberId: b, bookId, branchId: central });
    expect(await failure(issue(b, [code]))).toBe('RESERVED_FOR_OTHER');
    expect(await res.expireHolds(new Date(Date.now() + 49 * 3_600_000))).toBe(1);
    expect((await get(`members/${a}`)).allocatedCount).toBe(0);
    expect((await get(`members/${b}`))).toMatchObject({ allocatedCount: 1, waitingCount: 0 });
    await issue(b, [code]);
    const resB = await db.collection(`orgs/${org}/reservations`).where('memberId', '==', b).get();
    expect(resB.docs[0].get('status')).toBe('FULFILLED');
  });

  it('transfers move location but never ownership; foreign copies are rejected on receipt', async () => {
    const [c1, c2] = await acquire(bookId, 2);
    const other = (await acquire(bookId, 1))[0];
    const { transferId } = await call<{ transferId: string }>(xfer.create, lib, { orgId: org, fromBranchId: central, toBranchId: north, barcodes: [c1, c2] });
    await call(xfer.dispatch, lib, { orgId: org, transferId });
    expect(await failure(call(xfer.receive, lib, { orgId: org, transferId, items: [{ barcode: other, condition: 'GOOD' }] }))).toBe('NOT_IN_TRANSFER');
    await call(xfer.receive, lib, { orgId: org, transferId, items: [{ barcode: c1, condition: 'GOOD' }, { barcode: c2, condition: 'FAIR', damaged: true }] });
    const id1 = (await db.doc(`orgs/${org}/barcodes/${c1}`).get()).get('copyId');
    const id2 = (await db.doc(`orgs/${org}/barcodes/${c2}`).get()).get('copyId');
    expect(await get(`copies/${id1}`)).toMatchObject({ status: 'AVAILABLE', currentBranchId: north, owningBranchId: central });
    expect(await get(`copies/${id2}`)).toMatchObject({ status: 'DAMAGED', currentBranchId: north, owningBranchId: central });
    expect((await get(`transfers/${transferId}`)).status).toBe('RECEIVED');
  });
});

describe('member audit trail', () => {
  it("tags every change to a member with the member, one return entry per member", async () => {
    const a = await register('Asha');
    const r = await register('Ravi');
    await subscribe(a);
    await subscribe(r);
    const [c1, c2] = await acquire(bookId, 2);
    await issue(a, [c1]);
    await issue(r, [c2]);
    await giveBack([c1, c2]);
    const trail = async (m: string) =>
      (await db.collection(`orgs/${org}/auditLogs`).where('memberId', '==', m).orderBy('at', 'asc').get()).docs.map((d) => d.get('action'));
    expect(await trail(a)).toEqual(['member.register', 'subscription.create', 'payment.recordOffline', 'circulation.issue', 'circulation.return']);
    expect(await trail(r)).toEqual(['member.register', 'subscription.create', 'payment.recordOffline', 'circulation.issue', 'circulation.return']);
    const ret = await db.collection(`orgs/${org}/auditLogs`).where('memberId', '==', a).where('action', '==', 'circulation.return').get();
    expect(ret.docs[0].get('after').copies).toEqual([c1]);
  });
});

describe('numbering settings', () => {
  const setNumbering = (branchId: string, patterns: Record<string, string>, by = sa) =>
    call(numbering.setBranchNumbering, by, { orgId: org, branchId, copy: '', member: '', location: '', employee: '', ...patterns });
  const membership = async (u: TestUser) => (await db.doc(`users/${u.uid}/memberships/${org}`).get()).data()!;
  const shelf = async (branchId: string, code = '') =>
    (await call<{ code: string }>(locations.create, lib, { orgId: org, branchId, code, label: 'Fiction', kind: 'SHELF' })).code;

  it("numbers copies and members with the branch's own patterns; other branches keep the defaults", async () => {
    await setNumbering(north, { copy: '{BRANCH}-{BOOK}-{SEQ:3}', member: '{BRANCH}{YY}-{SEQ:4}' });
    expect(await acquire(bookId, 2, north)).toEqual(['NTH-000001-001', 'NTH-000001-002']);
    expect(await acquire(bookId, 1)).toEqual(['COPY-000001-01']);
    const m = (await call<{ code: string }>(members.register, lib, { orgId: org, homeBranchId: north, fullName: 'Ravi', dob: '1990-05-01', phone: '9811111111' })).code;
    expect(m).toMatch(/^NTH\d{2}-0001$/);
    const c = await call<{ code: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName: 'Asha', dob: '1990-05-01', phone: '9822222222' });
    expect(c.code).toBe('MEM-000001');
  });

  it('only branch managers of the org may change numbering, and bad patterns are refused', async () => {
    expect(await failure(setNumbering(central, { copy: 'C-{SEQ}' }, lib))).toBe('FORBIDDEN');
    expect(await failure(setNumbering(central, { member: 'MEM-' }))).toBe('INVALID_INPUT');
    expect(await failure(setNumbering(central, { member: 'M-{BOOK}-{SEQ}' }))).toBe('INVALID_INPUT');
  });

  it('refuses a pattern that would repeat an existing code', async () => {
    await register('Asha'); // MEM-000001
    await setNumbering(central, { member: 'MEM-00000{SEQ}' });
    expect(await failure(register('Ravi'))).toBe('CODE_TAKEN');
  });

  it('numbers shelves per branch when the code is left blank', async () => {
    expect(await shelf(central)).toBe('SH-001');
    expect(await shelf(central)).toBe('SH-002');
    expect(await shelf(north)).toBe('SH-001');
    await setNumbering(north, { location: '{BRANCH}-{KIND}{SEQ:2}' });
    expect(await shelf(north)).toBe('NTH-SH01');
    expect(await failure(shelf(central, 'SH-001'))).toBe('DUPLICATE_LOCATION');
  });

  it('gives staff a unique employee ID that survives role changes', async () => {
    expect((await membership(lib)).employeeId).toBe('EMP-0001'); // granted first in setup
    await grant(lib, ['LIBRARIAN', 'DELIVERY_PERSON'], [central]);
    expect((await membership(lib)).employeeId).toBe('EMP-0001');
    await setNumbering(north, { employee: '{BRANCH}-E{SEQ:3}' });
    const del = await createUser('del@stories.test');
    await grant(del, ['DELIVERY_PERSON'], [north]);
    expect((await membership(del)).employeeId).toBe('NTH-E001');
    await call(staff.setRoles, sa, { orgId: org, email: del.email, roles: ['DELIVERY_PERSON'], branchIds: [north], employeeId: 'kol-7' });
    expect((await membership(del)).employeeId).toBe('KOL-7');
    expect(await failure(call(staff.setRoles, sa, { orgId: org, email: lib2.email, roles: ['LIBRARIAN'], branchIds: [central], employeeId: 'KOL-7' }))).toBe('EMPLOYEE_ID_TAKEN');
    // The old ID is free again once replaced.
    await call(staff.setRoles, sa, { orgId: org, email: lib2.email, roles: ['LIBRARIAN'], branchIds: [central], employeeId: 'NTH-E001' });
  });

  it('numbers new catalogue titles with the catalogue pattern; book numbers never repeat', async () => {
    expect(await failure(call(numbering.setBookNumbering, lib, { book: 'B-{SEQ:5}' }))).toBe('FORBIDDEN');
    await call(numbering.setBookNumbering, sa, { book: 'B{YY}-{SEQ:5}' });
    const next = await newBook('Kidnapped');
    const book = (await db.doc(`books/${next}`).get()).data()!;
    expect(book.code).toMatch(/^B\d{2}-00002$/);
    expect(await acquire(next, 1)).toEqual(['COPY-000002-01']);
    await call(numbering.setBookNumbering, sa, { book: '' });
    expect((await db.doc(`books/${await newBook('Catriona')}`).get()).get('code')).toBe('BOOK-000003');
  });
});
