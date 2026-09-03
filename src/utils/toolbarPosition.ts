import type { ToolbarCorner, ToolbarPosition } from '../core/types';

/**
 * Issue #21: pure, DOM-free placement math + shape guards for the floating
 * toolbar's position. Kept out of `ui/` deliberately — `core/config.ts` and
 * `utils/viewPrefs.ts` both need the corner guard, and core never imports ui
 * (only Widget wires UI together). Same "trivially unit-testable" stance as
 * `computePlacement()` in ui/Popover.ts.
 */

/** The one place the corner list lives; config validation and storage both derive from it. */
export const TOOLBAR_CORNERS: readonly ToolbarCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/**
 * How close a dragged toolbar may sit to the viewport edge — it is clamped
 * fully on-screen with this inset, so it can never end up half-off or
 * unreachable. Matches `computePlacement()`'s 8px rather than the 16px
 * resting inset (`--wd-space-4`): a reviewer who drags all the way to an
 * edge clearly wants it as close as possible, while a corner preset keeps
 * its roomier default.
 */
export const TOOLBAR_CLAMP_MARGIN = 8;

export function isToolbarCorner(value: unknown): value is ToolbarCorner {
  return typeof value === 'string' && TOOLBAR_CORNERS.includes(value as ToolbarCorner);
}

/**
 * Shape guard for the free half of the union: a plain object with finite
 * `x`/`y`. Rejects non-numbers, `NaN`/`Infinity`, and class instances alike —
 * everything the public `handle.setToolbarPosition()` and the stored
 * preference must be defended against. Negative values pass (clamping, not
 * validation, is what puts them back on-screen).
 */
export function isToolbarPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y)
  );
}

/**
 * Clamps a free `{ x, y }` top-left point so the toolbar stays fully
 * on-screen: `[margin, viewport - size - margin]` on each axis, with the
 * range degrading to `[margin, viewport - margin]` when the size is unknown
 * (not yet measured, or a jsdom rect of 0) so the point itself still lands
 * in-bounds. Pure — the caller supplies the measurements.
 */
export function clampToolbarPosition(
  point: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  width = 0,
  height = 0,
  margin = TOOLBAR_CLAMP_MARGIN,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewportWidth - Math.max(width, 0) - margin);
  const maxY = Math.max(margin, viewportHeight - Math.max(height, 0) - margin);
  return {
    x: Math.min(Math.max(point.x, margin), maxX),
    y: Math.min(Math.max(point.y, margin), maxY),
  };
}

/** Structural equality for the union: corners compare as strings, points per-axis. */
export function sameToolbarPosition(a: ToolbarPosition, b: ToolbarPosition): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.x === b.x && a.y === b.y;
}
