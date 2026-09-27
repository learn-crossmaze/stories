import { z } from 'zod';

import { query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { normalizeIsbn } from './isbn.js';
import { LANGUAGES, type Genre } from './model.js';

/**
 * Book details from public catalogues, to prefill the "New book" form.
 * Google Books (better for Indian editions; needs GOOGLE_BOOKS_API_KEY in
 * production — anonymous quota is shared and usually exhausted) and Open
 * Library (no key) are searched together; either may be down.
 */
export interface Candidate {
  source: 'Google Books' | 'Open Library';
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  language: (typeof LANGUAGES)[number] | null;
  synopsis: string;
  genres: Genre[];
  subjects: string[];
  coverUrl: string | null;
  /** Set when a title with this ISBN is already in the catalogue. */
  existingBookId?: string | null;
}

const TIMEOUT_MS = 6000;
const LANGS = new Set<string>(LANGUAGES);
// ISO 639-2 (Open Library) → 639-1 for the languages the catalogue supports.
const ISO3: Record<string, string> = { eng: 'en', hin: 'hi', kan: 'kn', tam: 'ta', tel: 'te', mal: 'ml', mar: 'mr', ben: 'bn', guj: 'gu', pan: 'pa', urd: 'ur', ori: 'or' };

const GENRE_WORDS: [Genre, RegExp][] = [
  ['FANTASY', /fantasy|magic|wizard|dragon/i],
  ['MYSTERY', /myster|detective|crime|thriller|suspense/i],
  ['ADVENTURE', /adventure|pirate|treasure|voyage|exploration/i],
  ['SCIENCE', /science|physics|chemistry|biology|astronomy|mathemat|technology|computer/i],
  ['BIOGRAPHY', /biograph|autobiograph|memoir/i],
  ['SELF_HELP', /self-help|self help|personal development|motivation|success/i],
  ['CLASSICS', /classic/i],
  ['COMICS', /comic|graphic novel|manga/i],
  ['EDUCATIONAL', /education|textbook|study|juvenile nonfiction|reference/i],
  ['FICTION', /fiction|novel|stories/i],
];

/** Best-guess genres (at most 3) from subject headings; staff confirm them in the form. */
export function guessGenres(subjects: string[]): Genre[] {
  const text = subjects.join(' | ');
  return GENRE_WORDS.filter(([, re]) => re.test(text)).map(([g]) => g).slice(0, 3);
}

const clean = (s: unknown, max: number) =>
  typeof s === 'string'
    ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
const yearOf = (s: unknown) => {
  const m = typeof s === 'string' ? /\b(1[4-9]\d\d|20\d\d)\b/.exec(s) : null;
  const y = m ? Number(m[1]) : null;
  return y && y <= new Date().getFullYear() + 1 ? y : null;
};
const https = (u: unknown) => (typeof u === 'string' && u ? u.replace(/^http:\/\//, 'https://') : null);

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Stories library (stories-by-crossmaze.web.app)' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; description?: string;
    industryIdentifiers?: { type: string; identifier: string }[]; categories?: string[]; language?: string; imageLinks?: Record<string, string>;
  };
}

export function fromGoogle(body: unknown): Candidate[] {
  const items = ((body as { items?: GoogleVolume[] })?.items ?? []).slice(0, 10);
  return items.flatMap(({ volumeInfo: v }) => {
    if (!v?.title) return [];
    const ids = v.industryIdentifiers ?? [];
    const isbn = normalizeIsbn(ids.find((i) => i.type === 'ISBN_13')?.identifier ?? ids.find((i) => i.type === 'ISBN_10')?.identifier ?? '');
    const subjects = (v.categories ?? []).map((c) => clean(c, 80)).filter(Boolean);
    const img = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail;
    return [{
      source: 'Google Books' as const,
      title: clean(v.title, 200),
      subtitle: clean(v.subtitle, 200),
      authors: (v.authors ?? []).map((a) => clean(a, 100)).filter(Boolean).slice(0, 5),
      publisher: clean(v.publisher, 100) || null,
      year: yearOf(v.publishedDate),
      isbn,
      language: v.language && LANGS.has(v.language) ? (v.language as Candidate['language']) : null,
      synopsis: clean(v.description, 2000),
      genres: guessGenres(subjects),
      subjects: subjects.slice(0, 8),
      // zoom=0 without the page curl is the largest image Google serves publicly.
      coverUrl: https(img?.replace('&edge=curl', '').replace(/zoom=\d/, 'zoom=0')),
    }];
  });
}

interface OpenLibraryDoc {
  title?: string; subtitle?: string; author_name?: string[]; publisher?: string[]; first_publish_year?: number;
  isbn?: string[]; language?: string[]; subject?: string[]; cover_i?: number; first_sentence?: string[];
}

export function fromOpenLibrary(body: unknown): Candidate[] {
  const docs = ((body as { docs?: OpenLibraryDoc[] })?.docs ?? []).slice(0, 10);
  return docs.flatMap((d) => {
    if (!d.title) return [];
    const isbns = (d.isbn ?? []).map((i) => normalizeIsbn(i)).filter((i): i is string => !!i);
    const lang = (d.language ?? []).map((l) => ISO3[l]).find(Boolean) ?? null;
    const subjects = (d.subject ?? []).map((s) => clean(s, 80)).filter(Boolean);
    return [{
      source: 'Open Library' as const,
      title: clean(d.title, 200),
      subtitle: clean(d.subtitle, 200),
      authors: (d.author_name ?? []).map((a) => clean(a, 100)).filter(Boolean).slice(0, 5),
      publisher: clean(d.publisher?.[0], 100) || null,
      year: typeof d.first_publish_year === 'number' ? d.first_publish_year : null,
      isbn: isbns.find((i) => i.startsWith('978') || i.startsWith('979')) ?? isbns[0] ?? null,
      language: lang as Candidate['language'],
      synopsis: clean(d.first_sentence?.[0], 2000),
      genres: guessGenres(subjects),
      subjects: subjects.slice(0, 8),
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    }];
  });
}

function googleUrl(q: string, isbn: string | null) {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const terms = isbn ? `isbn:${isbn}` : q;
  return `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms)}&maxResults=8&printType=books${key ? `&key=${encodeURIComponent(key)}` : ''}`;
}

function openLibraryUrl(q: string, isbn: string | null) {
  const fields = 'title,subtitle,author_name,publisher,first_publish_year,isbn,language,subject,cover_i,first_sentence';
  return `https://openlibrary.org/search.json?${isbn ? `isbn=${isbn}` : `q=${encodeURIComponent(q)}`}&limit=8&fields=${fields}`;
}

/** Merges results, one per ISBN (Google first: richer descriptions), keeping order. */
export function merge(lists: Candidate[][]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of lists.flat()) {
    const key = c.isbn ?? `${c.title.toLowerCase()}|${c.authors[0]?.toLowerCase() ?? ''}|${c.year ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 10);
}

/** Searches public catalogues by title (optionally "title author") or ISBN. */
export const lookup = query('books-lookup', z.strictObject({ q: z.string().trim().min(2).max(200) }), async ({ actor, input }) => {
  await db.runTransaction((tx) => actor.requireCatalog('books.create', tx));
  const isbn = normalizeIsbn(input.q);
  const settled = await Promise.allSettled([
    getJson(googleUrl(input.q, isbn)).then(fromGoogle),
    getJson(openLibraryUrl(input.q, isbn)).then(fromOpenLibrary),
  ]);
  const ok = settled.filter((s): s is PromiseFulfilledResult<Candidate[]> => s.status === 'fulfilled');
  if (!ok.length) {
    console.warn('books-lookup: all sources failed', settled.map((s) => (s.status === 'rejected' ? String(s.reason) : 'ok')));
    throw errors.conflict('LOOKUP_UNAVAILABLE', "Book search isn't available right now. Fill in the details by hand, or try again later.");
  }
  const candidates = merge(ok.map((s) => s.value));
  const known = await Promise.all(candidates.map((c) => (c.isbn ? db.doc(`isbnIndex/${c.isbn}`).get() : null)));
  return {
    candidates: candidates.map((c, i) => ({ ...c, existingBookId: known[i]?.exists ? (known[i]!.get('bookId') as string) : null })),
    sources: settled.map((s, i) => ({ source: i === 0 ? 'Google Books' : 'Open Library', ok: s.status === 'fulfilled' })),
  };
});
