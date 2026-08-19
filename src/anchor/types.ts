/**
 * Types for the anchor module — selector generation/resolution per plan §4.
 */

/** How an annotation's position was captured / should be re-resolved. */
export type AnchorStrategy = 'testid' | 'id' | 'name' | 'aria' | 'path' | 'coords';

export interface AnchorDescriptor {
  v: 1;
  strategy: AnchorStrategy;
  /** Mirrors the DTO's top-level `selector`. */
  selector: string;
  /** Always-computed structural path — the repair channel. */
  path: string;
  /** Click point as a fraction of the element box. */
  ratio: { x: number; y: number };
  /** Viewport width at capture time; diagnostics for drift. */
  viewportW: number;
  /** e.g. 'BUTTON' — cheap correctness check on re-resolve. */
  tag: string;
  /** First 40 chars of trimmed textContent — disambiguator. */
  textHint?: string;
}

/**
 * How confident `resolveSelector` is in the element it found (or didn't):
 *  - `exact`     — the stored selector matched exactly one element with the
 *                  right tag.
 *  - `degraded`  — resolved via the structural path or disambiguation
 *                  (textHint / proximity); render with a "may have shifted"
 *                  affordance.
 *  - `orphaned`  — nothing resolved; fall back to the stored page
 *                  coordinates minus current scroll.
 *  - `lost`      — nothing resolved AND the stored position is beyond the
 *                  current document height; do not render at all.
 */
export type ResolveConfidence = 'exact' | 'degraded' | 'orphaned' | 'lost';

export interface ResolveResult {
  confidence: ResolveConfidence;
  /** The live element, when one was found (`exact` | `degraded`). */
  element: Element | null;
}
