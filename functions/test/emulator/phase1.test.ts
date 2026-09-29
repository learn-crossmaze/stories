import { randomUUID } from 'node:crypto';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as branches from '../../src/organization/branches.js';
import * as numbering from '../../src/organization/numbering.js';
import * as catalog from '../../src/catalogue/books.js';
import * as covers from '../../src/catalogue/covers.js';
import * as bookLookup from '../../src/catalogue/lookup.js';
import * as circ from '../../src/circulation/circulation.js';
import * as res from '../../src/circulation/reservations.js';
import * as xfer from '../../src/circulation/transfers.js';
import { db } from '../../src/core/firebase.js';
import * as copies from '../../src/inventory/copies.js';
import * as locations from '../../src/inventory/locations.js';
import * as me from '../../src/members/me.js';
import * as members from '../../src/members/members.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import * as deposits from '../../src/billing/deposits.js';
import * as plans from '../../src/billing/plans.js';
import * as subs from '../../src/billing/subscriptions.js';
import { expireDueSubscriptions } from '../../src/billing/sweep.js';
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
    orgId: org, name: 'Monthly Two', options: [{ duration: 'MONTHLY', priceMinor: 30000 }], depositMinor: 100000, maxSimultaneousBooks: 2, audiences: ['CHILDREN', 'TEENS', 'ADULTS'],
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

  it('catalogue managers edit, restore and delete archived titles; titles with history stay', async () => {
    const cm = await createUser('cm@stories.test');
    await grant(cm, ['CATALOGUE_MANAGER'], ['*']);
    const spare = await newBook('Kidnapped', '9780141441900');
    await call(catalog.archive, cm, { bookId: spare, reason: 'Duplicate entry' });

    // Archived titles can still be corrected, then restored or deleted.
    await call(catalog.update, cm, {
      bookId: spare, title: 'Kidnapped (1886)', isbn: '9780141441900', authorIds: [authorId], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
    });
    expect((await db.doc(`books/${spare}`).get()).get('title')).toBe('Kidnapped (1886)');
    expect(await failure(call(catalog.remove, lib, { bookId: spare, reason: 'Not needed' }))).toBe('FORBIDDEN');
    await call(catalog.restore, cm, { bookId: spare });
    expect((await db.doc(`books/${spare}`).get()).get('status')).toBe('ACTIVE');
    expect(await failure(call(catalog.remove, cm, { bookId: spare, reason: 'Not needed' }))).toBe('BOOK_NOT_ARCHIVED');
    await call(catalog.archive, cm, { bookId: spare, reason: 'Duplicate entry' });
    await call(catalog.remove, cm, { bookId: spare, reason: 'Duplicate entry' });
    expect((await db.doc(`books/${spare}`).get()).exists).toBe(false);
    expect((await db.doc('isbnIndex/9780141441900').get()).exists).toBe(false);
    await newBook('Kidnapped again', '9780141441900'); // the ISBN is free again

    // A title a library stocked keeps its history: it can be archived but not deleted.
    await acquire(bookId, 1);
    await call(catalog.archive, cm, { bookId, reason: 'Out of print' });
    expect(await failure(call(catalog.remove, cm, { bookId, reason: 'Out of print' }))).toBe('BOOK_IN_USE');
    // The book page explains why, counting copies in every status (retired ones too) across all libraries.
    const copyId = (await db.collection(`orgs/${org}/copies`).where('bookId', '==', bookId).get()).docs[0].id;
    await call(copies.retire, bm, { orgId: org, copyId, reason: 'Worn out' });
    const usage = await call<{ summary: string | null; copies: { total: number } }>(catalog.usage, cm, { bookId }, null);
    expect(usage.summary).toBe('1 copy (1 retired)');
    expect((await call<{ summary: string | null }>(catalog.usage, cm, { bookId: (await newBook('Unused')) }, null)).summary).toBeNull();
    expect(await failure(call(catalog.usage, lib, { bookId }, null))).toBe('FORBIDDEN');

    // Branch managers may add titles but not delete them; the role exists only in corporate organizations.
    expect(await failure(call(catalog.remove, bm, { bookId, reason: 'Out of print' }))).toBe('FORBIDDEN');
    const fran = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Franchise', type: 'FRANCHISE' })).orgId;
    expect(await failure(call(staff.setRoles, sa, { orgId: fran, email: cm.email, roles: ['CATALOGUE_MANAGER'], branchIds: ['*'] }))).not.toBe('OK');
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

describe('branch managers add titles', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('may add books, authors and a missing cover, but not edit the catalogue', async () => {
    const { id: author } = await call<{ id: string }>(catalog.authors.create, bm, { name: 'Ruskin Bond' });
    const { bookId: added } = await call<{ bookId: string }>(catalog.create, bm, {
      title: 'The Blue Umbrella', authorIds: [author], language: 'en', genres: ['FICTION'], ageGroup: 'CHILDREN', readingLevel: 'BEGINNER',
    });
    expect((await db.doc(`books/${added}`).get()).get('title')).toBe('The Blue Umbrella');
    await call(covers.setCover, bm, { bookId: added, image: png });
    expect((await db.doc(`books/${added}`).get()).get('coverUrl')).toBeTruthy();

    // Changing or removing a cover, editing a title and renaming authors stay with head office.
    expect(await failure(call(covers.setCover, bm, { bookId: added, image: png }))).toBe('FORBIDDEN');
    expect(await failure(call(covers.setCover, bm, { bookId: added, image: null }))).toBe('FORBIDDEN');
    expect(await failure(call(catalog.update, bm, { bookId: added, title: 'Changed', authorIds: [author], language: 'en', genres: ['FICTION'], ageGroup: 'CHILDREN', readingLevel: 'BEGINNER' }))).toBe('FORBIDDEN');
    expect(await failure(call(catalog.authors.rename, bm, { id: author, name: 'R. Bond' }))).toBe('FORBIDDEN');
    // Librarians still can't add titles.
    expect(await failure(call(catalog.authors.create, lib, { name: 'Someone Else' }))).toBe('FORBIDDEN');
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
    expect(codes).toEqual(['BK000001-CP01', 'BK000001-CP02', 'BK000001-CP03']);
    expect(await failure(call(copies.acquire, lib, { orgId: org, branchId: central, bookId, quantity: 1, acquisitionCostMinor: 0, barcodes: ['BK000001-CP02'] }))).toBe('DUPLICATE_BARCODE');
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
    await call(plans.update, sa, { orgId: org, planId, name: 'Monthly Two', options: [{ duration: 'MONTHLY', priceMinor: 45000 }], depositMinor: 150000, maxSimultaneousBooks: 1, audiences: ['ADULTS'] });
    const s = await get(`subscriptions/${sub}`);
    expect(s.planSnapshot).toMatchObject({ priceMinor: 30000, maxSimultaneousBooks: 2 });
    expect(s.planVersion).toBe(1);
    const [c1, c2] = await acquire(bookId, 2);
    await issue(m, [c1, c2]); // still 2 at a time under the old terms
  });

  it('one plan offers several billing options, with an amount or percentage discount', async () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 330 * 60_000 + 30 * 86_400_000).toISOString().slice(0, 10);
    const base = { orgId: org, name: 'Learner', depositMinor: 100000, maxSimultaneousBooks: 4, audiences: ['ADULTS'] };
    const options = [
      { duration: 'ANNUAL', priceMinor: 479900 },
      { duration: 'MONTHLY', priceMinor: 49900 },
      { duration: 'QUARTERLY', priceMinor: 139900 },
      { duration: 'HALF_YEARLY', priceMinor: 259900 },
    ];
    expect(await failure(call(plans.create, sa, { ...base, options: [...options, { duration: 'MONTHLY', priceMinor: 1 }] }))).toBe('INVALID_INPUT');
    expect(await failure(call(plans.create, sa, { ...base, options, discount: { type: 'PERCENT', value: 95, from: today, to: later } }))).toBe('INVALID_INPUT');
    expect(await failure(call(plans.create, sa, { ...base, options, discount: { type: 'AMOUNT', value: 60000, from: today, to: later } }))).toBe('INVALID_INPUT'); // more than the monthly price
    const learner = (await call<{ planId: string }>(plans.create, sa, { ...base, options, discount: { type: 'PERCENT', value: 10, from: today, to: later, durations: ['ANNUAL'] } })).planId;
    expect((await get(`plans/${learner}`)).options.map((o: { duration: string }) => o.duration)).toEqual(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL']);

    const m = await register('Asha');
    expect(await failure(call(subs.create, lib, { orgId: org, memberId: m, planId: learner }))).toBe('INVALID_INPUT'); // which option?
    const yearly = await call<{ subscriptionId: string; amountDue: { subscriptionMinor: number } }>(subs.create, lib, { orgId: org, memberId: m, planId: learner, duration: 'ANNUAL' });
    expect(yearly.amountDue.subscriptionMinor).toBe(431900); // 4,799 less 10% (480) = 4,319
    expect((await get(`subscriptions/${yearly.subscriptionId}`)).planSnapshot).toMatchObject({ duration: 'ANNUAL', months: 12, listPriceMinor: 479900, discountMinor: 48000, priceMinor: 431900, discountLabel: '10% off', maxSimultaneousBooks: 4 });
    await call(subs.cancelPending, lib, { orgId: org, subscriptionId: yearly.subscriptionId, reason: 'Changed mind' });
    const quarterly = await call<{ amountDue: { subscriptionMinor: number } }>(subs.create, lib, { orgId: org, memberId: m, planId: learner, duration: 'QUARTERLY' });
    expect(quarterly.amountDue.subscriptionMinor).toBe(139900); // the discount is for the yearly option only

    // An amount off every option.
    await call(plans.update, sa, { ...base, planId: learner, options, discount: { type: 'AMOUNT', value: 10000, from: today, to: later } });
    const n = await register('Ravi');
    const monthly = await call<{ amountDue: { subscriptionMinor: number } }>(subs.create, lib, { orgId: org, memberId: n, planId: learner, duration: 'MONTHLY' });
    expect(monthly.amountDue.subscriptionMinor).toBe(39900);
    expect(await failure(call(subs.create, lib, { orgId: org, memberId: await register('Nita'), planId, duration: 'ANNUAL' }))).toBe('INVALID_INPUT'); // not offered
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

describe('member self-service', () => {
  type Overview = { linked: number; memberships: { memberId: string; self: boolean; member: { fullName: string }; plans: { id: string }[]; subscriptions: { id: string; status: string }[]; reservations: { id: string; status: string }[] }[] };

  it('links by verified email, shows own and wards\' records only, and lets members subscribe and reserve', async () => {
    const parent = await register('Meera Rao', { email: 'Meera@Stories.test' });
    const kid = await register('Kiran Rao', { dob: '2016-01-01', phone: '', guardianMemberId: parent, guardianRelationship: 'Mother' });
    await register('Someone Else', { email: 'other@stories.test' });

    // An unverified sign-in with the same email links nothing.
    const unverified = await createUser('meera@stories.test', { verified: false });
    expect((await call<Overview>(me.overview, unverified, {}, null)).memberships).toEqual([]);

    const meera = { ...unverified, verified: true };
    const o = await call<Overview>(me.overview, meera, {}, null);
    expect(o.linked).toBe(1);
    expect(o.memberships.map((m) => [m.member.fullName, m.self])).toEqual([['Meera Rao', true], ['Kiran Rao', false]]);
    expect((await get(`members/${parent}`)).accountHolderUid).toBe(meera.uid);

    // Buy a plan: an unpaid subscription, which the member can also drop.
    const { subscriptionId } = await call<{ subscriptionId: string }>(me.subscribe, meera, { orgId: org, memberId: parent, planId });
    await call(me.cancelPending, meera, { orgId: org, subscriptionId });
    expect((await get(`subscriptions/${subscriptionId}`)).status).toBe('CANCELLED');
    // Online payment needs the branch's gateway.
    const again = await call<{ subscriptionId: string }>(me.subscribe, meera, { orgId: org, memberId: parent, planId });
    expect(await failure(call(me.pay, meera, { orgId: org, subscriptionId: again.subscriptionId, requestId: randomUUID() }, null))).toBe('GATEWAY_NOT_CONFIGURED');
    await call(subs.recordOfflinePayment, lib, { orgId: org, subscriptionId: again.subscriptionId, method: 'OFFLINE_CASH', amountMinor: 130000 });

    // Reserve for themselves (on the shelf → held) and cancel.
    await acquire(bookId, 1);
    const r = await call<{ reservationId: string; status: string }>(me.reserve, meera, { orgId: org, memberId: parent, bookId, branchId: central });
    expect(r.status).toBe('ALLOCATED');
    await call(me.cancelReservationByMember, meera, { orgId: org, reservationId: r.reservationId });
    expect((await get(`reservations/${r.reservationId}`)).status).toBe('CANCELLED');

    // Nobody else can act on these records.
    const stranger = await createUser('stranger@stories.test');
    expect(await failure(call(me.subscribe, stranger, { orgId: org, memberId: parent, planId }))).toBe('FORBIDDEN');
    expect(await failure(call(me.reserve, stranger, { orgId: org, memberId: kid, bookId, branchId: central }))).toBe('FORBIDDEN');
    expect((await call<Overview>(me.overview, stranger, {}, null)).memberships).toEqual([]);
  });
});

describe('member list', () => {
  it('keeps plan and renewal date on the member, and fills them in once for older members', async () => {
    const paid = await register('Paid');
    const never = await register('Never');
    await subscribe(paid);
    const sub = (await db.collection(`orgs/${org}/subscriptions`).where('memberId', '==', paid).get()).docs[0];
    const m = await get(`members/${paid}`);
    expect(m.planName).toBe('Monthly Two');
    expect(m.renewalDueAt.toMillis()).toBe(sub.get('endAt').toMillis());
    expect((await get(`members/${never}`)).renewalDueAt).toBeNull();

    // Members from before the list existed have neither field; the one-time fill computes them.
    await path(`members/${paid}`).update({ planName: FieldValue.delete(), renewalDueAt: FieldValue.delete() });
    await path(`members/${never}`).update({ planName: FieldValue.delete(), renewalDueAt: FieldValue.delete() });
    expect(await failure(call(members.indexList, fin, { orgId: org, branchId: 'no-such-branch' }, null))).toBe('NOT_FOUND');
    expect((await call<{ updated: number }>(members.indexList, lib2, { orgId: org, branchId: central }, null)).updated).toBe(2);
    expect((await get(`members/${paid}`)).planName).toBe('Monthly Two');
    expect((await get(`members/${paid}`)).renewalDueAt.toMillis()).toBe(sub.get('endAt').toMillis());
    expect((await get(`members/${never}`)).renewalDueAt).toBeNull();
    expect((await call<{ updated: number }>(members.indexList, lib2, { orgId: org, branchId: central }, null)).updated).toBe(0);
    const outsider = await createUser('outsider@stories.test');
    expect(await failure(call(members.indexList, outsider, { orgId: org, branchId: central }, null))).toBe('FORBIDDEN');
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
    expect(await acquire(bookId, 1)).toEqual(['BK000001-CP01']);
    // A branch that keeps the earlier default carries on from the title's copy count.
    await setNumbering(central, { copy: 'COPY-{BOOK}-{SEQ:2}' });
    expect(await acquire(bookId, 1)).toEqual(['COPY-000001-02']);
    const m = (await call<{ code: string }>(members.register, lib, { orgId: org, homeBranchId: north, fullName: 'Ravi', dob: '1990-05-01', phone: '9811111111' })).code;
    expect(m).toMatch(/^NTH\d{2}-0001$/);
    const c = await call<{ code: string }>(members.register, lib, { orgId: org, homeBranchId: central, fullName: 'Asha', dob: '1990-05-01', phone: '9822222222' });
    expect(c.code).toBe('CEN-M000001');
  });

  it('only branch managers of the org may change numbering, and bad patterns are refused', async () => {
    expect(await failure(setNumbering(central, { copy: 'C-{SEQ}' }, lib))).toBe('FORBIDDEN');
    expect(await failure(setNumbering(central, { member: 'MEM-' }))).toBe('INVALID_INPUT');
    expect(await failure(setNumbering(central, { member: 'M-{BOOK}-{SEQ}' }))).toBe('INVALID_INPUT');
  });

  it('refuses a pattern that would repeat an existing code', async () => {
    await register('Asha'); // CEN-M000001
    await setNumbering(central, { member: 'CEN-M00000{SEQ}' });
    expect(await failure(register('Ravi'))).toBe('CODE_TAKEN');
  });

  it('numbers shelves per branch when the code is left blank', async () => {
    expect(await shelf(central)).toBe('CEN-SH-001');
    expect(await shelf(central)).toBe('CEN-SH-002');
    expect(await shelf(north)).toBe('NTH-SH-001');
    await setNumbering(north, { location: '{BRANCH}-{KIND}{SEQ:2}' });
    expect(await shelf(north)).toBe('NTH-SH01');
    expect(await failure(shelf(central, 'CEN-SH-001'))).toBe('DUPLICATE_LOCATION');
  });

  it('gives staff a unique employee ID that survives role changes', async () => {
    expect((await membership(lib)).employeeId).toBe('CEN-E0001'); // granted first in setup
    await grant(lib, ['LIBRARIAN', 'DELIVERY_PERSON'], [central]);
    expect((await membership(lib)).employeeId).toBe('CEN-E0001');
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
    expect(await acquire(next, 1)).toEqual(['BK000002-CP01']);
    await call(numbering.setBookNumbering, sa, { book: '' });
    expect((await db.doc(`books/${await newBook('Catriona')}`).get()).get('code')).toBe('BOOK-000003');
  });
});
