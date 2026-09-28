// Shared catalogue: titles, reference data, book numbering.
import { collection, doc, type DocumentSnapshot, getDoc, getDocs, limit, orderBy, query, type QueryConstraint, where } from 'firebase/firestore';

import { AgeGroup, db, Genre, LANGUAGES, page, queryToken, READING_LEVELS, withId } from './common';

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
