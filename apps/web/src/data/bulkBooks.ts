// "Add by ISBN": look each ISBN up in public catalogues, then add the good ones in one go (functions/src/catalogue/books.ts bulkCreate).
import type { Candidate } from '../admin/catalogue/BookLookup';
import { callAction, command, toApiError } from './api';
import type { AgeGroup, Genre, READING_LEVELS } from './common';
import { services } from './services';

/** The public-catalogue match for an ISBN (the edition with that ISBN when there is one), or null. */
export async function lookupIsbn(isbn: string): Promise<Candidate | null> {
  try {
    const res = await callAction<{ candidates: Candidate[] }>(services().fns, 'books-lookup', { q: isbn });
    return res.candidates.find((c) => c.isbn === isbn) ?? res.candidates[0] ?? null;
  } catch (e) {
    throw toApiError(e);
  }
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
