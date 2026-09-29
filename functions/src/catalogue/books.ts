import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command, query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { bookPattern, existingCodes, reserveCodes } from '../core/numbering.js';
import { id, name, reason } from '../core/schemas.js';
import { bucket } from './covers.js';
import { normalizeIsbn } from './isbn.js';
import { AGE_GROUPS, GENRES, LANGUAGES, money, READING_LEVELS } from './model.js';
import { normalizeText, searchTokens } from './search.js';

type RefKind = 'authors' | 'publishers' | 'categories';
const LABEL: Record<RefKind, string> = { authors: 'Author', publishers: 'Publisher', categories: 'Category' };

// ------------------------------------------------------------------ reference data

function refCommands(kind: RefKind) {
  const create = command(
    `${kind}-create`,
    z.strictObject({ name }),
    async ({ actor, input, requestId }, tx) => {
      // Adding a book may need a new author or publisher, so book creators can add them (renaming and archiving stay with editors).
      await actor.requireCatalog('books.create', tx);
      const normalized = normalizeText(input.name);
      const dup = await tx.get(db.collection(kind).where('nameNormalized', '==', normalized).where('status', '==', 'ACTIVE').limit(1));
      if (!dup.empty) throw errors.conflict('DUPLICATE_NAME', `${LABEL[kind]} "${input.name}" already exists.`);
      const ref = db.collection(kind).doc();
      const doc = { name: input.name, nameNormalized: normalized, searchTokens: searchTokens(input.name), status: 'ACTIVE' };
      tx.create(ref, { ...doc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
        action: `${kind}.create`, entityType: kind, entityId: ref.id, after: { name: input.name },
      });
      return { id: ref.id };
    },
  );

  const rename = command(
    `${kind}-rename`,
    z.strictObject({ id, name }),
    async ({ actor, input, requestId }, tx) => {
      await actor.requireCatalog('books.edit', tx);
      const ref = db.doc(`${kind}/${input.id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) throw errors.notFound(LABEL[kind]);
      tx.update(ref, { name: input.name, nameNormalized: normalizeText(input.name), searchTokens: searchTokens(input.name), updatedAt: FieldValue.serverTimestamp() });
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
        action: `${kind}.rename`, entityType: kind, entityId: input.id, before: { name: snap.get('name') }, after: { name: input.name },
      });
      return { id: input.id };
    },
    // Denormalized names on books are refreshed after commit (display + search only).
    async ({ id: refId }) => refreshBooksReferencing(kind, refId),
  );

  const archive = command(
    `${kind}-archive`,
    z.strictObject({ id, reason }),
    async ({ actor, input, requestId }, tx) => {
      await actor.requireCatalog('books.edit', tx);
      const ref = db.doc(`${kind}/${input.id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) throw errors.notFound(LABEL[kind]);
      tx.update(ref, { status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp() });
      recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
        action: `${kind}.archive`, entityType: kind, entityId: input.id, reason: input.reason,
      });
      return { id: input.id };
    },
  );
  return { create, rename, archive };
}

export const authors = refCommands('authors');
export const publishers = refCommands('publishers');
export const categories = refCommands('categories');

// ------------------------------------------------------------------ books

const bookFields = {
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).default(''),
  isbn: z.string().trim().max(20).default(''),
  authorIds: z.array(id).min(1, 'needs at least one author').max(5),
  publisherId: id.nullable().default(null),
  categoryIds: z.array(id).max(5).default([]),
  language: z.enum(LANGUAGES),
  genres: z.array(z.enum(GENRES)).min(1, 'needs at least one genre').max(3),
  ageGroup: z.enum(AGE_GROUPS),
  minAge: z.number().int().min(0).max(18).nullable().default(null),
  readingLevel: z.enum(READING_LEVELS),
  contentTags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  synopsis: z.string().trim().max(2000).default(''),
  edition: z.string().trim().max(60).default(''),
  publicationYear: z.number().int().min(1450).max(new Date().getFullYear() + 1).nullable().default(null),
  keywords: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  replacementPriceMinor: money.default(0),
};
const bookSchema = z.strictObject(bookFields);
type BookInput = z.infer<typeof bookSchema>;

