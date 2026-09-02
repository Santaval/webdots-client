import type { MagicLinkSession } from '../api/AuthAPI';

/**
 * Persists the reviewer's magic-link session (JWT + server-confirmed identity)
 * in `localStorage`, namespaced by `apiUrl` alone. This is issue #5's
 * "token survives reload" path: a reviewer who signs in, then reloads the host
 * page, is restored without re-prompting — the stored token is trusted
 * optimistically and re-validated lazily by the next annotation request, so
 * an expired JWT re-prompts via the same 401 -> re-open-panel flow as an
 * in-session expiry (no page reload).
 *
 * Namespaced by `apiUrl` ONLY — deliberately NOT `pageKey`, even though
 * annotations are grouped by `pageKey` elsewhere (they're per-page content;
 * a reviewer's identity is not). `localStorage` is already partitioned per
 * host origin by the browser, so `apiUrl` alone is enough to mean "signed in
 * to this backend, on this site": a reviewer who navigates from one page to
 * another on the same site stays signed in (#18) instead of being re-prompted
 * on every distinct path. The key is a plain string join (no hashing —
 * zero-dep, and `localStorage` keys are arbitrary strings so the raw URL is
 * fine).
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
 * the prefix.
 */
export function sessionKey(apiUrl: string): string {
  return `${KEY_PREFIX}${apiUrl}`;
}

function getStorage(): Storage | null {
  // `typeof` guard, not a try/catch: in SSR/private mode the global simply
  // doesn't exist, and we don't want to swallow genuine quota/permission
  // errors as "no storage" — those should still surface from saveSession().
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/** Reads and parses the session for this namespace, or `null` on any miss. */
export function loadSession(apiUrl: string): MagicLinkSession | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(sessionKey(apiUrl));
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
export function saveSession(apiUrl: string, session: MagicLinkSession): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(sessionKey(apiUrl), JSON.stringify(session));
  } catch {
    // Quota exceeded / disabled storage — silently no-op. Persistence is a
    // reload convenience, not a correctness requirement; the in-memory
    // session still works for the rest of this page lifetime.
  }
}

/** Removes the session for this namespace (used on expiry / sign-out). */
export function clearSession(apiUrl: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(sessionKey(apiUrl));
  } catch {
    // Same defensive stance as loadSession — never throw from a teardown.
  }
}
