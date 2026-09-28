import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { command } from '../core/callable.js';
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
  return { authorNames, publisherName: publisherNames[0] ?? null, categoryNames };
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
    const [copies, reservations] = await Promise.all([
      tx.get(db.collectionGroup('copies').where('bookId', '==', input.bookId).limit(1)),
      tx.get(db.collectionGroup('reservations').where('bookId', '==', input.bookId).limit(1)),
    ]);
    if (!copies.empty || !reservations.empty) {
      throw errors.conflict('BOOK_IN_USE', 'This title has copies or reservations in a library, so it stays archived to keep their history.');
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
