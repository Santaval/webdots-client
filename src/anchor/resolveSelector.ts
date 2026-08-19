import { getTextHint } from './generateSelector';
import type { AnchorDescriptor, ResolveResult } from './types';

/**
 * Re-resolves an `AnchorDescriptor` to a live element with a confidence
 * level, per the plan §4 table:
 *   1. `selector` matches exactly one element with the right tag -> exact
 *   2. retry via `path` (the repair channel), 1 match, tag matches -> degraded
 *   3. still >1 candidates -> disambiguate by textHint, then by proximity
 *      to the stored page coordinates -> degraded
 *   4. nothing resolves -> orphaned (position falls back to stored coords)
 *   5. nothing resolves AND the stored y is beyond the current document
 *      height -> lost (not rendered at all)
 */
export function resolveSelector(anchor: AnchorDescriptor, pageX: number, pageY: number, doc: Document = document): ResolveResult {
  const exact = queryUnique(doc, anchor.selector, anchor.tag);
  if (exact) return { confidence: 'exact', element: exact };

  const viaPath = queryUnique(doc, anchor.path, anchor.tag);
  if (viaPath) return { confidence: 'degraded', element: viaPath };

  const candidates = collectCandidates(doc, anchor);
  if (candidates.length === 1) {
    return { confidence: 'degraded', element: candidates[0] ?? null };
  }
  if (candidates.length > 1) {
    const disambiguated = disambiguate(candidates, anchor, pageX, pageY);
    if (disambiguated) return { confidence: 'degraded', element: disambiguated };
  }

  const scrollHeight = doc.documentElement?.scrollHeight ?? 0;
  if (pageY > scrollHeight) {
    return { confidence: 'lost', element: null };
  }
  return { confidence: 'orphaned', element: null };
}

function queryUnique(doc: Document, selector: string, tag: string): Element | null {
  const matches = queryAllByTag(doc, selector, tag);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function collectCandidates(doc: Document, anchor: AnchorDescriptor): Element[] {
  const fromSelector = queryAllByTag(doc, anchor.selector, anchor.tag);
  if (fromSelector.length > 1) return fromSelector;
  return queryAllByTag(doc, anchor.path, anchor.tag);
}

function queryAllByTag(doc: Document, selector: string, tag: string): Element[] {
  if (!selector) return [];
  try {
    return Array.from(doc.querySelectorAll(selector)).filter((el) => el.tagName === tag);
  } catch {
    return [];
  }
}

function disambiguate(candidates: Element[], anchor: AnchorDescriptor, pageX: number, pageY: number): Element | null {
  if (anchor.textHint) {
    const textMatches = candidates.filter((el) => getTextHint(el) === anchor.textHint);
    if (textMatches.length === 1) return textMatches[0] ?? null;
    if (textMatches.length > 1) return closestByPosition(textMatches, pageX, pageY);
  }
  return closestByPosition(candidates, pageX, pageY);
}

function closestByPosition(candidates: Element[], pageX: number, pageY: number): Element | null {
  let best: Element | null = null;
  let bestDistance = Infinity;

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + window.scrollX + rect.width / 2;
    const centerY = rect.top + window.scrollY + rect.height / 2;
    const distance = Math.hypot(centerX - pageX, centerY - pageY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = el;
    }
  }

  return best;
}
