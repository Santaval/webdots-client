import type { MagicLinkSession } from '../api/AuthAPI';

/**
 * Persists the reviewer's magic-link session (JWT + server-confirmed identity)
 * in `localStorage`, namespaced by `apiUrl + pageKey`. This is issue #5's
 * "token survives reload" path: a reviewer who signs in, then reloads the host
 * page (or navigates away and back to the same `pageKey`), is restored without
 * re-prompting — the stored token is trusted optimistically and re-validated
 * lazily by the next annotation request, so an expired JWT re-prompts via the
 * same 401 -> re-open-panel flow as an in-session expiry (no page reload).
 *
 * Namespaced by BOTH `apiUrl` and `pageKey` (per #5's scope): a host page that
 * embeds the widget against one backend on one page keeps a separate session
 * from the same backend on a different page. The key is a plain string join
 * (no hashing — zero-dep, and `localStorage` keys are arbitrary strings so the
 * raw URLs are fine), with `|` as the separator so the two URL fields can't
 * ambiguously merge into one.
 *
 * All accessors are defensive against `localStorage` being absent (private
 * mode, SSR, disabled storage) — each returns a no-op / `null` so the Widget's
 * session logic never has to branch on storage availability itself: a missing
 * store simply degrades to "no persistence", the same as a first-visit.
 */

const KEY_PREFIX = 'webdots:session:';

/**
 * Builds the namespaced storage key. Extracted so a test (and a future
 * `clearAllSessions()` admin tool) can predict the shape without re-deriving
 * the separator.
 */
export function sessionKey(apiUrl: string, pageKey: string): string {
  return `${KEY_PREFIX}${apiUrl}|${pageKey}`;
}

function getStorage(): Storage | null {
  // `typeof` guard, not a try/catch: in SSR/private mode the global simply
  // doesn't exist, and we don't want to swallow genuine quota/permission
  // errors as "no storage" — those should still surface from saveSession().
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/** Reads and parses the session for this namespace, or `null` on any miss. */
export function loadSession(apiUrl: string, pageKey: string): MagicLinkSession | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(sessionKey(apiUrl, pageKey));
  } catch {
    // A corrupted/quota-locked store reads as "no session" — the caller falls
    // back to mounting the AuthPanel, which is the correct safe state.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MagicLinkSession>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.token === 'string' &&
      parsed.user &&
      typeof parsed.user.name === 'string' &&
      (parsed.user.email === undefined || typeof parsed.user.email === 'string')
    ) {
      return { token: parsed.token, user: { name: parsed.user.name, email: parsed.user.email } };
    }
    return null;
  } catch {
    return null;
  }
}

/** Writes the session for this namespace. */
export function saveSession(apiUrl: string, pageKey: string, session: MagicLinkSession): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(sessionKey(apiUrl, pageKey), JSON.stringify(session));
  } catch {
    // Quota exceeded / disabled storage — silently no-op. Persistence is a
    // reload convenience, not a correctness requirement; the in-memory
    // session still works for the rest of this page lifetime.
  }
}

/** Removes the session for this namespace (used on expiry / sign-out). */
export function clearSession(apiUrl: string, pageKey: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(sessionKey(apiUrl, pageKey));
  } catch {
    // Same defensive stance as loadSession — never throw from a teardown.
  }
}
