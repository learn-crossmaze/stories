// One read for several askers. The menu and the Dashboard ask for the same counts at the same moment; with a key
// naming who asks and for what, they share the read under way and its answer for a few seconds afterwards.
// Only for call sites that can live with an answer a few seconds old: never wrap a data function globally, because
// pages read again right after a save and must see it.

interface Held {
  read: Promise<unknown>;
  /** When the answer arrived (null while the read is still under way). */
  at: number | null;
  holdMs: number;
}

const held = new Map<string, Held>();

/**
 * `load()` for `key`, shared: a read under way for the same key is reused however long it takes, and its answer
 * for `holdMs` after it arrived. A failed read is never kept, so "Try again" really reads again. The key must
 * carry the person (uid) and every argument that changes the answer. Answers are shared by reference: treat them
 * as read-only.
 */
export function sharedLoad<T>(key: string, load: () => Promise<T>, holdMs: number): Promise<T> {
  const now = Date.now();
  const kept = held.get(key);
  if (kept && (kept.at === null || now - kept.at < holdMs)) return kept.read as Promise<T>;
  // What has gone stale is dropped as we pass, so the map never grows past the keys in use.
  for (const [k, h] of held) if (h.at !== null && now - h.at >= h.holdMs) held.delete(k);
  const entry: Held = { read: Promise.resolve().then(load), at: null, holdMs };
  held.set(key, entry);
  entry.read.then(
    () => {
      entry.at = Date.now();
    },
    () => {
      if (held.get(key) === entry) held.delete(key);
    },
  );
  return entry.read as Promise<T>;
}

/** Drops what is held under keys starting with `prefix` (everything, without one), reads under way included. */
export function forget(prefix = ''): void {
  for (const key of [...held.keys()]) if (key.startsWith(prefix)) held.delete(key);
}
