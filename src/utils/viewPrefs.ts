/**
 * Persists the reviewer's "hide annotations" preference (issue #20) in
 * `localStorage`, namespaced by `apiUrl` alone — same namespacing rationale
 * as `sessionStore.ts`: `localStorage` is already partitioned per host
 * origin by the browser, so `apiUrl` alone is enough to mean "this
 * annotation view preference, for this backend, on this site." A reviewer
 * who navigates from one page to another on the same site keeps the
 * preference instead of it resetting per-page.
 *
 * Mirrors `sessionStore.ts` exactly: the same `typeof localStorage`
 * existence guard (not try/catch — a missing global is not the same failure
 * as a corrupted/quota-locked store), and the same "storage missing
 * degrades to the caller's default" stance. Every accessor is defensive so
 * Widget's annotations-visibility logic never has to branch on storage
 * availability itself.
 */

const KEY_PREFIX = 'webdots:view:annotations-hidden:';

/** Builds the namespaced storage key. Extracted so a test can predict the shape without re-deriving the prefix. */
export function annotationsHiddenKey(apiUrl: string): string {
  return `${KEY_PREFIX}${apiUrl}`;
}

function getStorage(): Storage | null {
  // `typeof` guard, not a try/catch: in SSR/private mode the global simply
  // doesn't exist, and we don't want to swallow genuine quota/permission
  // errors as "no storage" — those should still surface from
  // `saveAnnotationsHidden()`.
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/**
 * Reads the stored preference for this namespace. `null` means "no stored
 * preference" (never visited, storage absent, or the value is garbage) —
 * the caller falls back to `config.hideAnnotations`. Stored as `'1'`/`'0'`;
 * any other value reads as `null`, same corruption-tolerant stance as
 * `sessionStore.loadSession()`.
 */
export function loadAnnotationsHidden(apiUrl: string): boolean | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(annotationsHiddenKey(apiUrl));
  } catch {
    return null;
  }
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Writes the preference for this namespace. Never throws — a quota/permission failure just drops the persistence. */
export function saveAnnotationsHidden(apiUrl: string, hidden: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(annotationsHiddenKey(apiUrl), hidden ? '1' : '0');
  } catch {
    // Quota exceeded / disabled storage — silently no-op. Persistence is a
    // reload convenience, not a correctness requirement.
  }
}
