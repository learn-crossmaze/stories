// "Add by ISBN": look each ISBN up in public catalogues, then add the good ones in one go (functions/src/catalogue/books.ts bulkCreate).
import type { Candidate } from '../admin/catalogue/BookLookup';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';

import type { Book } from './catalogue';
import { call, command } from './api';
import { db, withId } from './common';
import type { AgeGroup, Genre, READING_LEVELS } from './common';

/** A title already in our catalogue, by ISBN (no outside lookup: restocking works offline and for everyone). */
export async function catalogueByIsbn(isbn: string): Promise<Candidate | null> {
  const snap = await getDocs(query(collection(db(), 'books'), where('isbn', '==', isbn), limit(1)));
  if (snap.empty) return null;
  const b = withId<Book>(snap.docs[0]);
  return {
    source: 'catalogue', title: b.title, subtitle: b.subtitle ?? '', authors: b.authorNames, publisher: b.publisherName, year: b.publicationYear,
    isbn, language: b.language, synopsis: '', genres: b.genres, subjects: [], coverUrl: b.coverUrl ?? null, existingBookId: b.id,
  };
}

/**
 * What an ISBN is: a title in our catalogue first, otherwise the public-catalogue
 * match (the edition with that ISBN when there is one), or null. `external: false`
 * skips the outside lookup (for staff who can't add titles).
 */
export async function lookupIsbn(isbn: string, external = true): Promise<Candidate | null> {
  const ours = await catalogueByIsbn(isbn);
  if (ours || !external) return ours;
  const res = await call<{ candidates: Candidate[] }>('books-lookup', { q: isbn });
  return res.candidates.find((c) => c.isbn === isbn) ?? res.candidates[0] ?? null;
}

export interface BulkItem {
  isbn: string;
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string | null;
  language: string;
  genres: Genre[];
  ageGroup: AgeGroup;
  readingLevel: (typeof READING_LEVELS)[number];
  publicationYear: number | null;
  synopsis: string;
}

export interface BulkResult {
  created: { isbn: string; bookId: string; code: string; title: string }[];
  skipped: { isbn: string; title: string; reason: string }[];
}

/** Items [start, end) of a list, sent in one call. */
export interface ChunkRange {
  start: number;
  end: number;
}

/**
 * How a list sent in several calls reports back. Each call is its own
 * transaction: when a later one fails, the earlier ones have happened, so
 * `onChunk` hands over each call's result as soon as it is committed (the
 * screen marks those rows done and a retry sends only the rest). `requestId`
 * picks the id for a call; giving the same id when the same items are sent
 * again makes a retry after an unknown outcome return the stored result
 * instead of doing it twice.
 */
export interface ChunkOptions<R> {
  onChunk?: (result: R, range: ChunkRange) => void;
  requestId?: (range: ChunkRange) => string | undefined;
}

/** The server takes 25 books per call; longer lists go in several calls. */
export const BULK_CHUNK = 25;

export async function bulkCreateBooks(items: BulkItem[], options: ChunkOptions<BulkResult> = {}): Promise<BulkResult> {
  const out: BulkResult = { created: [], skipped: [] };
  for (let start = 0; start < items.length; start += BULK_CHUNK) {
    const range = { start, end: Math.min(items.length, start + BULK_CHUNK) };
    const res = await command<BulkResult>('books-bulkCreate', { items: items.slice(range.start, range.end) }, options.requestId?.(range));
    out.created.push(...res.created);
    out.skipped.push(...res.skipped);
    options.onChunk?.(res, range);
  }
  return out;
}

/** Attaches a cover found during lookup; a failed download just leaves the book without one. */
export const importCover = (bookId: string, imageUrl: string) => command('books-setCover', { bookId, imageUrl }).then(() => true).catch(() => false);

/** One title in a delivery: already in the catalogue (`bookId`) or new (`book`), with its copies. */
export type ReceiveItem = ({ bookId: string } | { book: BulkItem }) & { quantity: number; acquisitionCostMinor: number };

export interface ReceiveResult {
  received: { bookId: string; title: string; codes: string[]; copyIds: string[]; isNew: boolean }[];
  newTitles: { isbn: string; bookId: string; code: string }[];
  copies: number;
  allocated: number;
}

/** The server takes 25 titles and 100 copies per call; a bigger delivery goes in several calls. */
export const RECEIVE_TITLES = 25;
export const RECEIVE_COPIES = 100;

/** How a delivery is split into calls: at most 25 titles and 100 copies each. */
export function receiveChunks(items: Pick<ReceiveItem, 'quantity'>[]): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  let start = 0;
  let copies = 0;
  items.forEach((item, i) => {
    if (i > start && (i - start === RECEIVE_TITLES || copies + item.quantity > RECEIVE_COPIES)) {
      ranges.push({ start, end: i });
      start = i;
      copies = 0;
    }
    copies += item.quantity;
  });
  if (items.length > start) ranges.push({ start, end: items.length });
  return ranges;
}

/** Receives a delivery at a branch (functions/src/inventory/receive.ts): new titles and every copy. */
export async function receiveStock(
  target: { orgId: string; branchId: string; locationId: string | null; condition: string },
  items: ReceiveItem[],
  options: ChunkOptions<ReceiveResult> = {},
): Promise<ReceiveResult> {
  const out: ReceiveResult = { received: [], newTitles: [], copies: 0, allocated: 0 };
  for (const range of receiveChunks(items)) {
    const res = await command<ReceiveResult>('copies-receive', { ...target, items: items.slice(range.start, range.end) }, options.requestId?.(range));
    out.received.push(...res.received);
    out.newTitles.push(...res.newTitles);
    out.copies += res.copies;
    out.allocated += res.allocated;
    options.onChunk?.(res, range);
  }
  return out;
}
