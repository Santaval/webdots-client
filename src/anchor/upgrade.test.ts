import { describe, it, expect, afterEach, vi } from 'vitest';
import { computeAnchorUpgrade } from './upgrade';
import type { AnchorDescriptor, ResolveResult } from './types';

/** Mirrors the coords fallback `api/dto.ts` synthesizes for a legacy row. */
function coordsAnchor(selector = 'button', tag = ''): AnchorDescriptor {
  return {
    v: 1,
    strategy: 'coords',
    selector,
    path: selector,
    ratio: { x: 0.5, y: 0.5 },
    viewportW: 0,
    tag,
  };
}

function rectSpy(el: Element, r: { left: number; top: number; width: number; height: number }) {
  return vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top,
    toJSON() {},
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('computeAnchorUpgrade', () => {
  it('upgrades a coords anchor to the regenerated testid strategy and recomputes the ratio in page space', () => {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'cta');
    el.textContent = 'Buy';
    document.body.appendChild(el);
    rectSpy(el, { left: 100, top: 200, width: 40, height: 20 });

    const result: ResolveResult = { confidence: 'exact', element: el };
    const upgraded = computeAnchorUpgrade(coordsAnchor(), result, 110, 210)!;

    expect(upgraded.v).toBe(1);
    expect(upgraded.strategy).toBe('testid');
    expect(upgraded.selector).toBe('[data-testid="cta"]');
    expect(upgraded.tag).toBe('BUTTON');
    // (110 - 100) / 40 = 0.25 ; (210 - 200) / 20 = 0.5
    expect(upgraded.ratio).toEqual({ x: 0.25, y: 0.5 });
    expect(upgraded.viewportW).toBe(window.innerWidth);
  });

  it('upgrades to the structural path strategy when no stable attribute exists', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    rectSpy(el, { left: 0, top: 0, width: 100, height: 100 });

    const result: ResolveResult = { confidence: 'exact', element: el };
    const upgraded = computeAnchorUpgrade(coordsAnchor(), result, 50, 50)!;

    expect(upgraded.strategy).toBe('path');
    expect(upgraded.ratio).toEqual({ x: 0.5, y: 0.5 });
  });

  it('returns null when no element resolved (orphaned/lost) — nothing to anchor to', () => {
    const result: ResolveResult = { confidence: 'orphaned', element: null };
    expect(computeAnchorUpgrade(coordsAnchor(), result, 10, 20)).toBeNull();
  });

  it('returns null for an already selector-based anchor (non-coords) — it tracks already', () => {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'cta');
    document.body.appendChild(el);
    rectSpy(el, { left: 0, top: 0, width: 10, height: 10 });

    const stored: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="cta"]',
      path: '[data-testid="cta"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };
    const result: ResolveResult = { confidence: 'exact', element: el };
    expect(computeAnchorUpgrade(stored, result, 5, 5)).toBeNull();
  });

  it('recomputes ratio in page space (scroll offset applied), not viewport space', () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 50 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 30 });

    const el = document.createElement('button');
    el.setAttribute('data-testid', 'cta');
    document.body.appendChild(el);
    // viewport rect left:100 -> page-left 150 with scrollX 50.
    rectSpy(el, { left: 100, top: 200, width: 40, height: 20 });

    const result: ResolveResult = { confidence: 'exact', element: el };
    const upgraded = computeAnchorUpgrade(coordsAnchor(), result, 160, 210)!;

    // (160 - (100 + 50)) / 40 = 0.25 ; (210 - (200 + 30)) / 20 = 0
    expect(upgraded.ratio).toEqual({ x: 0.25, y: 0 });
  });

  it('guards a zero-size element by treating the ratio as the box center (0.5)', () => {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'cta');
    document.body.appendChild(el);
    rectSpy(el, { left: 10, top: 10, width: 0, height: 0 });

    const result: ResolveResult = { confidence: 'exact', element: el };
    const upgraded = computeAnchorUpgrade(coordsAnchor(), result, 10, 10)!;

    expect(upgraded.ratio).toEqual({ x: 0.5, y: 0.5 });
    expect(Number.isFinite(upgraded.ratio.x)).toBe(true);
    expect(Number.isFinite(upgraded.ratio.y)).toBe(true);
  });

  it('clamps the recomputed ratio to [0, 1] when the stored click point falls outside the current box', () => {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'cta');
    document.body.appendChild(el);
    rectSpy(el, { left: 0, top: 0, width: 10, height: 10 });

    const result: ResolveResult = { confidence: 'exact', element: el };
    // Page click far to the right and below the 10x10 box.
    const upgraded = computeAnchorUpgrade(coordsAnchor(), result, 5000, 5000)!;

    expect(upgraded.ratio).toEqual({ x: 1, y: 1 });
  });
});
