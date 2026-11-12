/**
 * Choices remembered in this browser so a screen opens the way it was last used (the shelf books were last
 * received onto, the last rider). A convenience only: storage can be missing, full or edited by hand, so reads
 * never throw and every stored value is checked by the caller's guard before it is used. Name keys with
 * `remember.key` for the organization and branch the choice belongs to; never store anything personal.
 */
export const remember = {
  /** "stories.receive.<orgId>.<branchId>" from ('receive', orgId, branchId). */
  key: (name: string, ...scope: string[]): string => ['stories', name, ...scope].join('.'),

  /** The stored value when there is one and `valid` accepts it; otherwise `fallback`. */
  get<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const value: unknown = JSON.parse(raw);
      return valid(value) ? value : fallback;
    } catch {
      return fallback;
    }
  },

  /** Stores the value as JSON; `undefined` forgets it. */
  set(key: string, value: unknown): void {
    try {
      if (value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  },
};

/** Guard for `remember.get`: one of the given texts (an enum's values, or the ids still on offer). */
export const oneOf =
  <T extends string>(options: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (options as readonly string[]).includes(value);
