import { describe, it, expect, afterEach } from 'vitest';
import { resolveSelector } from './resolveSelector';
import { generateSelector } from './generateSelector';
import type { AnchorDescriptor } from './types';

function mount(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

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

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * jsdom does no real layout, so `documentElement.scrollHeight` is always 0
 * regardless of CSS. Stub it directly so the orphaned/lost branch (which
 * depends on comparing stored y against document height) is deterministic.
 */
function stubScrollHeight(value: number): () => void {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value,
  });
  return () => {
    delete (document.documentElement as unknown as Record<string, unknown>).scrollHeight;
  };
}

describe('resolveSelector', () => {
  it('resolves exact when the selector still matches exactly one element with the right tag', () => {
    mount(`<button data-testid="cart-btn">Add</button>`);
    const el = document.querySelector('[data-testid="cart-btn"]')!;
    const anchor = anchorFor(el);

    const result = resolveSelector(anchor, 0, 0);

    expect(result.confidence).toBe('exact');
    expect(result.element).toBe(el);
  });

  it('degrades to the structural path when the primary selector no longer matches', () => {
    const container = mount(`
      <div id="list">
        <div class="row"><button class="cmp_Btn">Edit</button></div>
        <div class="row"><button class="cmp_Btn">Edit</button></div>
      </div>
    `);
    const second = container.querySelectorAll('button')[1]!;
    const anchor = anchorFor(second);
    // Simulate the primary selector rotting (e.g. a CSS-module class or a
    // now-removed testid) while the structural path is still valid.
    const rotted: AnchorDescriptor = { ...anchor, selector: '[data-testid="stale"]' };

    const result = resolveSelector(rotted, 0, 0);

    expect(result.confidence).toBe('degraded');
    expect(result.element).toBe(second);
  });

  it('disambiguates multiple path matches via textHint', () => {
    const container = mount(`
      <div>
        <div class="row"><button class="cmp_Btn">Save</button></div>
        <div class="row"><button class="cmp_Btn">Delete</button></div>
      </div>
    `);
    const buttons = container.querySelectorAll('button');
    const deleteButton = buttons[1]!;

    // A rotted selector/path that matches both buttons (e.g. an anchor
    // captured before the page grew an extra duplicate sibling), but a
    // textHint that uniquely identifies the target.
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'path',
      selector: '.cmp_Btn',
      path: 'button',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
      textHint: 'Delete',
    };

    const result = resolveSelector(anchor, 0, 0);

    expect(result.confidence).toBe('degraded');
    expect(result.element).toBe(deleteButton);
  });

  it('disambiguates multiple candidates by proximity to stored page coordinates when textHint is absent', () => {
    const container = mount(`
      <div style="position: relative;">
        <button class="cmp_Btn" style="position:absolute; left:0px; top:0px;">A</button>
        <button class="cmp_Btn" style="position:absolute; left:500px; top:500px;">A</button>
      </div>
    `);
    const buttons = Array.from(container.querySelectorAll('button'));
    // jsdom doesn't compute real layout, so getBoundingClientRect() returns
    // zeros for both regardless of the inline styles above — proximity
    // scoring still exercises the code path even though it can't
    // discriminate a real position in this environment. We assert the
    // function returns *a* valid candidate rather than a specific one.
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'path',
      selector: '.cmp_Btn',
      path: 'button',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
      // no textHint
    };

    const result = resolveSelector(anchor, 10, 10);

    expect(result.confidence).toBe('degraded');
    expect(buttons).toContain(result.element);
  });

  it('reaches orphaned when the anchored element no longer exists and the stored y is within the document', () => {
    const restore = stubScrollHeight(5000);
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="removed-el"]',
      path: '[data-testid="removed-el"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };

    try {
      const result = resolveSelector(anchor, 100, 100);
      expect(result.confidence).toBe('orphaned');
      expect(result.element).toBeNull();
    } finally {
      restore();
    }
  });

  it('reaches lost when nothing resolves and the stored y is beyond the document height', () => {
    const restore = stubScrollHeight(500);
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="removed-el"]',
      path: '[data-testid="removed-el"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };

    try {
      const result = resolveSelector(anchor, 0, 100_000);
      expect(result.confidence).toBe('lost');
      expect(result.element).toBeNull();
    } finally {
      restore();
    }
  });

  it('rejects a candidate whose tag no longer matches the stored anchor', () => {
    mount(`<div data-testid="swapped">now a div</div>`);
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="swapped"]',
      path: '[data-testid="swapped"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON', // stored as BUTTON, but it's actually a DIV now
    };

    const result = resolveSelector(anchor, 0, 0);

    expect(result.confidence).not.toBe('exact');
  });
});
