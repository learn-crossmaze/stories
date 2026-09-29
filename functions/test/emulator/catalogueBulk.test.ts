import { beforeEach, describe, expect, it } from 'vitest';

import * as catalog from '../../src/catalogue/books.js';
import { isbn13CheckDigit } from '../../src/catalogue/isbn.js';
import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

let sa: TestUser, bm: TestUser, lib: TestUser;
const isbn = (first12: string) => first12 + isbn13CheckDigit(first12);
const [A, B, C, D] = ['978014044913', '978000000001', '978000000002', '978000000003'].map(isbn);
const item = (i: string, title: string, authors: string[], publisher: string | null = null) => ({
  isbn: i, title, authors, publisher, language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE',
});

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [bm, lib] = await Promise.all(['bm', 'lib'].map((n) => createUser(`${n}@stories.test`)));
  const org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  const central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['BRANCH_MANAGER'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: lib.email, roles: ['LIBRARIAN'], branchIds: [central] });
  const { id: bond } = await call<{ id: string }>(catalog.authors.create, sa, { name: 'Ruskin Bond' });
  await call(catalog.create, sa, { title: 'Already here', isbn: A, authorIds: [bond], language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE' });
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
    expect(await failure(call(catalog.bulkCreate, lib, { items: [item(B, 'One', ['X'])] }))).toBe('FORBIDDEN');
    expect(await failure(call(catalog.bulkCreate, bm, { items: Array.from({ length: 26 }, (_, i) => item(isbn(`97810000${String(i).padStart(4, '0')}`), `T${i}`, ['X'])) }))).toBe('INVALID_INPUT');
  });
});
