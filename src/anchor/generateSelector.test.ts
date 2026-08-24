import { describe, it, expect, afterEach } from 'vitest';
import { generateSelector } from './generateSelector';

function mount(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('generateSelector', () => {
  it('prefers a testid attribute when present', () => {
    mount(`<button data-testid="cart-btn">Add to cart</button>`);
    const el = document.querySelector('[data-testid="cart-btn"]')!;

    const result = generateSelector(el);

    expect(result.strategy).toBe('testid');
    expect(result.selector).toBe('[data-testid="cart-btn"]');
    expect(result.tag).toBe('BUTTON');
  });

  it('respects a custom testIdAttributes list', () => {
    mount(`<button data-qa-id="save">Save</button>`);
    const el = document.querySelector('[data-qa-id="save"]')!;

    const result = generateSelector(el, { testIdAttributes: ['data-qa-id'] });

    expect(result.strategy).toBe('testid');
    expect(result.selector).toBe('[data-qa-id="save"]');
  });

  it('falls through an unstable numeric id to the next strategy', () => {
    mount(`<div id="item-38291" name="unused"><span>hi</span></div>`);
    const el = document.querySelector('#item-38291')!;

    const result = generateSelector(el);

    expect(result.strategy).not.toBe('id');
  });

  it('falls through a React useId-shaped id', () => {
    // jsdom won't let us set id=":r1:" via the id attribute directly through
    // querySelector escaping concerns, so use setAttribute.
    const container = mount(`<div><button>click</button></div>`);
    const el = container.querySelector('button')!;
    el.setAttribute('id', ':r1:');

    const result = generateSelector(el);

    expect(result.strategy).not.toBe('id');
  });

  it('falls through a hex-hash-shaped id (CSS-module style)', () => {
    mount(`<div id="a1b2c3d4"><span>x</span></div>`);
    const el = document.querySelector('#a1b2c3d4')!;

    const result = generateSelector(el);

    expect(result.strategy).not.toBe('id');
  });

  it('accepts a stable, human-authored id', () => {
    mount(`<div id="checkout-panel"><span>x</span></div>`);
    const el = document.querySelector('#checkout-panel')!;

    const result = generateSelector(el);

    expect(result.strategy).toBe('id');
    expect(result.selector).toBe('[id="checkout-panel"]');
  });

  it('uses [name] for form controls', () => {
    mount(`<input name="email" />`);
    const el = document.querySelector('input[name="email"]')!;

    const result = generateSelector(el);

    expect(result.strategy).toBe('name');
    expect(result.selector).toBe('input[name="email"]');
  });

  it('uses aria-label when present and unique', () => {
    mount(`<button aria-label="Close">X</button>`);
    const el = document.querySelector('[aria-label="Close"]')!;

    const result = generateSelector(el);

    expect(result.strategy).toBe('aria');
    expect(result.selector).toBe('button[aria-label="Close"]');
  });

  it('excludes classes from the structural path entirely', () => {
    const container = mount(`
      <div class="cmp_Card__x7f2a">
        <button class="cmp_Btn__z4m8p">Action</button>
      </div>
    `);
    const el = container.querySelector('button')!;

    const result = generateSelector(el);

    expect(result.path).not.toContain('cmp_');
    expect(result.path).not.toContain('.');
  });

  it('disambiguates duplicate sibling structures via nth-of-type in the path', () => {
    const container = mount(`
      <div id="list">
        <div class="row"><button class="cmp_Btn">Edit</button></div>
        <div class="row"><button class="cmp_Btn">Edit</button></div>
        <div class="row"><button class="cmp_Btn">Edit</button></div>
      </div>
    `);
    const buttons = container.querySelectorAll('button');
    const second = buttons[1]!;

    const result = generateSelector(second);

    // No testid/id/name/aria available anywhere in this fragment, so it
    // must fall all the way to the structural path, which must uniquely
    // resolve back to the second button via nth-of-type.
    expect(result.strategy).toBe('path');
    expect(result.path).toContain('nth-of-type(2)');
    expect(document.querySelectorAll(result.path)).toHaveLength(1);
    expect(document.querySelector(result.path)).toBe(second);
  });

  it('caps the structural path at 8 levels', () => {
    // Build a deeply nested chain with no stable ancestors anywhere.
    let html = '<span>deep</span>';
    for (let i = 0; i < 15; i++) html = `<div>${html}</div>`;
    const container = mount(html);
    const el = container.querySelector('span')!;

    const result = generateSelector(el);

    const segments = result.path.split(' > ');
    expect(segments.length).toBeLessThanOrEqual(8);
  });

  it('stops the structural path at the nearest stable ancestor', () => {
    const container = mount(`
      <div data-testid="panel">
        <div>
          <div>
            <span>target</span>
          </div>
        </div>
      </div>
    `);
    const el = container.querySelector('span')!;

    const result = generateSelector(el);

    expect(result.path.startsWith('[data-testid="panel"]')).toBe(true);
  });

  it('falls back to coords/body when nothing else resolves uniquely', () => {
    // A bare, unstyled, un-attributed body click.
    const result = generateSelector(document.body);

    expect(result.strategy === 'path' || result.strategy === 'coords').toBe(true);
  });

  it('always computes path even when an earlier strategy wins', () => {
    mount(`<button data-testid="unique-btn">Go</button>`);
    const el = document.querySelector('[data-testid="unique-btn"]')!;

    const result = generateSelector(el);

    expect(result.strategy).toBe('testid');
    expect(result.path).toBeTruthy();
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('captures a textHint from trimmed textContent, capped at 40 chars', () => {
    mount(`<button data-testid="long-text-btn">   This is a very long button label that goes on and on   </button>`);
    const el = document.querySelector('[data-testid="long-text-btn"]')!;

    const result = generateSelector(el);

    expect(result.textHint).toBeDefined();
    expect(result.textHint!.length).toBeLessThanOrEqual(40);
    expect(result.textHint!.startsWith('This is a very long')).toBe(true);
  });

  /**
   * Regression: the depth cap used to trim the combined array from the front,
   * which silently discarded the stable-ancestor prefix — the one segment that
   * makes the path anchored instead of a floating chain matching half the page.
   */
  describe('structural path depth cap', () => {
    it('keeps the stable-ancestor prefix when the walk hits the depth cap', () => {
      mount(
        '<section data-testid="panel">' +
          '<div><div><div><div><div><div><div>' +
          '<span class="target">hi</span>' +
          '</div></div></div></div></div></div></div>' +
          '</section>',
      );
      const target = document.querySelector('.target')!;
      const result = generateSelector(target, { testIdAttributes: ['data-testid'] });

      expect(result.path.startsWith('[data-testid="panel"]')).toBe(true);
      expect(document.querySelectorAll(result.path)).toHaveLength(1);
    });

    it('still caps the number of structural segments', () => {
      mount(
        '<div><div><div><div><div><div><div><div><div><div>' +
          '<span class="target">hi</span>' +
          '</div></div></div></div></div></div></div></div></div></div>',
      );
      const target = document.querySelector('.target')!;
      const result = generateSelector(target, {});
      // No stable ancestor exists here, so every segment is structural.
      expect(result.path.split(' > ')).toHaveLength(8);
    });
  });

  /**
   * Regression: a bare /[0-9a-f]{6,}/ rejected authored ids built entirely from
   * a-f letters, demoting a perfectly stable id to a fragile structural path.
   */
  describe('generated-id heuristics', () => {
    it.each([
      'facade',
      'decade',
      'sidebar',
      'main-header',
      'checkout-form',
      // Authored ids that legitimately contain digits.
      'step1',
      'section2',
      'h1-heading',
    ])(
      'accepts the authored id %s',
      (id) => {
        mount(`<div id="${id}">x</div>`);
        const result = generateSelector(document.getElementById(id)!);
        expect(result.strategy).toBe('id');
        expect(result.selector).toBe(`[id="${id}"]`);
      },
    );

    it.each(['a3f9c2', 'css-1x2y3z', 'item-38291', ':r1:', 'user-7f3a9b1c'])(
      'rejects the generated id %s',
      (id) => {
        mount(`<div id="${id}">x</div>`);
        const result = generateSelector(document.getElementById(id)!);
        expect(result.strategy).not.toBe('id');
      },
    );
  });
});
