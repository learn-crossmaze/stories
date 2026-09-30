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

/** The server takes 25 books per call; longer lists go in several calls. */
export const BULK_CHUNK = 25;

export async function bulkCreateBooks(items: BulkItem[], onProgress?: (done: number) => void): Promise<BulkResult> {
  const out: BulkResult = { created: [], skipped: [] };
  for (let i = 0; i < items.length; i += BULK_CHUNK) {
    const res = await command<BulkResult>('books-bulkCreate', { items: items.slice(i, i + BULK_CHUNK) });
    out.created.push(...res.created);
    out.skipped.push(...res.skipped);
    onProgress?.(Math.min(items.length, i + BULK_CHUNK));
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

/** Receives a delivery at a branch (functions/src/inventory/receive.ts): new titles and every copy. */
export async function receiveStock(
  target: { orgId: string; branchId: string; locationId: string | null; condition: string },
  items: ReceiveItem[],
  onProgress?: (done: number) => void,
): Promise<ReceiveResult> {
  const out: ReceiveResult = { received: [], newTitles: [], copies: 0, allocated: 0 };
  let chunk: ReceiveItem[] = [];
  let done = 0;
  const send = async () => {
    if (!chunk.length) return;
    const res = await command<ReceiveResult>('copies-receive', { ...target, items: chunk });
    out.received.push(...res.received);
    out.newTitles.push(...res.newTitles);
    out.copies += res.copies;
    out.allocated += res.allocated;
    done += chunk.length;
    onProgress?.(done);
    chunk = [];
  };
  for (const item of items) {
    const copies = chunk.reduce((n, i) => n + i.quantity, 0);
    if (chunk.length === RECEIVE_TITLES || copies + item.quantity > RECEIVE_COPIES) await send();
    chunk.push(item);
  }
  await send();
  return out;
}