/** Reads (inside the transaction) and checks every referenced author/publisher/category. */
async function resolveRefs(tx: Transaction, input: Pick<BookInput, 'authorIds' | 'publisherId' | 'categoryIds'>) {
  const load = async (kind: RefKind, ids: string[]) => {
    const snaps = await Promise.all(ids.map((i) => tx.get(db.doc(`${kind}/${i}`))));
    const missing = snaps.find((s) => !s.exists || s.get('status') !== 'ACTIVE');
    if (missing) throw errors.invalid(`${LABEL[kind]} ${missing.id} doesn't exist or is archived.`);
    return snaps.map((s) => s.get('name') as string);
  };
  const [authorNames, publisherNames, categoryNames] = await Promise.all([
    load('authors', [...new Set(input.authorIds)]),
    load('publishers', input.publisherId ? [input.publisherId] : []),
    load('categories', [...new Set(input.categoryIds)]),
  ]);
  return { authorNames, publisherName: (publisherNames[0] ?? null) as string | null, categoryNames };
}

function derived(input: BookInput, code: string, isbn13: string | null, names: Awaited<ReturnType<typeof resolveRefs>>) {
  return {
    ...input,
    authorIds: [...new Set(input.authorIds)],
    categoryIds: [...new Set(input.categoryIds)],
    isbn: isbn13,
    authorNames: names.authorNames,
    publisherName: names.publisherName,
    categoryNames: names.categoryNames,
    titleNormalized: normalizeText(input.title),
    searchTokens: searchTokens(input.title, input.subtitle, ...names.authorNames, isbn13, code, ...input.keywords),
  };
}

function canonicalIsbn(raw: string): string | null {
  if (!raw) return null;
  const isbn = normalizeIsbn(raw);
  if (!isbn) throw errors.invalid('That ISBN is not valid. Check the digits (ISBN-10 or ISBN-13).');
  return isbn;
}

/** Adds a title to the shared catalogue. ISBNs are unique (isbnIndex); codes follow the catalogue pattern (default BOOK-000001). */
export const create = command('books-create', bookSchema, async ({ actor, input, requestId }, tx) => {
  await actor.requireCatalog('books.create', tx);
  const isbn = canonicalIsbn(input.isbn);
  const isbnRef = isbn ? db.doc(`isbnIndex/${isbn}`) : null;
  if (isbnRef && (await tx.get(isbnRef)).exists) {
    throw errors.conflict('DUPLICATE_ISBN', 'A book with this ISBN is already in the catalogue.');
  }
  const names = await resolveRefs(tx, input);
  const counter = await reserveCodes(tx, {
    kind: 'book',
    pattern: await bookPattern(tx),
    values: {},
    base: 'counters',
    taken: (c) => existingCodes(tx, 'books', c),
  });
  const [code] = counter.codes;
  const ref = db.collection('books').doc();
  const book = { ...derived(input, code, isbn, names), code, number: counter.number, status: 'ACTIVE' };

  counter.commit();
  if (isbnRef) tx.create(isbnRef, { bookId: ref.id });
  tx.create(ref, { ...book, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
    action: 'book.create', entityType: 'book', entityId: ref.id, after: { code, title: input.title, isbn },
  });
  return { bookId: ref.id, code };
});

const BULK_MAX = 25;

const bulkItem = z.strictObject({
  isbn: z.string().trim().min(10).max(20),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).default(''),
  /** Names, reused when an author or publisher with the same name exists, otherwise added. */
  authors: z.array(z.string().trim().min(1).max(100)).min(1, 'needs at least one author').max(5),
  publisher: z.string().trim().max(100).nullable().default(null),
  language: z.enum(LANGUAGES),
  genres: z.array(z.enum(GENRES)).min(1, 'needs at least one genre').max(3),
  ageGroup: z.enum(AGE_GROUPS),
  readingLevel: z.enum(READING_LEVELS),
  publicationYear: z.number().int().min(1450).max(new Date().getFullYear() + 1).nullable().default(null),
  synopsis: z.string().trim().max(2000).default(''),
  keywords: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
});

/**
 * Adds several titles by ISBN at once (the "Add by ISBN" page), in one
 * transaction. Titles whose ISBN is already in the catalogue are skipped and
 * reported; authors and publishers are matched by name or added.
 */
