import type { DocumentSnapshot } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Title search: which questions are put to the database, how further words narrow what comes back, where a
// search of several words stops reading, and how an ISBN in any form finds its title.
type Constraint =
  | { kind: 'where'; field: string; op: string; value: unknown }
  | { kind: 'orderBy'; field: string }
  | { kind: 'limit'; n: number }
  | { kind: 'startAfter'; snap: { id: string } };
interface Stored {
  id: string;
  title: string;
  titleNormalized: string;
  isbn: string | null;
  status: string;
  ageGroup: string;
  searchTokens?: string[];
}

const world = vi.hoisted(() => ({ asked: [] as unknown[], books: [] as unknown[] }));
const asked = world.asked as Constraint[][];

vi.mock('../data/services', () => ({ services: () => ({ db: {} }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: () => ({}),
  query: (_collection: unknown, ...constraints: unknown[]) => constraints,
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string) => ({ kind: 'orderBy', field }),
  limit: (n: number) => ({ kind: 'limit', n }),
  startAfter: (snap: unknown) => ({ kind: 'startAfter', snap }),
  // A small stand-in for the database: equality and "holds this word" filters, ordering, paging.
  getDocs: async (constraints: Constraint[]) => {
    world.asked.push(constraints);
    let rows = world.books as Stored[];
    for (const c of constraints) {
      if (c.kind !== 'where') continue;
      rows = rows.filter((b) => {
        const value = (b as unknown as Record<string, unknown>)[c.field];
        return c.op === 'array-contains' ? Array.isArray(value) && value.includes(c.value) : value === c.value;
      });
    }
    if (constraints.some((c) => c.kind === 'orderBy')) rows = [...rows].sort((a, b) => a.titleNormalized.localeCompare(b.titleNormalized));
    const after = constraints.find((c) => c.kind === 'startAfter');
    if (after?.kind === 'startAfter') rows = rows.slice(rows.findIndex((b) => b.id === after.snap.id) + 1);
    const max = constraints.find((c) => c.kind === 'limit');
    if (max?.kind === 'limit') rows = rows.slice(0, max.n);
    const docs = rows.map((b) => ({ id: b.id, data: () => b }));
    return { docs, empty: !docs.length };
  },
}));

const { BOOK_PAGE, findBooks, searchBooks } = await import('../data/catalogue');

/** The words the server stores for a title (functions/src/catalogue/search.ts): each word and its starts, 2 to 12 long. */
function tokens(...fields: string[]) {
  const out = new Set<string>();
  for (const field of fields) {
    for (const word of field.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')) {
      if (word.length < 2) continue;
      out.add(word);
      for (let n = 2; n < Math.min(word.length, 13); n++) out.add(word.slice(0, n));
    }
  }
  return [...out];
}
const book = (id: string, title: string, more: Partial<Stored> = {}): Stored => ({
  id, title, titleNormalized: title.toLowerCase(), isbn: null, status: 'ACTIVE', ageGroup: 'CHILDREN', searchTokens: tokens(title, more.isbn ?? ''), ...more,
});
const pad = (n: number) => String(n).padStart(3, '0');
/** The word the database was asked for in a question, and the id it was asked to start after. */
const word = (c: Constraint[]) => c.flatMap((x) => (x.kind === 'where' && x.op === 'array-contains' ? [x.value] : []))[0];
const startedAfter = (c: Constraint[]) => c.flatMap((x) => (x.kind === 'startAfter' ? [x.snap.id] : []))[0];
const ids = (items: { id: string }[]) => items.map((b) => b.id);

beforeEach(() => {
  world.asked.length = 0;
  world.books = [];
});

