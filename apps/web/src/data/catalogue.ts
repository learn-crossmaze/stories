// Shared catalogue: titles, reference data, book numbering.
import { collection, doc, type DocumentSnapshot, getCountFromServer, getDoc, getDocs, limit, orderBy, query, type QueryConstraint, Timestamp, where } from 'firebase/firestore';

import { normalizeIsbn } from '../shared/isbn';
import { oneOf, remember } from '../shared/remember';
import { importCover } from './bulkBooks';
import { AGE_GROUPS, AgeGroup, db, Genre, GENRES, LANGUAGES, matchesAll, normalizeText, type Page, page, primaryWord, queryWords, READING_LEVELS, withId } from './common';

export interface RefItem {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Book {
  id: string;
  code: string;
  isbn: string | null;
  title: string;
  subtitle: string;
  authorIds: string[];
  authorNames: string[];
  publisherId: string | null;
  publisherName: string | null;
  categoryIds: string[];
  categoryNames: string[];
  language: keyof typeof LANGUAGES;
  genres: Genre[];
  ageGroup: AgeGroup;
  minAge: number | null;
  readingLevel: (typeof READING_LEVELS)[number];
  contentTags: string[];
  synopsis: string;
  edition: string;
  publicationYear: number | null;
  keywords: string[];
  replacementPriceMinor: number;
  status: 'ACTIVE' | 'ARCHIVED';
  coverUrl?: string | null;
  /** The title as the list is ordered by it (written by the server). */
  titleNormalized?: string;
  /** What search matches: the words of the title, subtitle, authors, ISBN, code and keywords, and the starts of each (written by the server). */
  searchTokens?: string[];
}

export async function listRefs(kind: 'authors' | 'publishers' | 'categories'): Promise<RefItem[]> {
  const snap = await getDocs(query(collection(db(), kind), orderBy('nameNormalized'), limit(500)));
  return snap.docs.map((d) => withId<RefItem>(d));
}

/**
 * A name as the server compares authors and publishers (normalizeText in functions/src/catalogue/search.ts):
 * case, accents, spacing and punctuation don't count, so "García" is "Garcia". Empty for a name of punctuation only.
 */
export function normalizeName(s: string): string {
  return normalizeText(s);
}

/** What a new title starts as until someone says otherwise. */
export interface NewTitleDefaults {
  ageGroup: AgeGroup;
  readingLevel: (typeof READING_LEVELS)[number];
  genre: Genre;
}
const NEW_TITLE: NewTitleDefaults = { ageGroup: 'ADULTS', readingLevel: 'INTERMEDIATE', genre: 'FICTION' };
const newTitleKey = remember.key('newTitles');
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The age group, reading level and genre last chosen for new titles in this browser (one stored record, each
 * value checked against its list). The New book form starts from the first two only: its genres stay empty so
 * that someone chooses them. Call `set` from the select's change handler, never from an effect.
 */
export const newTitleDefaults = {
  get(): NewTitleDefaults {
    const v = remember.get(newTitleKey, {}, isRecord);
    return {
      ageGroup: oneOf(AGE_GROUPS)(v.ageGroup) ? v.ageGroup : NEW_TITLE.ageGroup,
      readingLevel: oneOf(READING_LEVELS)(v.readingLevel) ? v.readingLevel : NEW_TITLE.readingLevel,
      genre: oneOf(GENRES)(v.genre) ? v.genre : NEW_TITLE.genre,
    };
  },
  set(patch: Partial<NewTitleDefaults>): void {
    remember.set(newTitleKey, { ...newTitleDefaults.get(), ...patch });
  },
};

const coverImports = new Map<string, Promise<boolean>>();

/**
 * Imports a looked-up cover without making anyone wait for it (a failed download just leaves the title without
 * one). While it runs, `coverImportOf` hands the same promise to a page that shows the title, so the cover can
 * appear there when it lands.
 */
export function importCoverInBackground(bookId: string, imageUrl: string): Promise<boolean> {
  const done = importCover(bookId, imageUrl).finally(() => coverImports.delete(bookId));
  coverImports.set(bookId, done);
  return done;
}

/** The cover import still running for a title, if any (resolves to whether a cover was added). */
export const coverImportOf = (bookId: string): Promise<boolean> | undefined => coverImports.get(bookId);

export const BOOK_PAGE = 25;

/** How many pages one search reads while narrowing by further words; twice as many while nothing has matched yet. */
const SCAN_PAGES = 4;
const SCAN_PAGES_EMPTY = 8;

/** The title with this ISBN-13, if we have it (one exact read; ISBNs are unique). */
export async function bookByIsbn(isbn13: string): Promise<Book | null> {
  // No ordering and no other filter: this is served by the automatic index on `isbn`.
  const snap = await getDocs(query(collection(db(), 'books'), where('isbn', '==', isbn13), limit(1)));
  return snap.empty ? null : withId<Book>(snap.docs[0]);
}

/**
 * Catalogue search, a page at a time, ordered by title: every typed word must match (as a word or the start of
 * one), optionally within an age group and a status. An ISBN in any form (ISBN-10, hyphens, spaces) finds its
 * title with one exact read.
 *
 * The database is asked for one word (`primaryWord`); the other words are checked against each title's own
 * `searchTokens`. A search of several words therefore reads on, page after page, until it has a page of matches
 * or has read `SCAN_PAGES` pages, and returns every match it met: fewer or more than `BOOK_PAGE`, even none
 * with a `cursor` when there is more to look through. The cursor is the last title read, not the last one
 * returned.
 */
export async function searchBooks(q: string, ageGroup: AgeGroup | '', after?: DocumentSnapshot, status: Book['status'] | '' = ''): Promise<Page<Book>> {
  if (!after) {
    const isbn = normalizeIsbn(q);
    const hit = isbn ? await bookByIsbn(isbn) : null;
    if (hit && (!status || hit.status === status) && (!ageGroup || hit.ageGroup === ageGroup)) return { items: [hit] };
    // Not an ISBN of ours (ten digits can be something else): search by its words as usual.
  }
  const words = queryWords(q);
  const primary = primaryWord(words);
  const c: QueryConstraint[] = [];
  if (status) c.push(where('status', '==', status));
  if (primary) c.push(where('searchTokens', 'array-contains', primary));
  if (ageGroup) c.push(where('ageGroup', '==', ageGroup));
  c.push(orderBy('titleNormalized'));
  const others = words.filter((w) => w !== primary);
  if (!others.length) return page<Book>('books', c, BOOK_PAGE, after);

  const items: Book[] = [];
  let cursor = after;
  for (let read = 1; ; read++) {
    const next = await page<Book>('books', c, BOOK_PAGE, cursor);
    items.push(...next.items.filter((b) => matchesAll(b.searchTokens, others)));
    cursor = next.cursor;
    if (!cursor || items.length >= BOOK_PAGE || read >= (items.length ? SCAN_PAGES : SCAN_PAGES_EMPTY)) break;
  }
  return { items, cursor };
}

/**
 * The best few titles for a search box that has no "Load more" (pickers, the find box): what `searchBooks`
 * finds first, with the titles that start with the typed text ahead of the others, each group by title.
 */
export async function findBooks(q: string, max: number, status: Book['status'] | '' = ''): Promise<Book[]> {
  const typed = normalizeText(q);
  const startsWithTyped = (b: Book) => Number((b.titleNormalized ?? normalizeText(b.title)).startsWith(typed));
  const { items } = await searchBooks(q, '', undefined, status);
  // The sort keeps the order of equals, so each group stays alphabetical.
  return [...items].sort((a, b) => startsWithTyped(b) - startsWithTyped(a)).slice(0, max);
}

export async function getBook(id: string): Promise<Book | null> {
  const s = await getDoc(doc(db(), `books/${id}`));
  return s.exists() ? withId<Book>(s) : null;
}

export async function getBookNumbering(): Promise<string | null> {
  const s = await getDoc(doc(db(), 'config/numbering'));
  return (s.get('book') as string | null | undefined) ?? null;
}

/** Titles in the shared catalogue, and how many were added this month (count queries). */
export async function catalogueCounts(month: string): Promise<{ titles: number; addedThisMonth: number }> {
  const books = collection(db(), 'books');
  const start = Timestamp.fromDate(new Date(`${month}-01T00:00:00+05:30`));
  const [titles, addedThisMonth] = await Promise.all([
    getCountFromServer(query(books, where('status', '==', 'ACTIVE'))),
    getCountFromServer(query(books, where('createdAt', '>=', start))),
  ]);
  return { titles: titles.data().count, addedThisMonth: addedThisMonth.data().count };
}
