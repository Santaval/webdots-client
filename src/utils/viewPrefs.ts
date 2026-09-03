/**
 * Persists the reviewer's per-site view preferences in `localStorage`,
 * namespaced by `apiUrl` alone — same namespacing rationale as
 * `sessionStore.ts`: `localStorage` is already partitioned per host origin
 * by the browser, so `apiUrl` alone is enough to mean "this annotation view
 * preference, for this backend, on this site." A reviewer who navigates from
 * one page to another on the same site keeps the preference instead of it
 * resetting per-page. Two preferences live here today:
 *  - "hide annotations" (issue #20) — a boolean, stored as `'1'`/`'0'`;
 *  - the floating toolbar's position (issue #21) — a corner (stored as the
 *    bare corner string) or a dragged `{ x, y }` point (stored as JSON).
 *
 * Mirrors `sessionStore.ts` exactly: the same `typeof localStorage`
 * existence guard (not try/catch — a missing global is not the same failure
 * as a corrupted/quota-locked store), and the same "storage missing degrades
 * to the caller's default" stance. Every accessor is defensive so Widget's
 * preference logic never has to branch on storage availability itself.
 */

import type { ToolbarPosition } from '../core/types';
import { isToolbarCorner, isToolbarPoint } from './toolbarPosition';

const KEY_PREFIX = 'webdots:view:annotations-hidden:';
const POSITION_KEY_PREFIX = 'webdots:view:toolbar-position:';

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

/** Builds the namespaced storage key for the toolbar position (issue #21). Extracted for the same test-visibility reason as `annotationsHiddenKey`. */
export function toolbarPositionKey(apiUrl: string): string {
  return `${POSITION_KEY_PREFIX}${apiUrl}`;
}

/**
 * Reads the stored toolbar position (issue #21). `null` means "no stored
 * position" (never moved, storage absent, or the value is garbage) — the
 * caller falls back to `config.toolbarPosition`. Corners are stored as their
 * bare string, points as JSON, so the two halves of the `ToolbarPosition`
 * union never share a serialization (a point can't be mistaken for a corner
 * or vice versa). Shape-checked with the same guards `setToolbarPosition()`
 * uses, so a hand-edited/garbage value reads as "no preference" rather than
 * crashing a later mount — same corruption-tolerant stance as
 * `sessionStore.loadSession()`.
 */
export function loadToolbarPosition(apiUrl: string): ToolbarPosition | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(toolbarPositionKey(apiUrl));
  } catch {
    return null;
  }
  if (raw === null) return null;
  if (isToolbarCorner(raw)) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isToolbarPoint(parsed)) return { x: parsed.x, y: parsed.y };
  } catch {
    // Not JSON either — falls through to the no-preference return.
  }
  return null;
}

/** Writes the toolbar position for this namespace. Never throws, same stance as `saveAnnotationsHidden()`. */
export function saveToolbarPosition(apiUrl: string, position: ToolbarPosition): void {
  const storage = getStorage();
  if (!storage) return;
  const serialized = typeof position === 'string' ? position : JSON.stringify({ x: position.x, y: position.y });
  try {
    storage.setItem(toolbarPositionKey(apiUrl), serialized);
  } catch {
    // Silently no-op — see saveAnnotationsHidden().
  }
}