export const bulkCreate = command(
  'books-bulkCreate',
  z.strictObject({ items: z.array(bulkItem).min(1).max(BULK_MAX, `add at most ${BULK_MAX} books at a time`) }),
  async ({ actor, input, requestId }, tx) => {
    await actor.requireCatalog('books.create', tx);
    const items = input.items.map((item) => {
      const isbn = normalizeIsbn(item.isbn);
      if (!isbn) throw errors.invalid(`${item.isbn} is not a valid ISBN.`);
      return { ...item, isbn };
    });
    const isbns = items.map((i) => i.isbn);
    const repeated = isbns.find((isbn, i) => isbns.indexOf(isbn) !== i);
    if (repeated) throw errors.invalid(`ISBN ${repeated} is listed twice.`);

    // Reads first: existing ISBNs, then every author and publisher name.
    const known = await Promise.all(isbns.map((isbn) => tx.get(db.doc(`isbnIndex/${isbn}`))));
    const fresh = items.filter((_, i) => !known[i].exists);
    const skipped = items.filter((_, i) => known[i].exists).map((i) => ({ isbn: i.isbn, title: i.title, reason: 'Already in the catalogue.' }));
    const wanted = (kind: 'authors' | 'publishers') => {
      const names = new Map<string, string>();
      for (const it of fresh) for (const n of kind === 'authors' ? it.authors : it.publisher ? [it.publisher] : []) names.set(normalizeText(n), names.get(normalizeText(n)) ?? n);
      return names;
    };
    const resolve = async (kind: 'authors' | 'publishers') => {
      const names = wanted(kind);
      const found = await Promise.all(
        [...names.keys()].map(async (key) => {
          const hit = await tx.get(db.collection(kind).where('nameNormalized', '==', key).where('status', '==', 'ACTIVE').limit(1));
          return [key, hit.empty ? null : hit.docs[0]] as const;
        }),
      );
      const ids = new Map<string, { id: string; name: string; isNew: boolean }>();
      for (const [key, doc] of found) {
        ids.set(key, doc ? { id: doc.id, name: doc.get('name') as string, isNew: false } : { id: db.collection(kind).doc().id, name: names.get(key)!, isNew: true });
      }
      return ids;
    };
    const [authorIds, publisherIds] = await Promise.all([resolve('authors'), resolve('publishers')]);
    const counter = fresh.length
      ? await reserveCodes(tx, { kind: 'book', pattern: await bookPattern(tx), values: {}, base: 'counters', count: fresh.length, taken: (c) => existingCodes(tx, 'books', c) })
      : null;

    // Writes.
    const now = FieldValue.serverTimestamp();
    for (const [kind, ids] of [['authors', authorIds], ['publishers', publisherIds]] as const) {
      for (const r of ids.values()) {
        if (!r.isNew) continue;
        tx.create(db.doc(`${kind}/${r.id}`), { name: r.name, nameNormalized: normalizeText(r.name), searchTokens: searchTokens(r.name), status: 'ACTIVE', createdAt: now, updatedAt: now });
      }
    }
    counter?.commit();
    const created = fresh.map((it, i) => {
      const code = counter!.codes[i];
      const authors = [...new Map(it.authors.map((n) => [authorIds.get(normalizeText(n))!.id, authorIds.get(normalizeText(n))!])).values()];
      const publisher = it.publisher ? publisherIds.get(normalizeText(it.publisher))! : null;
      const fields: BookInput = {
        title: it.title,
        subtitle: it.subtitle,
        isbn: it.isbn,
        authorIds: authors.map((a) => a.id),
        publisherId: publisher?.id ?? null,
        categoryIds: [],
        language: it.language,
        genres: [...new Set(it.genres)],
        ageGroup: it.ageGroup,
        minAge: null,
        readingLevel: it.readingLevel,
        contentTags: [],
        synopsis: it.synopsis,
        edition: '',
        publicationYear: it.publicationYear,
        keywords: it.keywords,
        replacementPriceMinor: 0,
      };
      const names = { authorNames: authors.map((a) => a.name), publisherName: publisher?.name ?? null, categoryNames: [] };
      const ref = db.collection('books').doc();
      tx.create(db.doc(`isbnIndex/${it.isbn}`), { bookId: ref.id });
      tx.create(ref, { ...derived(fields, code, it.isbn, names), code, number: counter!.number + i, status: 'ACTIVE', createdAt: now, updatedAt: now });
      return { isbn: it.isbn, bookId: ref.id, code, title: it.title };
    });
    const newRefs = [...authorIds.values(), ...publisherIds.values()].filter((r) => r.isNew).map((r) => r.name);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
      action: 'book.bulkCreate',
      entityType: 'book',
      entityId: created[0]?.bookId ?? 'none',
      after: { books: created.map((c) => `${c.code} ${c.isbn}`), skipped: skipped.map((s) => s.isbn), newAuthorsAndPublishers: newRefs },
    });
    return { created, skipped };
  },
);

