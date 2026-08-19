import { describe, it, expect } from 'vitest';
import { Pin } from './Pin';
import type { Annotation } from '../core/types';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    pageUrl: 'https://example.com/',
    selector: 'button',
    x: 10,
    y: 20,
    anchor: null,
    title: 'Broken layout',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Pin confidence-aware treatment', () => {
  it('defaults to exact styling with no degraded class and a plain aria-label', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(false);
    expect(pin.el.getAttribute('aria-label')).toBe('Annotation 1: Broken layout');
    expect(pin.el.dataset.wdConfidence).toBe('exact');
  });

  it('setPosition(point, "exact") shows the pin with no degraded class', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    pin.setPosition({ x: 10, y: 20 }, 'exact');
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(false);
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(false);
    expect(pin.el.dataset.wdConfidence).toBe('exact');
  });

  it('setPosition(point, "degraded") adds the dashed class and amends the aria-label', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    pin.setPosition({ x: 10, y: 20 }, 'degraded');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(true);
    expect(pin.el.getAttribute('aria-label')).toBe('Annotation 1: Broken layout (position may have shifted)');
    expect(pin.el.dataset.wdConfidence).toBe('degraded');
  });

  it('setPosition(point, "orphaned") adds the dashed class and amends the aria-label', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    pin.setPosition({ x: 10, y: 20 }, 'orphaned');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(true);
    expect(pin.el.getAttribute('aria-label')).toContain('position may have shifted');
  });

  it('setPosition(null) hides the pin regardless of confidence', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    pin.setPosition({ x: 10, y: 20 }, 'exact');
    pin.setPosition(null, 'lost');
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(true);
    expect(pin.el.dataset.wdConfidence).toBe('lost');
  });

  it('going from degraded back to exact removes the dashed class and the aria suffix', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    pin.setPosition({ x: 10, y: 20 }, 'degraded');
    pin.setPosition({ x: 10, y: 20 }, 'exact');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(false);
    expect(pin.el.getAttribute('aria-label')).toBe('Annotation 1: Broken layout');
  });

  it('setIndex preserves the current confidence in the rebuilt aria-label', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    pin.setPosition({ x: 10, y: 20 }, 'degraded');
    pin.setIndex(3, 'Renamed title');
    expect(pin.el.getAttribute('aria-label')).toBe('Annotation 3: Renamed title (position may have shifted)');
  });

  it('resolve cache defaults to null/exact and can be set and read back', () => {
    const pin = new Pin({ annotation: makeAnnotation(), index: 1 });
    expect(pin.getResolveCache()).toEqual({ element: null, confidence: 'exact' });

    const el = document.createElement('button');
    pin.setResolveCache(el, 'degraded');
    expect(pin.getResolveCache()).toEqual({ element: el, confidence: 'degraded' });
  });
});
