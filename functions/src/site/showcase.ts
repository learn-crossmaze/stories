import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { AGE_GROUPS, type AgeGroup, GENRES } from '../catalogue/model.js';
import { db } from '../core/firebase.js';

/**
 * Book shelves for the public website: what's popular, new and in demand.
 * Built from counts only (loans, copies' lifetime loans, waiting
 * reservations), never from anything about a member, and stored in
 * `public/showcase` so a page view reads one document. Rebuilt by the
 * maintenance job when older than REBUILD_AFTER_MS (and on first use).
 */
export interface ShowcaseBook {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  ageGroup: string;
  genres: string[];
  /** What the shelf is sorted by: loans this month, loans ever, members waiting (absent for new arrivals). */
  count?: number;
  /** ISO date the title joined the catalogue (new arrivals). */
  addedAt?: string;
}

export interface Showcase {
  generatedAt: string;
  /** Most borrowed in the last 30 days. */
  trending: ShowcaseBook[];
  /** Most borrowed ever (sum of every copy's loans). */
  popular: ShowcaseBook[];
  /** Newest titles in the catalogue. */
  newArrivals: ShowcaseBook[];
  /** Most members waiting in the reservation queue. */
  mostWanted: ShowcaseBook[];
  /** Most borrowed in the last 90 days, per age group. */
  byAge: Record<AgeGroup, ShowcaseBook[]>;
  /** Titles per genre, most first. */
  genres: { key: string; count: number }[];
}

const SHELF = 12;
const DAY = 86_400_000;
export const REBUILD_AFTER_MS = 6 * 3_600_000;
const showcaseRef = () => db.doc('public/showcase');

type Counts = Map<string, number>;
const add = (m: Counts, id: string | undefined, n = 1) => {
  if (id) m.set(id, (m.get(id) ?? 0) + n);
};
const top = (m: Counts, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Loans issued since `since`, per book, across every active organization (reads only bookId and issuedAt). */
async function loansSince(orgIds: string[], since: Date): Promise<{ id: string; at: number }[]> {
  const out: { id: string; at: number }[] = [];
  for (const orgId of orgIds) {
    const snap = await db.collection(`orgs/${orgId}/loans`).where('issuedAt', '>=', Timestamp.fromDate(since)).select('bookId', 'issuedAt').get();
    for (const d of snap.docs) out.push({ id: d.get('bookId') as string, at: (d.get('issuedAt') as Timestamp).toMillis() });
  }
  return out;
}

export async function buildShowcase(now = new Date()): Promise<Showcase> {
  const orgIds = (await db.collection('orgs').where('status', '==', 'ACTIVE').select().get()).docs.map((d) => d.id);

  const [loans90, copies, waiting, newest] = await Promise.all([
    loansSince(orgIds, new Date(now.getTime() - 90 * DAY)),
    Promise.all(orgIds.map((o) => db.collection(`orgs/${o}/copies`).select('bookId', 'lifetimeLoans').get())),
    Promise.all(orgIds.map((o) => db.collection(`orgs/${o}/reservations`).where('status', '==', 'WAITING').select('bookId').get())),
    db.collection('books').orderBy('createdAt', 'desc').limit(SHELF * 3).get(),
  ]);

  const month = new Map<string, number>();
  const quarter = new Map<string, number>();
  for (const l of loans90) {
    add(quarter, l.id);
    if (l.at >= now.getTime() - 30 * DAY) add(month, l.id);
  }
  const ever = new Map<string, number>();
  for (const snap of copies) for (const c of snap.docs) add(ever, c.get('bookId'), Number(c.get('lifetimeLoans') ?? 0));
  const queue = new Map<string, number>();
  for (const snap of waiting) for (const r of snap.docs) add(queue, r.get('bookId'));

  // Load every book the shelves may show (only active titles are shown).
  const wanted = new Set([...top(month, SHELF * 2), ...top(ever, SHELF * 2), ...top(queue, SHELF * 2), ...top(quarter, 200)].map(([id]) => id));
  const books = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  for (const d of newest.docs) books.set(d.id, d);
  const missing = [...wanted].filter((id) => !books.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const snaps = await db.getAll(...missing.slice(i, i + 100).map((id) => db.doc(`books/${id}`)));
    for (const s of snaps) books.set(s.id, s);
  }

  const card = (id: string, extra: Partial<ShowcaseBook> = {}): ShowcaseBook | null => {
    const b = books.get(id);
    if (!b?.exists || b.get('status') !== 'ACTIVE') return null;
    return {
      id,
      title: String(b.get('title') ?? ''),
      authors: ((b.get('authorNames') as string[] | undefined) ?? []).slice(0, 3),
      coverUrl: (b.get('coverUrl') as string | null | undefined) ?? null,
      ageGroup: String(b.get('ageGroup') ?? ''),
      genres: (b.get('genres') as string[] | undefined) ?? [],
      ...extra,
    };
  };
  const shelf = (m: Counts, filter: (b: ShowcaseBook) => boolean = () => true) =>
    top(m, m.size)
      .map(([id, count]) => card(id, { count }))
      .filter((b): b is ShowcaseBook => !!b && filter(b))
      .slice(0, SHELF);

  const genreSnaps = await Promise.all(GENRES.map((g) => db.collection('books').where('status', '==', 'ACTIVE').where('genres', 'array-contains', g).count().get()));

  return {
    generatedAt: now.toISOString(),
    trending: shelf(month),
    popular: shelf(ever),
    mostWanted: shelf(queue),
    newArrivals: newest.docs
      .map((d) => card(d.id, { addedAt: (d.get('createdAt') as Timestamp | undefined)?.toDate().toISOString() }))
      .filter((b): b is ShowcaseBook => !!b)
      .slice(0, SHELF),
    byAge: Object.fromEntries(AGE_GROUPS.map((a) => [a, shelf(quarter.size ? quarter : ever, (b) => b.ageGroup === a)])) as Record<AgeGroup, ShowcaseBook[]>,
    genres: GENRES.map((key, i) => ({ key, count: genreSnaps[i].data().count }))
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

/** Rebuilds `public/showcase` and returns it. */
export async function refreshShowcase(now = new Date()): Promise<Showcase> {
  const showcase = await buildShowcase(now);
  await showcaseRef().set(showcase);
  logger.info('site: showcase rebuilt', { trending: showcase.trending.length, popular: showcase.popular.length, newArrivals: showcase.newArrivals.length, mostWanted: showcase.mostWanted.length });
  return showcase;
}

/** The stored showcase, building it first if there is none yet. */
export async function readShowcase(): Promise<Showcase> {
  const snap = await showcaseRef().get();
  return snap.exists ? (snap.data() as Showcase) : refreshShowcase();
}

/** For the maintenance job: rebuild when the stored one is older than REBUILD_AFTER_MS. */
export async function refreshShowcaseIfStale(now = new Date()): Promise<boolean> {
  const snap = await showcaseRef().get();
  const at = snap.exists ? Date.parse(String(snap.get('generatedAt'))) : 0;
  if (now.getTime() - at < REBUILD_AFTER_MS) return false;
  await refreshShowcase(now);
  return true;
}
