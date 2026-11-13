// What a page showed last time, kept in memory so that coming back to it paints at once while it reads again
// (useAsync's `cache` option). Memory only, never the disk: member and staff data must not stay on a shared desk
// computer. Whatever is painted from here is always read again, and is never used for availability, limits or money.

interface Kept {
  data: unknown;
  /** When the read that gave this answer started. */
  at: number;
}

/** Older than this, a page shows its loading state as usual. */
export const MAX_AGE_MS = 5 * 60_000;
export const MAX_ENTRIES = 100;

const kept = new Map<string, Kept>();
let owner: string | null = null;

/** The answer kept for `key`, if it is recent enough to show. */
export function get<T>(key: string): { data: T } | undefined {
  const hit = kept.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > MAX_AGE_MS) {
    kept.delete(key);
    return undefined;
  }
  return { data: hit.data as T };
}

/** Keeps an answer. `at` is when its read started, so a slow older read never replaces a newer answer. */
export function set(key: string, data: unknown, at = Date.now()): void {
  const old = kept.get(key);
  if (old && old.at > at) return;
  kept.delete(key);
  kept.set(key, { data, at });
  // The oldest written goes first (a Map lists its keys in the order they were set).
  while (kept.size > MAX_ENTRIES) kept.delete(kept.keys().next().value as string);
}

export function remove(key: string): void {
  kept.delete(key);
}

export function clear(): void {
  kept.clear();
}

/**
 * Says whose answers these are (the person and the version of their permissions). Everything kept for anyone
 * else is dropped first: signing out does not reload the page, so nothing else would empty it.
 */
export function keepFor(who: string | null): void {
  if (who === owner) return;
  owner = who;
  kept.clear();
}
