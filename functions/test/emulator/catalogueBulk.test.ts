import { beforeEach, describe, expect, it } from 'vitest';

import * as catalog from '../../src/catalogue/books.js';
import * as receive from '../../src/inventory/receive.js';
import { isbn13CheckDigit } from '../../src/catalogue/isbn.js';
import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, bm: TestUser, lib: TestUser, del: TestUser;
let org: string, central: string, existingId: string;
const isbn = (first12: string) => first12 + isbn13CheckDigit(first12);
const [A, B, C, D] = ['978014044913', '978000000001', '978000000002', '978000000003'].map(isbn);
const item = (i: string, title: string, authors: string[], publisher: string | null = null) => ({
  isbn: i, title, authors, publisher, language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
});

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [bm, lib, del] = await Promise.all(['bm', 'lib', 'del'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['BRANCH_MANAGER'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: del.email, roles: ['DELIVERY_PERSON'], branchIds: [central] });
  const { id: bond } = await call<{ id: string }>(catalog.authors.create, sa, { name: 'Ruskin Bond' });
  existingId = (await call<{ bookId: string }>(catalog.create, sa, { title: 'Already here', isbn: A, authorIds: [bond], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE' })).bookId;
});

describe('adding books by ISBN in bulk', () => {
  it('creates the new titles, reuses authors by name, and skips ISBNs already in the catalogue', async () => {
    const res = await call<{ created: { isbn: string; code: string; bookId: string }[]; skipped: { isbn: string }[] }>(catalog.bulkCreate, bm, {
      items: [
        item(A, 'Duplicate', ['Ruskin Bond']),
        item(B, 'The Blue Umbrella', ['ruskin  bond'], 'Rupa'),
        item(C, 'Rusty Runs Away', ['Ruskin Bond', 'New Writer'], 'rupa'),
        item(`${D.slice(0, 3)}-${D.slice(3)}`, 'Gitanjali', ['Rabindranath Tagore']),
      ],
    });
    expect(res.skipped.map((s) => s.isbn)).toEqual([A]);
    expect(res.created.map((c) => c.isbn)).toEqual([B, C, D]);
    expect(new Set(res.created.map((c) => c.code)).size).toBe(3);

    const authors = await db.collection('authors').get();
    expect(authors.docs.map((d) => d.get('name')).sort()).toEqual(['New Writer', 'Rabindranath Tagore', 'Ruskin Bond']);
    const publishers = await db.collection('publishers').get();
    expect(publishers.docs.map((d) => d.get('name'))).toEqual(['Rupa']);
    const blue = (await db.doc(`books/${res.created[0].bookId}`).get()).data()!;
    expect(blue).toMatchObject({ title: 'The Blue Umbrella', isbn: B, authorNames: ['Ruskin Bond'], publisherName: 'Rupa', status: 'ACTIVE' });
    expect((await db.doc(`isbnIndex/${D}`).get()).get('bookId')).toBe(res.created[2].bookId);
  });

  it('refuses bad input and people who cannot add books', async () => {
    expect(await failure(call(catalog.bulkCreate, bm, { items: [item('9780000000000', 'Bad', ['X'])] }))).toBe('INVALID_INPUT');
    expect(await failure(call(catalog.bulkCreate, bm, { items: [item(B, 'One', ['X']), item(B, 'Two', ['X'])] }))).toBe('INVALID_INPUT');
    expect(await failure(call(catalog.bulkCreate, bm, { items: [{ ...item(B, 'No author', []) }] }))).toBe('INVALID_INPUT');
    expect(await failure(call(catalog.bulkCreate, del, { items: [item(B, 'One', ['X'])] }))).toBe('FORBIDDEN');
    expect(await failure(call(catalog.bulkCreate, bm, { items: Array.from({ length: 26 }, (_, i) => item(isbn(`97810000${String(i).padStart(4, '0')}`), `T${i}`, ['X'])) }))).toBe('INVALID_INPUT');
  });
});

describe('receiving a delivery', () => {
  type Received = { received: { bookId: string; title: string; codes: string[]; copyIds: string[]; isNew: boolean }[]; newTitles: { isbn: string; code: string }[]; copies: number };
  const receiveAs = (by: TestUser, items: unknown[], extra: Record<string, unknown> = {}) =>
    call<Received>(receive.receive, by, { orgId: org, branchId: central, items, ...extra });
  const copiesOf = async (bookId: string) => (await db.collection(`orgs/${org}/copies`).where('bookId', '==', bookId).get()).docs;

  it('a librarian adds new titles and all the copies at the branch in one go', async () => {
    const res = await receiveAs(lib, [
      { bookId: existingId, quantity: 2, acquisitionCostMinor: 25000 },
      { book: item(B, 'The Blue Umbrella', ['Ruskin Bond'], 'Rupa'), quantity: 3, acquisitionCostMinor: 19900 },
      { book: item(C, 'Rusty Runs Away', ['Ruskin Bond']), quantity: 1, acquisitionCostMinor: 15000 },
      // An ISBN already in the catalogue just gets copies, merged with the line above.
      { book: item(A, 'Already here again', ['Ruskin Bond']), quantity: 1, acquisitionCostMinor: 25000 },
    ], { condition: 'NEW' });
    expect(res.copies).toBe(7);
    expect(res.newTitles.map((t) => t.isbn)).toEqual([B, C]);
    expect(res.received.map((r) => [r.title, r.codes.length, r.isNew])).toEqual([
      ['Already here', 3, false],
      ['The Blue Umbrella', 3, true],
      ['Rusty Runs Away', 1, true],
    ]);
    const all = res.received.flatMap((r) => r.codes);
    expect(new Set(all).size).toBe(7);
    const blue = res.received[1];
    const copies = await copiesOf(blue.bookId);
    expect(copies).toHaveLength(3);
    expect(copies[0].data()).toMatchObject({ owningBranchId: central, currentBranchId: central, status: 'AVAILABLE', condition: 'NEW', acquisitionCostMinor: 19900, bookTitle: 'The Blue Umbrella' });
    expect((await db.doc(`books/${blue.bookId}`).get()).get('status')).toBe('ACTIVE');
    expect((await db.doc(`orgs/${org}/barcodes/${blue.codes[0]}`).get()).get('copyId')).toBe(blue.copyIds[0]);
    expect((await db.collection('authors').where('name', '==', 'Ruskin Bond').get()).size).toBe(1);
  });

  it('numbers copies of several titles from a shared counter without repeats', async () => {
    await db.doc(`orgs/${org}/branches/${central}`).update({ 'numbering.copy': '{BRANCH}-C{SEQ:4}' });
    const res = await receiveAs(lib, [
      { bookId: existingId, quantity: 2, acquisitionCostMinor: 10000 },
      { book: item(B, 'The Blue Umbrella', ['Ruskin Bond']), quantity: 2, acquisitionCostMinor: 10000 },
    ]);
    expect(res.received.flatMap((r) => r.codes)).toEqual(['CEN-C0001', 'CEN-C0002', 'CEN-C0003', 'CEN-C0004']);
    const again = await receiveAs(lib, [{ bookId: existingId, quantity: 1, acquisitionCostMinor: 10000 }]);
    expect(again.received[0].codes).toEqual(['CEN-C0005']);
  });

  it('refuses people who cannot add copies, and deliveries that are too big', async () => {
    expect(await failure(receiveAs(del, [{ bookId: existingId, quantity: 1, acquisitionCostMinor: 100 }]))).toBe('FORBIDDEN');
    expect(await failure(receiveAs(lib, [{ bookId: existingId, quantity: 50, acquisitionCostMinor: 100 }, { book: item(B, 'Big', ['X']), quantity: 51, acquisitionCostMinor: 100 }]))).toBe('INVALID_INPUT');
    await call(catalog.archive, sa, { bookId: existingId, reason: 'Out of print' });
    expect(await failure(receiveAs(lib, [{ bookId: existingId, quantity: 1, acquisitionCostMinor: 100 }]))).toBe('NOT_FOUND');
    // Nothing half-done: the failed deliveries added no copies and no titles.
    expect(await copiesOf(existingId)).toHaveLength(0);
    expect((await db.doc(`isbnIndex/${B}`).get()).exists).toBe(false);
  });
});
