import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAnchor } from './createAnchor';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function stubRect(el: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {},
    ...rect,
  });
}

describe('createAnchor', () => {
  it('computes ratio.x/y as the click position as a fraction of the element box', () => {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'btn');
    document.body.appendChild(el);
    stubRect(el, { left: 100, top: 200, width: 40, height: 20 });

    const { anchor } = createAnchor(el, { clientX: 110, clientY: 210 });

    expect(anchor.ratio.x).toBeCloseTo((110 - 100) / 40);
    expect(anchor.ratio.y).toBeCloseTo((210 - 200) / 20);
  });

  it('guards against a zero-width box by defaulting ratio.x to 0.5', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    stubRect(el, { left: 50, top: 50, width: 0, height: 20 });

    const { anchor } = createAnchor(el, { clientX: 50, clientY: 60 });

    expect(anchor.ratio.x).toBe(0.5);
  });

  it('guards against a zero-height box by defaulting ratio.y to 0.5', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    stubRect(el, { left: 50, top: 50, width: 20, height: 0 });

    const { anchor } = createAnchor(el, { clientX: 55, clientY: 50 });

    expect(anchor.ratio.y).toBe(0.5);
  });

  it('clamps ratio to [0, 1] even when the click point falls outside the box', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    stubRect(el, { left: 0, top: 0, width: 10, height: 10 });

    const { anchor } = createAnchor(el, { clientX: -50, clientY: 500 });

    expect(anchor.ratio.x).toBe(0);
    expect(anchor.ratio.y).toBe(1);
  });

  it('computes absolute page coordinates as clientX/Y plus current scroll', () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 15 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 25 });

    const el = document.createElement('button');
    document.body.appendChild(el);
    stubRect(el, { left: 0, top: 0, width: 10, height: 10 });

    const { pageX, pageY } = createAnchor(el, { clientX: 5, clientY: 5 });

    expect(pageX).toBe(20);
    expect(pageY).toBe(30);
  });

  it('carries the generated selector strategy/path/tag through onto the anchor', () => {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'save');
    document.body.appendChild(el);
    stubRect(el, { left: 0, top: 0, width: 10, height: 10 });

    const { anchor } = createAnchor(el, { clientX: 5, clientY: 5 });

    expect(anchor.v).toBe(1);
    expect(anchor.strategy).toBe('testid');
    expect(anchor.selector).toBe('[data-testid="save"]');
    expect(anchor.tag).toBe('BUTTON');
    expect(anchor.path.length).toBeGreaterThan(0);
  });
});
