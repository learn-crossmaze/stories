import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as catalog from '../../src/catalogue/books.js';
import * as bookLookup from '../../src/catalogue/lookup.js';
import { db } from '../../src/core/firebase.js';
import * as branches from '../../src/organization/branches.js';
import * as orgs from '../../src/organization/orgs.js';
import * as staff from '../../src/organization/staff.js';
import { address, call, contact, createUser, failure, resetEmulators, type TestUser } from './helpers.js';

// Adding one title faster: books-create takes authors and the publisher by name (no command of their own first),
// and books-lookup answers an "exact" ISBN lookup as soon as Google Books has it. Ids-only creates, books-update
// and books-bulkCreate stay as phase1 and catalogueBulk pin them.

let sa: TestUser, bm: TestUser, del: TestUser;
let org: string, central: string, stevenson: string;

const ISBN = '9780306406157';
const base = { language: 'en', genres: ['FICTION'], ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE' };
type Created = { bookId: string; code: string };
const add = (by: TestUser, fields: Record<string, unknown>, requestId: string = randomUUID()) => call<Created>(catalog.create, by, { ...base, ...fields }, requestId);
const book = async (bookId: string) => (await db.doc(`books/${bookId}`).get()).data()!;
const names = async (kind: 'authors' | 'publishers') => (await db.collection(kind).get()).docs.map((d) => d.get('name') as string).sort();
const audits = async (action: string) => (await db.collection('platformAuditLogs').where('action', '==', action).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await resetEmulators();
  sa = await createUser('sa@stories.test', { superAdmin: true });
  [bm, del] = await Promise.all(['bm', 'del'].map((n) => createUser(`${n}@stories.test`)));
  org = (await call<{ orgId: string }>(orgs.create, sa, { name: 'Stories Corporate', type: 'CORPORATE' })).orgId;
  central = (await call<{ branchId: string }>(branches.create, sa, { orgId: org, code: 'CEN', name: 'Central', address, contact })).branchId;
  await call(staff.setRoles, sa, { orgId: org, email: bm.email, roles: ['SENIOR_LIBRARIAN'], branchIds: [central] });
  await call(staff.setRoles, sa, { orgId: org, email: del.email, roles: ['DELIVERY_PERSON'], branchIds: [central] });
  stevenson = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Robert Louis Stevenson' })).id;
});

