import { describe, it, expect, afterEach, vi } from 'vitest';
import { position } from './position';
import type { AnchorDescriptor, ResolveResult } from './types';

const baseAnchor: AnchorDescriptor = {
  v: 1,
  strategy: 'testid',
  selector: '[data-testid="x"]',
  path: '[data-testid="x"]',
  ratio: { x: 0.5, y: 0.5 },
  viewportW: 1024,
  tag: 'BUTTON',
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('position', () => {
  it('returns null for a lost result regardless of the anchor/coords', () => {
    const result: ResolveResult = { confidence: 'lost', element: null };
    expect(position(result, baseAnchor, 999, 999)).toBeNull();
  });

  it('applies the ratio to the resolved element\'s current bounding rect', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 40,
      height: 20,
      right: 140,
      bottom: 220,
      x: 100,
      y: 200,
      toJSON() {},
    });

    const result: ResolveResult = { confidence: 'exact', element: el };
    const anchor: AnchorDescriptor = { ...baseAnchor, ratio: { x: 0.25, y: 0.75 } };

    const point = position(result, anchor, 0, 0);

    expect(point).toEqual({ x: 100 + 0.25 * 40, y: 200 + 0.75 * 20 });
  });

  it('falls back to stored page coordinates minus current scroll when orphaned', () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 50 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 30 });

    const result: ResolveResult = { confidence: 'orphaned', element: null };
    const point = position(result, baseAnchor, 500, 400);

    expect(point).toEqual({ x: 450, y: 370 });
  });

  it('ratio math guards a zero-width/zero-height element by treating it as the box center (ratio 0.5)', () => {
    // This guard actually lives in createAnchor.ts (where the ratio is
    // computed at click time); position.ts just applies whatever ratio it's
    // given. Verify the composition still degrades gracefully: a
    // zero-size rect at (10, 10) with ratio 0.5/0.5 still resolves to that
    // same point, never NaN/Infinity.
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10,
      width: 0,
      height: 0,
      right: 10,
      bottom: 10,
      x: 10,
      y: 10,
      toJSON() {},
    });

    const result: ResolveResult = { confidence: 'exact', element: el };
    const anchor: AnchorDescriptor = { ...baseAnchor, ratio: { x: 0.5, y: 0.5 } };

    const point = position(result, anchor, 0, 0);

    expect(point).toEqual({ x: 10, y: 10 });
    expect(Number.isFinite(point!.x)).toBe(true);
    expect(Number.isFinite(point!.y)).toBe(true);
  });

  it('a `coords` strategy anchor ALWAYS uses stored page coordinates, even when its selector resolves to a real element', () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

    // `body` always "resolves" — that's the whole problem this guards
    // against. Give it a huge rect so a ratio-math bug would be obvious.
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1440,
      height: 5000,
      right: 1440,
      bottom: 5000,
      x: 0,
      y: 0,
      toJSON() {},
    });

    const coordsAnchor: AnchorDescriptor = {
      v: 1,
      strategy: 'coords',
      selector: 'body',
      path: 'body',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BODY',
    };
    // `exact` on purpose: prove the short-circuit wins even when
    // resolveSelector legitimately found an element.
    const result: ResolveResult = { confidence: 'exact', element: document.body };

    const point = position(result, coordsAnchor, 120, 340);

    expect(point).toEqual({ x: 120, y: 340 });
  });
});
