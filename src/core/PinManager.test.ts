import { describe, it, expect, afterEach, vi } from 'vitest';
import { PinManager } from './PinManager';
import { EventBus } from './EventBus';
import { Store } from './Store';
import { Overlay } from '../ui/Overlay';
import { generateSelector } from '../anchor/generateSelector';
import type { Annotation } from './types';
import type { AnchorDescriptor } from '../anchor/types';

function anchorFor(element: Element): AnchorDescriptor {
  const generated = generateSelector(element);
  return {
    v: 1,
    strategy: generated.strategy,
    selector: generated.selector,
    path: generated.path,
    ratio: { x: 0.5, y: 0.5 },
    viewportW: 1024,
    tag: generated.tag,
    textHint: generated.textHint,
  };
}

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

/** Waits two real rAF turns — enough for observeLayout's throttled callback to have fired. */
async function tick(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function stubScrollHeight(value: number): () => void {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value });
  return () => delete (document.documentElement as unknown as Record<string, unknown>).scrollHeight;
}

function setup() {
  const bus = new EventBus();
  const store = new Store(bus);
  const overlay = new Overlay({ bus });
  document.body.appendChild(overlay.el);
  const pinManager = new PinManager({ bus, store, overlay });
  return { bus, store, overlay, pinManager };
}

describe('PinManager confidence-based pin treatment', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exact confidence renders a normal, non-degraded, visible pin', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'cta');
    document.body.appendChild(button);
    const anchor = anchorFor(button);

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 0, y: 0 }));

    const pin = overlay.getPin('a1')!;
    expect(pin.el.dataset.wdConfidence).toBe('exact');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(false);
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(false);

    pinManager.dispose();
  });

  it('degraded confidence (resolved via the structural path) renders a dashed, visible pin', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<div class="row"><button class="cmp">Edit</button></div><div class="row"><button class="cmp">Edit</button></div>';
    document.body.appendChild(container);
    const second = container.querySelectorAll('button')[1]!;
    const generated = generateSelector(second);
    // Rot the primary selector so resolveSelector must fall back to the path.
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: generated.strategy,
      selector: '[data-testid="gone"]',
      path: generated.path,
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: generated.tag,
      textHint: generated.textHint,
    };

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 0, y: 0 }));

    const pin = overlay.getPin('a1')!;
    expect(pin.el.dataset.wdConfidence).toBe('degraded');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(true);
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(false);

    pinManager.dispose();
  });

  it('orphaned confidence (nothing resolves, but within document height) renders a dashed, visible pin at the stored coords', () => {
    const restore = stubScrollHeight(5000);
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="missing"]',
      path: '[data-testid="missing"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 10, y: 10 }));

    const pin = overlay.getPin('a1')!;
    expect(pin.el.dataset.wdConfidence).toBe('orphaned');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(true);
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(false);

    pinManager.dispose();
    restore();
  });

  it('lost confidence is excluded from render (hidden) and reported via state:unplaced-changed', () => {
    const restore = stubScrollHeight(500);
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="missing"]',
      path: '[data-testid="missing"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };

    const { bus, store, overlay, pinManager } = setup();
    const unplacedHandler = vi.fn();
    bus.on('state:unplaced-changed', unplacedHandler);

    store.upsert(makeAnnotation({ id: 'lost1', anchor, x: 0, y: 100_000, title: 'Way down', authorName: 'QA' }));

    const pin = overlay.getPin('lost1')!;
    expect(pin.el.dataset.wdConfidence).toBe('lost');
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(true);

    expect(unplacedHandler).toHaveBeenCalledWith({
      annotations: [{ id: 'lost1', title: 'Way down', authorName: 'QA' }],
    });

    pinManager.dispose();
    restore();
  });

  it('does not re-emit state:unplaced-changed on a tick where the lost set is unchanged', async () => {
    const restore = stubScrollHeight(500);
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="missing"]',
      path: '[data-testid="missing"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };

    const { bus, store, pinManager } = setup();
    store.upsert(makeAnnotation({ id: 'lost1', anchor, x: 0, y: 100_000 }));

    const unplacedHandler = vi.fn();
    bus.on('state:unplaced-changed', unplacedHandler);

    window.dispatchEvent(new Event('resize'));
    await tick();

    expect(unplacedHandler).not.toHaveBeenCalled();

    pinManager.dispose();
    restore();
  });
});

describe('PinManager disconnected-element re-resolve', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('re-resolves on the next layout tick once the cached element is removed, and downgrades confidence when re-resolve finds nothing', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'cta');
    document.body.appendChild(button);
    const anchor = anchorFor(button);
    const restore = stubScrollHeight(5000);

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 0, y: 0 }));

    expect(overlay.getPin('a1')!.el.dataset.wdConfidence).toBe('exact');
    expect(overlay.getPin('a1')!.getResolveCache().element).toBe(button);

    // Simulate a React/Vue re-mount removing the old node entirely with
    // nothing new matching the selector.
    button.remove();

    window.dispatchEvent(new Event('resize'));
    await tick();

    const pin = overlay.getPin('a1')!;
    expect(pin.el.dataset.wdConfidence).toBe('orphaned');
    expect(pin.el.classList.contains('wd-pin--degraded')).toBe(true);
    expect(pin.el.classList.contains('wd-pin--hidden')).toBe(false); // orphaned still renders, just dashed — never a stale position
    expect(pin.getResolveCache().element).toBeNull();

    pinManager.dispose();
    restore();
  });

  it('heals back to exact when a fresh matching element replaces the removed one (self-heals SPA re-mounts)', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'cta');
    document.body.appendChild(button);
    const anchor = anchorFor(button);

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 0, y: 0 }));
    expect(overlay.getPin('a1')!.getResolveCache().element).toBe(button);

    button.remove();
    const replacement = document.createElement('button');
    replacement.setAttribute('data-testid', 'cta');
    document.body.appendChild(replacement);

    window.dispatchEvent(new Event('resize'));
    await tick();

    const pin = overlay.getPin('a1')!;
    expect(pin.el.dataset.wdConfidence).toBe('exact');
    expect(pin.getResolveCache().element).toBe(replacement);

    pinManager.dispose();
  });

  it('keeps reusing the cached element (no stale position, no re-resolution) while it stays connected', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'cta');
    document.body.appendChild(button);
    const anchor = anchorFor(button);

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 0, y: 0 }));
    const cachedBefore = overlay.getPin('a1')!.getResolveCache().element;

    window.dispatchEvent(new Event('resize'));
    await tick();

    const cachedAfter = overlay.getPin('a1')!.getResolveCache().element;
    expect(cachedAfter).toBe(cachedBefore);
    expect(cachedAfter).toBe(button);
    expect(overlay.getPin('a1')!.el.dataset.wdConfidence).toBe('exact');

    pinManager.dispose();
  });
});

describe('PinManager teardown', () => {
  it('dispose() stops repositioning on further layout ticks', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'cta');
    document.body.appendChild(button);
    const anchor = anchorFor(button);

    const { store, overlay, pinManager } = setup();
    store.upsert(makeAnnotation({ anchor, x: 0, y: 0 }));
    pinManager.dispose();

    button.remove();
    window.dispatchEvent(new Event('resize'));
    await tick();

    // No re-resolve happened after dispose — the cache (and thus the
    // rendered confidence) is exactly as it was at dispose time.
    expect(overlay.getPin('a1')!.el.dataset.wdConfidence).toBe('exact');
    document.body.innerHTML = '';
  });
});