export const update = command(
  'books-update',
  z.strictObject({ bookId: id, ...bookFields }),
  async ({ actor, input, requestId }, tx) => {
    await actor.requireCatalog('books.edit', tx);
    const { bookId, ...fields } = input;
    const ref = db.doc(`books/${bookId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Book');
    const isbn = canonicalIsbn(fields.isbn);
    const oldIsbn = snap.get('isbn') as string | null;
    const newIsbnRef = isbn && isbn !== oldIsbn ? db.doc(`isbnIndex/${isbn}`) : null;
    if (newIsbnRef && (await tx.get(newIsbnRef)).exists) {
      throw errors.conflict('DUPLICATE_ISBN', 'A book with this ISBN is already in the catalogue.');
    }
    const names = await resolveRefs(tx, fields);
    const code = snap.get('code') as string;
    const book = derived(fields, code, isbn, names);

    if (oldIsbn && oldIsbn !== isbn) tx.delete(db.doc(`isbnIndex/${oldIsbn}`));
    if (newIsbnRef) tx.create(newIsbnRef, { bookId });
    tx.update(ref, { ...book, updatedAt: FieldValue.serverTimestamp() });
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
      action: 'book.update', entityType: 'book', entityId: bookId,
      before: { title: snap.get('title'), isbn: oldIsbn }, after: { title: fields.title, isbn },
    });
    return { bookId };
  },
);

/** Hides a title from new acquisitions and discovery. Existing copies and history remain. */
export const archive = command('books-archive', z.strictObject({ bookId: id, reason }), async ({ actor, input, requestId }, tx) => {
  await actor.requireCatalog('books.edit', tx);
  const ref = db.doc(`books/${input.bookId}`);
  const snap = await tx.get(ref);
  if (!snap.exists) throw errors.notFound('Book');
  tx.update(ref, { status: 'ARCHIVED', updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
    action: 'book.archive', entityType: 'book', entityId: input.bookId, reason: input.reason,
  });
  return { bookId: input.bookId };
});

/** Brings an archived title back into the catalogue. */
export const restore = command('books-restore', z.strictObject({ bookId: id }), async ({ actor, input, requestId }, tx) => {
  await actor.requireCatalog('books.edit', tx);
  const ref = db.doc(`books/${input.bookId}`);
  const snap = await tx.get(ref);
  if (!snap.exists) throw errors.notFound('Book');
  if (snap.get('status') !== 'ARCHIVED') throw errors.conflict('BOOK_NOT_ARCHIVED', 'Only an archived title can be restored.');
  tx.update(ref, { status: 'ACTIVE', updatedAt: FieldValue.serverTimestamp() });
  recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
    action: 'book.restore', entityType: 'book', entityId: input.bookId, before: { status: 'ARCHIVED' }, after: { status: 'ACTIVE' },
  });
  return { bookId: input.bookId };
});

const USAGE_LIMIT = 500;
type Tally = { total: number; byStatus: Record<string, number> };
export interface BookUsage {
  copies: Tally;
  reservations: Tally;
}

/**
 * Everything in any library that still points at a title: copies in every
 * status (retired and lost ones too) and reservations in every status, across
 * all branches and organizations (the catalogue is shared). Counts stop at USAGE_LIMIT.
 */
async function bookUsage(bookId: string, get: (q: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>): Promise<BookUsage> {
  const tally = (s: FirebaseFirestore.QuerySnapshot): Tally => {
    const byStatus: Record<string, number> = {};
    for (const d of s.docs) byStatus[d.get('status')] = (byStatus[d.get('status')] ?? 0) + 1;
    return { total: s.size, byStatus };
  };
  const [copies, reservations] = await Promise.all([
    get(db.collectionGroup('copies').where('bookId', '==', bookId).select('status').limit(USAGE_LIMIT)),
    get(db.collectionGroup('reservations').where('bookId', '==', bookId).select('status').limit(USAGE_LIMIT)),
  ]);
  return { copies: tally(copies), reservations: tally(reservations) };
}

/** "2 copies (1 retired, 1 lost) and 1 reservation (1 collected)". */
function describeUsage(u: BookUsage): string {
  const words: Record<string, string> = { UNDER_INSPECTION: 'under inspection', IN_TRANSIT: 'in transit', FULFILLED: 'collected', ALLOCATED: 'on hold' };
  const part = (t: Tally, one: string, many: string) => {
    if (!t.total) return null;
    const detail = Object.entries(t.byStatus)
      .map(([s, n]) => `${n} ${words[s] ?? s.toLowerCase()}`)
      .join(', ');
    return `${t.total} ${t.total === 1 ? one : many} (${detail})`;
  };
  return [part(u.copies, 'copy', 'copies'), part(u.reservations, 'reservation', 'reservations')].filter(Boolean).join(' and ');
}

/** What still refers to a title (for the book page before offering "Delete permanently"). */
export const usage = query('books-usage', z.strictObject({ bookId: id }), async ({ actor, input }) => {
  await db.runTransaction((tx) => actor.requireCatalog('books.edit', tx));
  const u = await bookUsage(input.bookId, (q) => q.get());
  return { ...u, summary: u.copies.total || u.reservations.total ? describeUsage(u) : null };
});

/**
 * Permanently deletes an archived title that no organization ever stocked or
 * reserved (history must stay intact, so a title with copies or reservations
 * can only stay archived). Frees its ISBN; the cover file is removed after commit.
 */
export const remove = command(
  'books-delete',
  z.strictObject({ bookId: id, reason }),
  async ({ actor, input, requestId }, tx) => {
    await actor.requireCatalog('books.delete', tx);
    const ref = db.doc(`books/${input.bookId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw errors.notFound('Book');
    if (snap.get('status') !== 'ARCHIVED') throw errors.conflict('BOOK_NOT_ARCHIVED', 'Archive the title before deleting it.');
    const found = await bookUsage(input.bookId, (q) => tx.get(q));
    if (found.copies.total || found.reservations.total) {
      throw errors.conflict('BOOK_IN_USE', `${describeUsage(found)} still refer to this title, so it stays archived to keep their history.`);
    }
    const isbn = snap.get('isbn') as string | null;
    if (isbn) tx.delete(db.doc(`isbnIndex/${isbn}`));
    tx.delete(ref);
    recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId }, null, {
      action: 'book.delete', entityType: 'book', entityId: input.bookId, reason: input.reason,
      before: { code: snap.get('code'), title: snap.get('title'), isbn },
    });
    return { bookId: input.bookId, coverPath: (snap.get('coverPath') as string | undefined) ?? null };
  },
  async ({ coverPath }) => {
    // Best effort: an orphaned image is harmless, a failed delete must not fail the call.
    if (coverPath) await bucket().file(coverPath).delete({ ignoreNotFound: true }).catch(() => undefined);
  },
);

