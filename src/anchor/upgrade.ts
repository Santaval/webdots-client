import { generateSelector, type GenerateSelectorOptions } from './generateSelector';
import type { AnchorDescriptor, ResolveResult } from './types';

/** Options forwarded to `generateSelector`; see `GenerateSelectorOptions`. */
export type ComputeAnchorUpgradeOptions = GenerateSelectorOptions;

/**
 * Self-healing (issue #7): when a `coords`-strategy anchor — the synthesized
 * fallback `api/dto.ts` emits for legacy rows that predate the `anchor Json`
 * column — re-resolves to a live element, regenerate a real
 * selector-strategy anchor for it so the pin tracks the element across DOM
 * shifts instead of drifting on raw page coordinates.
 *
 * Returns the upgraded `AnchorDescriptor` to PATCH back, or `null` when there
 * is nothing to upgrade:
 *  - no resolved element (orphaned/lost) — nothing to anchor to;
 *  - the stored anchor is already selector-based (non-`coords`) — it tracks
 *    already, so regenerating would only churn;
 *  - `generateSelector` itself falls through to `coords` (no stable selector
 *    exists for the element) — there's no better strategy to persist.
 *
 * The click point is recomputed as a fraction of the element's CURRENT box
 * in **page space** (`pageX − (rect.left + scrollX)`), not the viewport-space
 * formula `createAnchor` uses at click time. At click time scroll is the
 * same on both sides so the two agree; at self-heal time the page may have
 * scrolled, and only the page-space form keeps the pin on the original
 * click point (`position()` reconstructs `pageLeft + ratio·width === pageX`).
 */
export function computeAnchorUpgrade(
  stored: AnchorDescriptor,
  resolved: ResolveResult,
  pageX: number,
  pageY: number,
  options: ComputeAnchorUpgradeOptions = {},
): AnchorDescriptor | null {
  if (!resolved.element) return null;
  if (stored.strategy !== 'coords') return null;

  const generated = generateSelector(resolved.element, options);
  if (generated.strategy === 'coords') return null;

  const candidate: AnchorDescriptor = {
    v: 1,
    strategy: generated.strategy,
    selector: generated.selector,
    path: generated.path,
    ratio: recomputeRatio(resolved.element, pageX, pageY),
    viewportW: window.innerWidth,
    tag: generated.tag,
    textHint: generated.textHint,
  };

  if (
    candidate.strategy === stored.strategy &&
    candidate.selector === stored.selector &&
    candidate.path === stored.path
  ) {
    return null;
  }

  return candidate;
}

function recomputeRatio(element: Element, pageX: number, pageY: number): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const pageLeft = rect.left + window.scrollX;
  const pageTop = rect.top + window.scrollY;
  return {
    x: rect.width === 0 ? 0.5 : clamp01((pageX - pageLeft) / rect.width),
    y: rect.height === 0 ? 0.5 : clamp01((pageY - pageTop) / rect.height),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
