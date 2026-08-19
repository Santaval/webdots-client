import type { AnchorDescriptor, ResolveResult } from './types';

export interface ViewportPoint {
  x: number;
  y: number;
}

/**
 * Converts a `ResolveResult` into a viewport-space point for the Overlay to
 * render a pin at (or `null` when it shouldn't render at all).
 *  - `lost`                    -> null.
 *  - `strategy === 'coords'`   -> ALWAYS stored page coordinates minus
 *                                 current scroll, regardless of confidence.
 *                                 `coords` means "nothing usable was
 *                                 captured" (generateSelector, plan §4 step
 *                                 6: `selector = 'body'`) or "no anchor data
 *                                 exists at all" (api/dto.ts's fallback for
 *                                 anchor-less/legacy wire rows). `selector`
 *                                 for a `coords` anchor is either literally
 *                                 `'body'` or an unverified leftover string
 *                                 — either way it would trivially "resolve"
 *                                 to *some* element, but applying ratio math
 *                                 to that element's box (e.g. `<body>`'s
 *                                 full-page rect) would place the pin
 *                                 nowhere near the actual click. Per the
 *                                 plan, `coords` position must come purely
 *                                 from stored page coordinates.
 *  - element resolved          -> the anchor's stored ratio applied to the
 *                                 element's CURRENT `getBoundingClientRect()`.
 *                                 This is what makes `position: sticky`/
 *                                 `fixed` anchors work: viewport coords need
 *                                 no scroll-offset math.
 *  - `orphaned` (no elem)      -> stored page coordinates minus current
 *                                 scroll.
 */
export function position(result: ResolveResult, anchor: AnchorDescriptor, pageX: number, pageY: number): ViewportPoint | null {
  if (result.confidence === 'lost') return null;

  if (anchor.strategy === 'coords') {
    return {
      x: pageX - window.scrollX,
      y: pageY - window.scrollY,
    };
  }

  if (result.element) {
    const rect = result.element.getBoundingClientRect();
    return {
      x: rect.left + anchor.ratio.x * rect.width,
      y: rect.top + anchor.ratio.y * rect.height,
    };
  }

  return {
    x: pageX - window.scrollX,
    y: pageY - window.scrollY,
  };
}