/** Refreshes denormalized author/publisher/category names and search tokens on books. */
async function refreshBooksReferencing(kind: RefKind, refId: string) {
  const field = kind === 'authors' ? 'authorIds' : kind === 'categories' ? 'categoryIds' : 'publisherId';
  const q = kind === 'publishers' ? db.collection('books').where(field, '==', refId) : db.collection('books').where(field, 'array-contains', refId);
  const books = await q.get();
  for (const doc of books.docs) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const b = snap.data() as BookInput & { code: string; isbn: string | null };
      const names = await resolveRefsLenient(tx, b);
      tx.update(doc.ref, derived({ ...b, isbn: b.isbn ?? '' } as BookInput, b.code, b.isbn, names));
    });
  }
}

async function resolveRefsLenient(tx: Transaction, b: Pick<BookInput, 'authorIds' | 'publisherId' | 'categoryIds'>) {
  const names = async (kind: RefKind, ids: string[]) =>
    (await Promise.all(ids.map((i) => tx.get(db.doc(`${kind}/${i}`))))).map((s) => (s.get('name') as string) ?? '');
  return {
    authorNames: await names('authors', b.authorIds),
    publisherName: (await names('publishers', b.publisherId ? [b.publisherId] : []))[0] ?? null,
    categoryNames: await names('categories', b.categoryIds),
  };
}
