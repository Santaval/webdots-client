import { describe, it, expect } from 'vitest';
import {
  TOOLBAR_CORNERS,
  TOOLBAR_CLAMP_MARGIN,
  clampToolbarPosition,
  isToolbarCorner,
  isToolbarPoint,
  sameToolbarPosition,
} from './toolbarPosition';

describe('toolbarPosition', () => {
  describe('isToolbarCorner', () => {
    it('accepts exactly the four preset corners', () => {
      for (const corner of TOOLBAR_CORNERS) {
        expect(isToolbarCorner(corner)).toBe(true);
      }
      expect(TOOLBAR_CORNERS).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    });

    it('rejects anything else', () => {
      expect(isToolbarCorner('bottom-rightish')).toBe(false);
      expect(isToolbarCorner('')).toBe(false);
      expect(isToolbarCorner({ x: 0, y: 0 })).toBe(false);
      expect(isToolbarCorner(undefined)).toBe(false);
      expect(isToolbarCorner(null)).toBe(false);
    });
  });

  describe('isToolbarPoint', () => {
    it('accepts a plain object with finite x/y', () => {
      expect(isToolbarPoint({ x: 0, y: 0 })).toBe(true);
      expect(isToolbarPoint({ x: 123.5, y: -40 })).toBe(true);
    });

    it('rejects non-numbers, missing axes, and non-finite values', () => {
      expect(isToolbarPoint({ x: '10', y: 20 })).toBe(false);
      expect(isToolbarPoint({ x: 10 })).toBe(false);
      expect(isToolbarPoint({ x: Number.NaN, y: 20 })).toBe(false);
      expect(isToolbarPoint({ x: 10, y: Number.POSITIVE_INFINITY })).toBe(false);
      expect(isToolbarPoint('top-left')).toBe(false);
      expect(isToolbarPoint(null)).toBe(false);
      expect(isToolbarPoint(undefined)).toBe(false);
    });
  });

  describe('clampToolbarPosition', () => {
    it('leaves an already-on-screen point untouched', () => {
      expect(clampToolbarPosition({ x: 100, y: 200 }, 1280, 800, 320, 40)).toEqual({ x: 100, y: 200 });
    });

    it('pulls an off-screen top-left back inside the margin', () => {
      expect(clampToolbarPosition({ x: -500, y: -500 }, 1280, 800, 320, 40)).toEqual({
        x: TOOLBAR_CLAMP_MARGIN,
        y: TOOLBAR_CLAMP_MARGIN,
      });
    });

    it('pulls an off-screen bottom-right back inside the margin', () => {
      expect(clampToolbarPosition({ x: 4000, y: 4000 }, 1280, 800, 320, 40)).toEqual({
        x: 1280 - 320 - TOOLBAR_CLAMP_MARGIN,
        y: 800 - 40 - TOOLBAR_CLAMP_MARGIN,
      });
    });

    it('degrades to viewport-only bounds when the size is unknown (0)', () => {
      // A jsdom rect is all zeros — the clamp must still land the POINT
      // in-bounds rather than letting it through untouched.
      expect(clampToolbarPosition({ x: 4000, y: 4000 }, 1280, 800, 0, 0)).toEqual({
        x: 1280 - TOOLBAR_CLAMP_MARGIN,
        y: 800 - TOOLBAR_CLAMP_MARGIN,
      });
    });

    it('survives a viewport smaller than the toolbar without inverting its range', () => {
      // maxX would go negative; Math.max(margin, …) keeps the toolbar
      // top-left pinned at the margin instead of throwing it off-screen.
      expect(clampToolbarPosition({ x: 500, y: 500 }, 100, 50, 320, 40)).toEqual({
        x: TOOLBAR_CLAMP_MARGIN,
        y: TOOLBAR_CLAMP_MARGIN,
      });
    });
  });

  describe('sameToolbarPosition', () => {
    it('compares corners as strings', () => {
      expect(sameToolbarPosition('top-left', 'top-left')).toBe(true);
      expect(sameToolbarPosition('top-left', 'top-right')).toBe(false);
    });

    it('compares points per-axis', () => {
      expect(sameToolbarPosition({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(true);
      expect(sameToolbarPosition({ x: 10, y: 20 }, { x: 10, y: 21 })).toBe(false);
    });

    it('a corner never equals a point', () => {
      expect(sameToolbarPosition('bottom-right', { x: 1, y: 2 })).toBe(false);
    });
  });
});
