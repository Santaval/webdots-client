import { describe, it, expect } from 'vitest';
import { computePlacement } from './Popover';

describe('computePlacement', () => {
  it('places the popover just below-right of the anchor when there is room', () => {
    const placement = computePlacement({
      anchorX: 100,
      anchorY: 100,
      width: 200,
      height: 150,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(placement).toEqual({ x: 108, y: 108 });
  });

  it('flips above the anchor when there is no room below', () => {
    const placement = computePlacement({
      anchorX: 100,
      anchorY: 700,
      width: 200,
      height: 150,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    // Below would be 700+8=708..858, past the 792 (800-8) limit -> flip above.
    expect(placement.y).toBe(700 - 150 - 8);
  });

  it('shifts left to stay within the viewport when it would overflow the right edge', () => {
    const placement = computePlacement({
      anchorX: 1150,
      anchorY: 100,
      width: 200,
      height: 150,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(placement.x).toBe(1200 - 200 - 8);
  });

  it('never renders off the top/left edge even in a tiny viewport', () => {
    const placement = computePlacement({
      anchorX: 5,
      anchorY: 5,
      width: 400,
      height: 400,
      viewportWidth: 320,
      viewportHeight: 300,
    });

    expect(placement.x).toBeGreaterThanOrEqual(8);
    expect(placement.y).toBeGreaterThanOrEqual(8);
  });
});
