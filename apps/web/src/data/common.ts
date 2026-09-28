// Shared vocabularies (mirrored from the server) and Firestore helpers for the data modules.
import { collection, type DocumentSnapshot, getDocs, limit, query, type QueryConstraint, startAfter, Timestamp, where } from 'firebase/firestore';

import { services } from './services';

// Vocabularies mirrored from functions/src/catalogue/model.ts and copyState.ts.
export const GENRES = ['FICTION', 'FANTASY', 'MYSTERY', 'ADVENTURE', 'SCIENCE', 'BIOGRAPHY', 'SELF_HELP', 'CLASSICS', 'COMICS', 'EDUCATIONAL'] as const;
export const AGE_GROUPS = ['CHILDREN', 'TEENS', 'ADULTS'] as const;
export const READING_LEVELS = ['EARLY_READER', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export const LANGUAGES = {
  en: 'English',
  hi: 'Hindi',
  kn: 'Kannada',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  ur: 'Urdu',
  or: 'Odia',
} as const;
export const COPY_STATUSES = ['AVAILABLE', 'RESERVED', 'ISSUED', 'IN_TRANSIT', 'UNDER_INSPECTION', 'DAMAGED', 'LOST', 'RETIRED'] as const;
export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export const DURATIONS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 } as const;

export type Genre = (typeof GENRES)[number];
export type AgeGroup = (typeof AGE_GROUPS)[number];
export type CopyStatus = (typeof COPY_STATUSES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Duration = keyof typeof DURATIONS;
export type Scope = string[] | 'ALL';

export const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

export const db = () => services().db;
export const withId = <T>(s: DocumentSnapshot) => ({ id: s.id, ...s.data() }) as T;
export const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

/** Branch-scoped staff must filter on the branch field the rules check. */
export const scoped = (field: string, scope: Scope): QueryConstraint[] => (scope === 'ALL' ? [] : [where(field, 'in', scope.slice(0, 10))]);

/** Same normalization as the server's search tokens (functions/src/catalogue/search.ts). */
export function queryToken(q: string): string | null {
  const words = q
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length >= 2);
  if (!words.length) return null;
  return words.sort((a, b) => b.length - a.length)[0].slice(0, 12);
}

export interface Page<T> {
  items: T[];
  cursor?: DocumentSnapshot;
}

export async function page<T>(base: string, constraints: QueryConstraint[], size: number, after?: DocumentSnapshot): Promise<Page<T>> {
  const q = query(collection(db(), base), ...constraints, limit(size), ...(after ? [startAfter(after)] : []));
  const snap = await getDocs(q);
  return { items: snap.docs.map((d) => withId<T>(d)), cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1] : undefined };
}