describe('title search: one word', () => {
  it('asks once, for that word, a page at a time, ordered by title', async () => {
    world.books = Array.from({ length: 30 }, (_, n) => book(`s${pad(n)}`, `Secret ${pad(n)}`));
    const first = await searchBooks('secret', '');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual([{ kind: 'where', field: 'searchTokens', op: 'array-contains', value: 'secret' }, { kind: 'orderBy', field: 'titleNormalized' }, { kind: 'limit', n: BOOK_PAGE }]);
    expect(first.items).toHaveLength(25);
    expect(first.cursor?.id).toBe('s024');

    const second = await searchBooks('secret', '', first.cursor);
    expect(asked).toHaveLength(2);
    expect(ids(second.items)).toEqual(['s025', 's026', 's027', 's028', 's029']);
    expect(second.cursor).toBeUndefined();
  });

  it('keeps the status and age group filters in the question', async () => {
    world.books = [book('a', 'Secret Garden'), book('b', 'Secret Island', { status: 'ARCHIVED' }), book('c', 'Secret River', { ageGroup: 'TEENS' })];
    expect(ids((await searchBooks('secret', 'CHILDREN', undefined, 'ACTIVE')).items)).toEqual(['a']);
    expect(asked[0]).toContainEqual({ kind: 'where', field: 'status', op: '==', value: 'ACTIVE' });
    expect(asked[0]).toContainEqual({ kind: 'where', field: 'ageGroup', op: '==', value: 'CHILDREN' });
  });

  it('lists everything, by title, when nothing is typed', async () => {
    world.books = [book('b', 'Bambi'), book('a', 'Aladdin')];
    expect(ids((await searchBooks('', '')).items)).toEqual(['a', 'b']);
    expect(word(asked[0])).toBeUndefined();
  });
});

describe('title search: several words', () => {
  it('narrows by every word, asking the database for one of them only', async () => {
    world.books = [book('a', 'The Secret Garden'), book('b', 'Secret Seven'), book('c', 'Secret Seven Adventure'), book('d', 'Seven Dwarfs')];
    const found = await searchBooks('secret sev', '');
    expect(ids(found.items)).toEqual(['b', 'c']);
    expect(found.cursor).toBeUndefined();
    expect(asked.map(word)).toEqual(['secret']);
  });

  it('asks for a telling word, not "the"', async () => {
    world.books = [book('a', 'The Cat in the Hat'), book('b', 'The Cat Who Came In'), book('c', 'Cat Tales')];
    expect(ids((await searchBooks('The Cat in the Hat', '')).items)).toEqual(['a']);
    expect(asked.map(word)).toEqual(['cat']);
  });

  it('counts a title without stored words as no match', async () => {
    world.books = [book('a', 'Secret Seven'), { ...book('b', 'Secret Seven Again'), searchTokens: ['secret'] }];
    // What an old record may look like once read: the field is simply not there.
    const bare = book('c', 'Secret Seven Bare');
    delete bare.searchTokens;
    world.books = [...world.books, bare];
    // The database can only return records holding the word, so "c" never comes back; "b" lacks the second word.
    expect(ids((await searchBooks('secret seven', '')).items)).toEqual(['a']);
  });

  it('reads on until it has a page of matches, and returns every match it met', async () => {
    // 100 titles hold "secret"; the first 24 and every one from the 26th also hold "seven".
    world.books = Array.from({ length: 100 }, (_, n) => book(`s${pad(n)}`, n === 24 ? `Secret ${pad(n)}` : `Secret ${pad(n)} Seven`));
    const first = await searchBooks('secret seven', '');
    // Page one gave 24, one short of a page: page two is read and all of it is kept (49, not cut to 25).
    expect(asked).toHaveLength(2);
    expect(first.items).toHaveLength(49);
    expect(ids(first.items)).not.toContain('s024');
    // The cursor is the last title read, so the next page starts right after it and nothing is skipped.
    expect(first.cursor?.id).toBe('s049');

    const second = await searchBooks('secret seven', '', first.cursor);
    expect(startedAfter(asked[2])).toBe('s049');
    expect(second.items[0].id).toBe('s050');
    expect(second.items).toHaveLength(25);
  });

  it('stops after four pages once something matched, leaving the rest for "Load more"', async () => {
    world.books = Array.from({ length: 200 }, (_, n) => book(`s${pad(n)}`, n === 3 || n === 150 ? `Secret ${pad(n)} Seven` : `Secret ${pad(n)}`));
    const first = await searchBooks('secret seven', '');
    expect(asked).toHaveLength(4);
    expect(ids(first.items)).toEqual(['s003']);
    expect(first.cursor?.id).toBe('s099');

    const second = await searchBooks('secret seven', '', first.cursor as DocumentSnapshot);
    expect(ids(second.items)).toEqual(['s150']);
    // 100 more titles are four full pages: a full last page keeps its cursor, as everywhere.
    expect(asked).toHaveLength(8);
    expect(second.cursor?.id).toBe('s199');
  });

  it('reads up to eight pages while nothing has matched, then says there is more', async () => {
    world.books = Array.from({ length: 260 }, (_, n) => book(`s${pad(n)}`, n === 230 ? `Secret ${pad(n)} Seven` : `Secret ${pad(n)}`));
    const first = await searchBooks('secret seven', '');
    expect(asked).toHaveLength(8);
    expect(first.items).toEqual([]);
    // Nothing yet, but not the end: the page shows "Keep looking" instead of "No books match".
    expect(first.cursor?.id).toBe('s199');

    const second = await searchBooks('secret seven', '', first.cursor as DocumentSnapshot);
    expect(ids(second.items)).toEqual(['s230']);
    expect(second.cursor).toBeUndefined();
  });

  it('ends without a cursor when the last page was read', async () => {
    world.books = Array.from({ length: 40 }, (_, n) => book(`s${pad(n)}`, `Secret ${pad(n)}`));
    const found = await searchBooks('secret seven', '');
    expect(asked).toHaveLength(2);
    expect(found).toEqual({ items: [], cursor: undefined });
  });
});

