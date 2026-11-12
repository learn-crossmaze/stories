// Shared catalogue: titles, reference data, book numbering.
import { collection, doc, type DocumentSnapshot, getCountFromServer, getDoc, getDocs, limit, orderBy, query, type QueryConstraint, Timestamp, where } from 'firebase/firestore';

import { oneOf, remember } from '../shared/remember';
import { importCover } from './bulkBooks';
import { AGE_GROUPS, AgeGroup, db, Genre, GENRES, LANGUAGES, page, queryToken, READING_LEVELS, withId } from './common';

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
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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

/** Catalogue search: one token (prefix) + optional age group, ordered by title. */
export function searchBooks(q: string, ageGroup: AgeGroup | '', after?: DocumentSnapshot, status: Book['status'] | '' = '') {
  const token = queryToken(q);
  const c: QueryConstraint[] = [];
  if (status) c.push(where('status', '==', status));
  if (token) c.push(where('searchTokens', 'array-contains', token));
  if (ageGroup) c.push(where('ageGroup', '==', ageGroup));
  c.push(orderBy('titleNormalized'));
  return page<Book>('books', c, BOOK_PAGE, after);
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
