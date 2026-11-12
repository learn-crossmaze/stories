import { z } from 'zod';

import { query } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import { normalizeIsbn } from './isbn.js';
import { type AgeGroup, LANGUAGES, type Genre } from './model.js';

/**
 * Book details from public catalogues, to prefill the "New book" form.
 * Google Books (better for Indian editions; needs GOOGLE_BOOKS_API_KEY in
 * production — anonymous quota is shared and usually exhausted) and Open
 * Library (no key) are searched together; either may be down. A caller that
 * only wants one ISBN (`exact`, the Receive books page) is answered as soon as
 * Google Books has that very ISBN, without waiting for Open Library.
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
  /** A guess from the subject headings (see guessAgeGroup); null when they don't say who the book is for. */
  ageGroup: AgeGroup | null;
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

// Audience headings only ("Juvenile Fiction", "Young Adult Fiction", "Children's stories", "Picture books"), never a
// bare "children" or "teen": subjects such as "Missing children" or "Juvenile delinquency" are about them, not for them.
const TEEN_HEADINGS = /\byoung adult\b|\bteen(age)? (fiction|literature)\b/i;
const CHILD_HEADINGS = /\bjuvenile\b(?! (delinquen|justice|court|offender|detention|crime))|\bchildren['’]?s (fiction|stories|literature|books|poetry)\b|\bpicture books?\b/i;

/**
 * Best-guess age group from subject headings, or null (the form then keeps its own choice). A guess only ever moves
 * a title to a younger shelf than the Adults default, and child members see titles by age group, so it is kept to
 * headings that name the audience, and the older group wins when both are named. Staff confirm it in the form.
 */
export function guessAgeGroup(subjects: string[]): AgeGroup | null {
  const text = subjects.join(' | ');
  return TEEN_HEADINGS.test(text) ? 'TEENS' : CHILD_HEADINGS.test(text) ? 'CHILDREN' : null;
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

/** `stop` lets the caller give up on the request before the timeout does. */
async function getJson(url: string, stop?: AbortSignal): Promise<unknown> {
  const signal = stop ? AbortSignal.any([stop, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'Stories library (storiesforall.in)' } });
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
      ageGroup: guessAgeGroup(subjects),
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
      ageGroup: guessAgeGroup(subjects),
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

/**
 * Whether Google's answer is enough on its own for a caller that wants exactly this ISBN. merge() puts Google first and
 * keeps one result per ISBN, so when Google has the ISBN, Open Library's answer could not change which record is used.
 * Never the other way round: Open Library's ISBN is the first of the whole work's, often not the one asked for.
 */
export const answersExactly = (google: Candidate[], isbn: string | null): boolean => !!isbn && google.some((c) => c.isbn === isbn);

type Outcome = { ok: true; value: Candidate[] } | { ok: false; reason: unknown };
/** Never rejects: a source that is given up on (or times out later) must not become an unhandled rejection. */
const settle = (p: Promise<Candidate[]>): Promise<Outcome> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (reason: unknown) => ({ ok: false as const, reason }),
  );

/**
 * Searches public catalogues by title (optionally "title author") or ISBN. `exact: true` with an ISBN means "I only
 * need this ISBN": the answer goes out as soon as Google Books has it, and Open Library is then not waited for
 * (`sources` reports it as skipped). In every other case both are waited for, as before.
 */
export const lookup = query(
  'books-lookup',
  z.strictObject({ q: z.string().trim().min(2).max(200), exact: z.boolean().optional() }),
  async ({ actor, input }) => {
    // Before anything goes out to the public services.
    await actor.requireCatalog('books.create');
    const isbn = normalizeIsbn(input.q);
    const giveUp = new AbortController();
    const google = settle(getJson(googleUrl(input.q, isbn)).then(fromGoogle));
    const openLibrary = settle(getJson(openLibraryUrl(input.q, isbn), giveUp.signal).then(fromOpenLibrary));
    const first = await google;
    const skip = !!input.exact && first.ok && answersExactly(first.value, isbn);
    if (skip) giveUp.abort();
    const second = skip ? null : await openLibrary;
    const ok = [first, second].flatMap((s) => (s?.ok ? [s.value] : []));
    if (!ok.length) {
      console.warn('books-lookup: all sources failed', [first, second].map((s) => (s && !s.ok ? String(s.reason) : 'ok')));
      throw errors.conflict('LOOKUP_UNAVAILABLE', "Book search isn't available right now. Fill in the details by hand, or try again later.");
    }
    const candidates = merge(ok);
    const known = await Promise.all(candidates.map((c) => (c.isbn ? db.doc(`isbnIndex/${c.isbn}`).get() : null)));
    return {
      candidates: candidates.map((c, i) => ({ ...c, existingBookId: known[i]?.exists ? (known[i]!.get('bookId') as string) : null })),
      sources: [
        { source: 'Google Books', ok: first.ok },
        second ? { source: 'Open Library', ok: second.ok } : { source: 'Open Library', ok: null, skipped: true },
      ],
    };
  },
);
