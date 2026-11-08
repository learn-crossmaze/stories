// After a deploy, a tab opened earlier still asks for the previous build's page
// chunks, which no longer exist. Those failures mean "there is a new version":
// the page reloads once to pick it up (and says so if that didn't help).

const KEY = 'stories:reloadedForUpdate';
/** A second failure within this time isn't fixed by reloading again (no reload loops). */
const GUARD_MS = 60_000;

let reloading = false;

/** True for the errors browsers and Vite give when a lazily loaded chunk can't be fetched or run. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script|is not a valid JavaScript MIME type/i.test(error.message)
  );
}

/** A reload for a new version has started (the page is about to go away). */
export const reloadingForUpdate = () => reloading;

/**
 * Reloads the page to get the new version, unless it already did so within the
 * last minute (the sessionStorage guard). Returns whether it reloads.
 */
export function reloadForUpdate(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(), reload: () => void = () => window.location.reload()): boolean {
  if (reloading) return true;
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(KEY));
    if (last && Date.now() - last < GUARD_MS) return false;
    storage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  reloading = true;
  reload();
  return true;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Vite fires `vite:preloadError` when a dynamic import (or a chunk it needs)
 * fails to load. Reload once to get the new build; if that isn't possible the
 * error carries on to the route error screen, which offers a reload.
 */
export function installChunkReload(target: Window = window) {
  target.addEventListener('vite:preloadError', (event) => {
    if (reloadForUpdate()) event.preventDefault();
  });
}
