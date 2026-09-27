/**
 * Firestore-compatible search (docs/LIBRARY.md §Search). Each searchable
 * document stores `searchTokens`: normalized words plus their prefixes, so a
 * single `array-contains` query answers "starts with" searches. Swappable for
 * a real search service later without changing callers.
 */
const MAX_PREFIX = 12;
const MAX_TOKENS = 200;

export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function searchTokens(...fields: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const word of normalizeText(field).split(' ')) {
      if (!word) continue;
      out.add(word);
      for (let n = 2; n < Math.min(word.length, MAX_PREFIX + 1); n++) out.add(word.slice(0, n));
    }
  }
  return [...out].slice(0, MAX_TOKENS);
}

/** The single token a query should use: the longest word of the query (prefix-capped). */
export function queryToken(q: string): string | null {
  const words = normalizeText(q).split(' ').filter((w) => w.length >= 2);
  if (!words.length) return null;
  const longest = words.sort((a, b) => b.length - a.length)[0];
  return longest.slice(0, MAX_PREFIX);
}