describe('books-create with authors and publisher by name', () => {
  it('adds the authors and the publisher it does not know, in the same transaction, and names them in the audit entry', async () => {
    const { bookId, code } = await add(bm, { title: 'The Blue Umbrella', isbn: ISBN, newAuthors: ['Ruskin Bond'], newPublisher: 'Rupa' });
    expect(code).toBe('BOOK-000001');
    const author = (await db.collection('authors').where('nameNormalized', '==', 'ruskin bond').get()).docs[0];
    const publisher = (await db.collection('publishers').get()).docs[0];
    // The same document authors-create writes.
    expect(author.data()).toMatchObject({ name: 'Ruskin Bond', nameNormalized: 'ruskin bond', status: 'ACTIVE' });
    expect(author.get('searchTokens')).toContain('rus');
    expect(author.get('createdAt')).toBeTruthy();
    expect(author.get('updatedAt')).toBeTruthy();
    expect(publisher.data()).toMatchObject({ name: 'Rupa', nameNormalized: 'rupa', status: 'ACTIVE' });

    const saved = await book(bookId);
    expect(saved).toMatchObject({
      title: 'The Blue Umbrella', isbn: ISBN, authorIds: [author.id], authorNames: ['Ruskin Bond'], publisherId: publisher.id, publisherName: 'Rupa', status: 'ACTIVE',
    });
    expect(saved.searchTokens).toContain('bond');
    // The names were instructions, not fields of the book.
    expect(saved).not.toHaveProperty('newAuthors');
    expect(saved).not.toHaveProperty('newPublisher');
    expect((await db.doc(`isbnIndex/${ISBN}`).get()).get('bookId')).toBe(bookId);

    const [entry] = await audits('book.create');
    expect(entry).toMatchObject({ entityId: bookId, actorUid: bm.uid, after: { code, title: 'The Blue Umbrella', isbn: ISBN, newAuthorsAndPublishers: ['Ruskin Bond', 'Rupa'] } });
    expect(await audits('authors.create')).toHaveLength(1); // only the one from the set-up
  });

  it('reuses the author or publisher of that name, whatever the case, spacing or accents', async () => {
    const garcia = (await call<{ id: string }>(catalog.authors.create, sa, { name: 'Gabriel García Márquez' })).id;
    const penguin = (await call<{ id: string }>(catalog.publishers.create, sa, { name: 'Penguin' })).id;
    const { bookId } = await add(bm, { title: 'Chronicle', newAuthors: ['gabriel  GARCIA marquez', 'robert louis stevenson'], newPublisher: 'PENGUIN' });
    expect(await book(bookId)).toMatchObject({
      authorIds: [garcia, stevenson], authorNames: ['Gabriel García Márquez', 'Robert Louis Stevenson'], publisherId: penguin, publisherName: 'Penguin',
    });
    expect(await names('authors')).toEqual(['Gabriel García Márquez', 'Robert Louis Stevenson']);
    expect(await names('publishers')).toEqual(['Penguin']);
    expect((await audits('book.create'))[0].after.newAuthorsAndPublishers).toEqual([]);
  });

  it('takes ids and names together: ids first, each author once', async () => {
    const { bookId } = await add(bm, {
      title: 'Together', authorIds: [stevenson, stevenson], newAuthors: ['Robert Louis STEVENSON', 'Lloyd Osbourne', 'lloyd osbourne', '???'],
    });
    const saved = await book(bookId);
    const lloyd = (await db.collection('authors').where('nameNormalized', '==', 'lloyd osbourne').get()).docs;
    expect(lloyd).toHaveLength(1);
    expect(saved.authorIds).toEqual([stevenson, lloyd[0].id]);
    expect(saved.authorNames).toEqual(['Robert Louis Stevenson', 'Lloyd Osbourne']);
    expect(saved.publisherId).toBeNull();
    expect(await names('authors')).toEqual(['Lloyd Osbourne', 'Robert Louis Stevenson']);
  });

  it('gives an archived namesake a new author, as authors-create does', async () => {
    await call(catalog.authors.archive, sa, { id: stevenson, reason: 'Entered twice' });
    const { bookId } = await add(bm, { title: 'Kidnapped', newAuthors: ['Robert Louis Stevenson'] });
    const saved = await book(bookId);
    expect(saved.authorIds).toHaveLength(1);
    expect(saved.authorIds[0]).not.toBe(stevenson);
    expect((await db.collection('authors').get()).size).toBe(2);
  });

  it('still needs one to five authors, and one publisher at most', async () => {
    expect(await failure(add(bm, { title: 'Nobody' }))).toBe('INVALID_INPUT');
    expect(await failure(add(bm, { title: 'Nobody', authorIds: [], newAuthors: [] }))).toBe('INVALID_INPUT');
    expect(await failure(add(bm, { title: 'Nobody', newAuthors: ['...', '?!'] }))).toBe('INVALID_INPUT');
    expect(await failure(add(bm, { title: 'Crowd', authorIds: [stevenson], newAuthors: ['A One', 'B Two', 'C Three', 'D Four', 'E Five'] }))).toBe('INVALID_INPUT');
    expect(await failure(add(bm, { title: 'Crowd', newAuthors: ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six'] }))).toBe('INVALID_INPUT');
    const penguin = (await call<{ id: string }>(catalog.publishers.create, sa, { name: 'Penguin' })).id;
    expect(await failure(add(bm, { title: 'Two houses', newAuthors: ['A One'], publisherId: penguin, newPublisher: 'Rupa' }))).toBe('INVALID_INPUT');
    expect(await failure(add(bm, { title: 'Ghost', authorIds: ['no-such-author'], newAuthors: ['A One'] }))).toBe('INVALID_INPUT');
    // Nothing was added along the way.
    expect(await names('authors')).toEqual(['Robert Louis Stevenson']);
    expect(await names('publishers')).toEqual(['Penguin']);
    expect((await db.collection('books').get()).size).toBe(0);

    // Five in all is fine when one of the names is an author already chosen.
    const { bookId } = await add(bm, { title: 'Full house', authorIds: [stevenson], newAuthors: ['Robert Louis Stevenson', 'A One', 'B Two', 'C Three', 'D Four'] });
    expect((await book(bookId)).authorIds).toHaveLength(5);
  });

  it('refuses people who cannot add titles before anything is looked up or added', async () => {
    await add(sa, { title: 'Treasure Island', isbn: ISBN, authorIds: [stevenson] });
    expect(await failure(add(del, { title: 'Sneaky', newAuthors: ['Someone New'], newPublisher: 'Somewhere' }))).toBe('FORBIDDEN');
    // Not told whether the ISBN is ours, nor that the input was wrong.
    expect(await failure(add(del, { title: 'Sneaky', isbn: ISBN, newAuthors: ['Someone New'] }))).toBe('FORBIDDEN');
    expect(await failure(add(del, { title: 'Sneaky' }))).toBe('FORBIDDEN');
    expect(await names('authors')).toEqual(['Robert Louis Stevenson']);
    expect(await names('publishers')).toEqual([]);
  });

  it('keeps the order of refusals: a duplicate ISBN before an unknown author', async () => {
    await add(sa, { title: 'Treasure Island', isbn: ISBN, authorIds: [stevenson] });
    expect(await failure(add(bm, { title: 'Again', isbn: '0-306-40615-2', authorIds: ['no-such-author'], newAuthors: ['Someone New'] }))).toBe('DUPLICATE_ISBN');
    expect(await failure(add(bm, { title: 'Bad', isbn: '9780306406158', newAuthors: ['Someone New'] }))).toBe('INVALID_INPUT');
    expect(await names('authors')).toEqual(['Robert Louis Stevenson']);
  });

  it('does it once when the same request is sent again', async () => {
    const requestId = randomUUID();
    const first = await add(bm, { title: 'Once', newAuthors: ['Only Once'], newPublisher: 'One House' }, requestId);
    const again = await add(bm, { title: 'Once', newAuthors: ['Only Once'], newPublisher: 'One House' }, requestId);
    expect(again).toEqual(first);
    expect((await db.collection('books').get()).size).toBe(1);
    expect(await names('authors')).toEqual(['Only Once', 'Robert Louis Stevenson']);
    expect(await names('publishers')).toEqual(['One House']);
    expect(await audits('book.create')).toHaveLength(1);

    // A second title by the same new author reuses the author just added.
    const next = await add(bm, { title: 'Twice', newAuthors: ['only once'] });
    expect((await book(next.bookId)).authorIds).toEqual((await book(first.bookId)).authorIds);
    expect(next.code).toBe('BOOK-000002');
  });

  it('leaves editing by ids only: books-update does not take names', async () => {
    const { bookId } = await add(sa, { title: 'Treasure Island', authorIds: [stevenson] });
    expect(await failure(call(catalog.update, sa, { ...base, bookId, title: 'Treasure Island', authorIds: [stevenson], newAuthors: ['Someone New'] }))).toBe('INVALID_INPUT');
    expect(await failure(call(catalog.update, sa, { ...base, bookId, title: 'Treasure Island', authorIds: [] }))).toBe('INVALID_INPUT');
    await call(catalog.update, sa, { ...base, bookId, title: 'Treasure Island (1883)', authorIds: [stevenson] });
    expect((await book(bookId)).title).toBe('Treasure Island (1883)');
  });
});

describe('books-lookup for one exact ISBN', () => {
  const volume = (title: string, isbn: string, categories: string[] = []) => ({ volumeInfo: { title, authors: ['Robert Louis Stevenson'], categories, industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }] } });
  type Lookup = { candidates: { source: string; title: string; isbn: string | null; ageGroup: string | null; existingBookId: string | null }[]; sources: { source: string; ok: boolean | null; skipped?: boolean }[] };

  /**
   * Fakes the two public catalogues. `openLibrary: 'hangs'` never answers: it only ends when the caller gives up on
   * it (its signal aborts), as a real fetch does. `'slow'` answers after a moment.
   */
  function fakeInternet(opts: { google?: unknown; googleDown?: boolean; openLibrary?: unknown; openLibraryDown?: boolean }) {
    const realFetch = globalThis.fetch;
    const state = { seen: [] as string[], openLibraryGivenUp: false };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const host = new URL(url).hostname;
      if (!['www.googleapis.com', 'openlibrary.org'].includes(host)) return realFetch(input, init);
      state.seen.push(host);
      if (host === 'www.googleapis.com') {
        if (opts.googleDown) throw new TypeError('fetch failed');
        return Response.json(opts.google ?? { totalItems: 0 });
      }
      if (opts.openLibraryDown) throw new TypeError('fetch failed');
      if (opts.openLibrary === 'hangs') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            state.openLibraryGivenUp = true;
            reject(init.signal!.reason);
          });
        });
      }
      if (opts.openLibrary === 'slow') {
        await new Promise((r) => setTimeout(r, 300));
        return Response.json({ docs: [{ title: 'Kidnapped', author_name: ['Robert Louis Stevenson'], first_publish_year: 1886 }] });
      }
      return Response.json(opts.openLibrary ?? { docs: [] });
    });
    return state;
  }
  afterEach(() => vi.restoreAllMocks());

  it('answers as soon as Google Books has that ISBN, gives up on Open Library, and still says whether the title is ours', async () => {
    const { bookId } = await add(sa, { title: 'Treasure Island', isbn: ISBN, authorIds: [stevenson] });
    const net = fakeInternet({ google: { items: [volume('Treasure Island', ISBN, ['Juvenile Fiction']), volume('Kidnapped', '9780141441900')] }, openLibrary: 'hangs' });
    const started = Date.now();
    const res = await call<Lookup>(bookLookup.lookup, bm, { q: '0-306-40615-2', exact: true }, null);
    expect(Date.now() - started).toBeLessThan(3000); // not the 6 s a hanging source takes to time out
    // Everything Google returned, in its order: what the merge would have put first anyway.
    expect(res.candidates.map((c) => [c.source, c.title, c.existingBookId])).toEqual([['Google Books', 'Treasure Island', bookId], ['Google Books', 'Kidnapped', null]]);
    expect(res.candidates.map((c) => c.ageGroup)).toEqual(['CHILDREN', null]);
    expect(res.sources).toEqual([{ source: 'Google Books', ok: true }, { source: 'Open Library', ok: null, skipped: true }]);
    // Both were asked at once; Open Library's request was cancelled, not left running.
    expect(net.seen.sort()).toEqual(['openlibrary.org', 'www.googleapis.com']);
    await vi.waitFor(() => expect(net.openLibraryGivenUp).toBe(true));
  });

  it('waits for Open Library when Google Books does not have that very ISBN, or is down', async () => {
    const openLibrary = { docs: [{ title: 'Treasure Island', author_name: ['Robert Louis Stevenson'], isbn: [ISBN], subject: ['Young adult fiction'] }] };
    fakeInternet({ google: { items: [volume('Another edition', '9780141441900')] }, openLibrary });
    const other = await call<Lookup>(bookLookup.lookup, bm, { q: ISBN, exact: true }, null);
    expect(other.candidates.map((c) => [c.source, c.isbn, c.ageGroup])).toEqual([['Google Books', '9780141441900', null], ['Open Library', ISBN, 'TEENS']]);
    expect(other.sources).toEqual([{ source: 'Google Books', ok: true }, { source: 'Open Library', ok: true }]);
    vi.restoreAllMocks();

    fakeInternet({ googleDown: true, openLibrary });
    const down = await call<Lookup>(bookLookup.lookup, bm, { q: ISBN, exact: true }, null);
    expect(down.candidates.map((c) => c.source)).toEqual(['Open Library']);
    expect(down.sources).toEqual([{ source: 'Google Books', ok: false }, { source: 'Open Library', ok: true }]);
  });

  it('waits for both when exact is not asked for, and for a title search even when it is', async () => {
    const net = fakeInternet({ google: { items: [volume('Treasure Island', ISBN)] }, openLibrary: 'slow' });
    const plain = await call<Lookup>(bookLookup.lookup, bm, { q: ISBN }, null);
    expect(plain.candidates.map((c) => c.title)).toEqual(['Treasure Island', 'Kidnapped']);
    expect(plain.sources).toEqual([{ source: 'Google Books', ok: true }, { source: 'Open Library', ok: true }]);
    const byTitle = await call<Lookup>(bookLookup.lookup, bm, { q: 'treasure island', exact: true }, null);
    expect(byTitle.candidates.map((c) => c.title)).toEqual(['Treasure Island', 'Kidnapped']);
    expect(net.openLibraryGivenUp).toBe(false);
  });

  it('keeps its refusals: not for people who cannot add titles (nothing goes out), unavailable when both are down', async () => {
    const net = fakeInternet({ google: { items: [volume('Treasure Island', ISBN)] } });
    expect(await failure(call(bookLookup.lookup, del, { q: ISBN, exact: true }, null))).toBe('FORBIDDEN');
    expect(net.seen).toEqual([]);
    expect(await failure(call(bookLookup.lookup, bm, { q: ISBN, exact: 'yes' }, null))).toBe('INVALID_INPUT');
    vi.restoreAllMocks();
    fakeInternet({ googleDown: true, openLibraryDown: true });
    expect(await failure(call(bookLookup.lookup, bm, { q: ISBN, exact: true }, null))).toBe('LOOKUP_UNAVAILABLE');
  });
});

describe('books-usage', () => {
  it('checks the catalogue permission without a transaction of its own', async () => {
    const { bookId } = await add(sa, { title: 'Treasure Island', authorIds: [stevenson] });
    expect((await call<{ summary: string | null }>(catalog.usage, sa, { bookId }, null)).summary).toBeNull();
    // Adding titles is not editing them.
    expect(await failure(call(catalog.usage, bm, { bookId }, null))).toBe('FORBIDDEN');
    expect(await failure(call(catalog.usage, del, { bookId }, null))).toBe('FORBIDDEN');
  });
});
