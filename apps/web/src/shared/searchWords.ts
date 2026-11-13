// How a typed search is matched against the words the server stores on books and members
// (functions/src/catalogue/search.ts). No database code in here, so it can be tested on its own.

/** The longest start of a word the server indexes: a longer typed word matches through its first 12 characters. */
export const WORD_MAX = 12;

/** Text as the server compares it: case, accents, spacing and punctuation don't count, so "García" is "garcia". */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The words of a search, in the order typed: one-character pieces are not indexed and are left out, longer
 * words are cut to what the index holds, and a word typed twice counts once.
 */
export function queryWords(q: string): string[] {
  const words = normalizeText(q)
    .split(' ')
    .filter((w) => w.length >= 2)
    .map((w) => w.slice(0, WORD_MAX));
  return [...new Set(words)];
}

/** Words nearly every title has: asking the database for one of them returns half the catalogue. */
const LITTLE_WORDS = new Set(['the', 'and', 'of', 'in', 'for', 'a', 'an']);

/**
 * The one word the database is asked for (the others narrow what comes back): the longest, and of two equally
 * long the one typed first. A little word is chosen only when nothing else was typed.
 */
export function primaryWord(words: string[]): string | null {
  const longestFirst = (list: string[]) => [...list].sort((a, b) => b.length - a.length)[0];
  return longestFirst(words.filter((w) => !LITTLE_WORDS.has(w))) ?? longestFirst(words) ?? null;
}

/** Whether a record's stored words hold every typed word. A record without stored words never matches. */
export function matchesAll(tokens: readonly string[] | null | undefined, words: string[]): boolean {
  if (!Array.isArray(tokens)) return false;
  return words.every((w) => tokens.includes(w));
}