describe('title search: ISBN', () => {
  const isbn13 = '9780306406157';
  const ours = () => book('x', 'Signals and Noise', { isbn: isbn13 });

  it.each(['0306406152', '0-306-40615-2', '978-0-306-40615-7', '978 0306406157', isbn13])('finds the title for %s with one exact read', async (typed) => {
    world.books = [ours(), book('y', 'Something Else')];
    const found = await searchBooks(typed, '');
    expect(ids(found.items)).toEqual(['x']);
    expect(found.cursor).toBeUndefined();
    // Equality on isbn alone (no ordering, no other filter), so no extra index is needed.
    expect(asked).toEqual([[{ kind: 'where', field: 'isbn', op: '==', value: isbn13 }, { kind: 'limit', n: 1 }]]);
  });

  it('applies status and age group to the title it found', async () => {
    world.books = [book('x', 'Signals and Noise', { isbn: isbn13, status: 'ARCHIVED', ageGroup: 'ADULTS' })];
    // A member's search (active titles for their age group) must not show it.
    expect((await searchBooks('0306406152', 'CHILDREN', undefined, 'ACTIVE')).items).toEqual([]);
    expect((await searchBooks('0306406152', '', undefined, 'ACTIVE')).items).toEqual([]);
    expect((await searchBooks('0306406152', 'TEENS')).items).toEqual([]);
    expect(ids((await searchBooks('0306406152', 'ADULTS', undefined, 'ARCHIVED')).items)).toEqual(['x']);
  });

  it('falls back to the words when we have no title with that ISBN', async () => {
    // Ten digits that pass the ISBN check, but here they are part of a title's code.
    world.books = [{ ...book('c', 'Coded'), searchTokens: tokens('coded', '0306406152') }];
    const found = await searchBooks('0306406152', '');
    expect(ids(found.items)).toEqual(['c']);
    expect(asked).toHaveLength(2);
    expect(word(asked[1])).toBe('0306406152');
  });

  it('does not look the ISBN up again for a later page', async () => {
    world.books = [ours()];
    await searchBooks(isbn13, '', { id: 'x' } as DocumentSnapshot);
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContainEqual(expect.objectContaining({ field: 'isbn' }));
  });
});

describe('the best few titles (pickers and the find box)', () => {
  it('puts titles starting with the typed text first, each group by title, and cuts after', async () => {
    world.books = [book('a', 'A Secret Place'), book('b', 'Big Secret'), book('c', 'Secret Garden'), book('d', 'Secret Seven'), book('e', 'The Secret')];
    expect(ids(await findBooks('secret', 8))).toEqual(['c', 'd', 'a', 'b', 'e']);
    expect(ids(await findBooks('Secret', 3))).toEqual(['c', 'd', 'a']);
  });

  it('asks for the status it is given, so archived titles take no places', async () => {
    world.books = [book('a', 'Secret Attic', { status: 'ARCHIVED' }), book('b', 'Secret Barn')];
    expect(ids(await findBooks('secret', 8, 'ACTIVE'))).toEqual(['b']);
    expect(asked[0]).toContainEqual({ kind: 'where', field: 'status', op: '==', value: 'ACTIVE' });
    expect(ids(await findBooks('secret', 8))).toEqual(['a', 'b']);
  });

  it('narrows by every word like the catalogue list', async () => {
    world.books = [book('a', 'Secret Garden'), book('b', 'Secret Seven'), book('c', 'The Secret Seven Win')];
    expect(ids(await findBooks('secret seven', 8))).toEqual(['b', 'c']);
  });
});
