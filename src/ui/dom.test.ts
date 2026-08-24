import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, frag } from './dom';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('h()', () => {
  it('creates an element of the correct type', () => {
    const el = h('button');
    expect(el).toBeInstanceOf(HTMLButtonElement);
  });

  it('returns the created element', () => {
    const el = h('div');
    expect(el.tagName).toBe('DIV');
  });

  describe('className prop', () => {
    it('sets the class attribute (not the .className property)', () => {
      const el = h('div', { className: 'foo bar' });
      expect(el.getAttribute('class')).toBe('foo bar');
    });

    it('className is skipped when null', () => {
      const el = h('div', { className: null as unknown as string });
      expect(el.hasAttribute('class')).toBe(false);
    });
  });

  describe('style prop', () => {
    it('assigns properties to el.style via Object.assign', () => {
      const el = h('div', { style: { color: 'red', fontSize: '14px' } });
      expect(el.style.color).toBe('red');
      expect(el.style.fontSize).toBe('14px');
    });

    it('style is skipped when null', () => {
      const el = h('div', { style: null as unknown as object });
      expect(el.style.cssText).toBe('');
    });
  });

  describe('on* event handler props', () => {
    it('adds a listener for a lowercase event name', () => {
      const handler = vi.fn();
      const el = h('button', { onClick: handler });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('onMouseEnter becomes mouseenter listener', () => {
      const handler = vi.fn();
      const el = h('div', { onMouseEnter: handler });
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('skips on* props that are not functions', () => {
      const el = h('div', { onClick: 'not a function' as unknown as () => void });
      const desc = Object.getOwnPropertyDescriptor(el, 'onclick');
      expect(desc).toBeUndefined();
    });
  });

  describe('dataset prop', () => {
    it('assigns keys to el.dataset', () => {
      const el = h('div', { dataset: { wdConfidence: 'exact', wdId: '123' } });
      expect(el.dataset.wdConfidence).toBe('exact');
      expect(el.dataset.wdId).toBe('123');
    });

    it('dataset is skipped when null', () => {
      const el = h('div', { dataset: null as unknown as Record<string, string> });
      expect(Object.keys(el.dataset).length).toBe(0);
    });
  });

  describe('boolean attribute props', () => {
    it('setAttribute(key, "") when value === true', () => {
      const el = h('input', { disabled: true });
      expect(el.getAttribute('disabled')).toBe('');
    });

    it('removeAttribute when value is truthy but not exactly true', () => {
      const el = h('input', { disabled: 'yes' as unknown as boolean });
      expect(el.hasAttribute('disabled')).toBe(false);
    });

    it('removeAttribute when value is false', () => {
      const el = h('input', { disabled: false });
      expect(el.hasAttribute('disabled')).toBe(false);
    });

    it('covers hidden, checked, required, readonly, selected', () => {
      const el = h('input', { hidden: true, required: true, readonly: true, selected: true, checked: true });
      expect(el.hasAttribute('hidden')).toBe(true);
      expect(el.hasAttribute('required')).toBe(true);
      expect(el.hasAttribute('readonly')).toBe(true);
      expect(el.hasAttribute('selected')).toBe(true);
      expect(el.hasAttribute('checked')).toBe(true);
    });
  });

  describe('plain attribute props', () => {
    it('sets aria-hidden', () => {
      const el = h('div', { 'aria-hidden': 'true' });
      expect(el.getAttribute('aria-hidden')).toBe('true');
    });

    it('sets id', () => {
      const el = h('div', { id: 'my-id' });
      expect(el.id).toBe('my-id');
    });

    it('sets type', () => {
      const el = h('input', { type: 'email' });
      expect(el.getAttribute('type')).toBe('email');
    });

    it('converts non-string values to string via String()', () => {
      const el = h('div', { 'data-x': 42 as unknown as string });
      expect(el.getAttribute('data-x')).toBe('42');
    });
  });

  describe('falsy prop values are skipped', () => {
    it('skips null', () => {
      const el = h('div', { id: null as unknown as string, 'aria-hidden': null as unknown as string });
      expect(el.hasAttribute('id')).toBe(false);
      expect(el.hasAttribute('aria-hidden')).toBe(false);
    });

    it('skips undefined', () => {
      const el = h('div', { id: undefined as unknown as string });
      expect(el.hasAttribute('id')).toBe(false);
    });

    it('skips false', () => {
      const el = h('div', { id: false as unknown as string, hidden: false });
      expect(el.hasAttribute('id')).toBe(false);
      expect(el.hasAttribute('hidden')).toBe(false);
    });
  });

  describe('children', () => {
    it('appends a string as a TextNode', () => {
      const el = h('div', {}, 'hello');
      expect(el.childNodes[0]).toBeInstanceOf(Text);
      expect(el.textContent).toBe('hello');
    });

    it('appends multiple string children in order', () => {
      const el = h('div', {}, 'a', 'b', 'c');
      expect(el.textContent).toBe('abc');
    });

    it('appends a Node child directly', () => {
      const child = document.createElement('span');
      child.textContent = 'child';
      const el = h('div', {}, child);
      expect(el.firstChild).toBe(child);
    });

    it('skips null children', () => {
      const el = h('div', {}, 'a', null as unknown as string, 'b');
      expect(el.textContent).toBe('ab');
    });

    it('skips undefined children', () => {
      const el = h('div', {}, 'a', undefined as unknown as string, 'b');
      expect(el.textContent).toBe('ab');
    });

    it('skips false children', () => {
      const el = h('div', {}, 'a', false as unknown as string, 'b');
      expect(el.textContent).toBe('ab');
    });

    it('mixes Node and string children in order', () => {
      const span = document.createElement('span');
      span.textContent = 'X';
      const el = h('div', {}, 'before ', span, ' after');
      expect(el.childNodes[0]!.textContent).toBe('before ');
      expect(el.childNodes[1]).toBe(span);
      expect(el.childNodes[2]!.textContent).toBe(' after');
    });
  });

  it('works with no props and no children', () => {
    const el = h('p');
    expect(el.tagName).toBe('P');
    expect(el.childNodes.length).toBe(0);
  });

  it('works with props but no children', () => {
    const el = h('p', { id: 'para' });
    expect(el.id).toBe('para');
  });

  it('children are appended after props are applied', () => {
    const el = h('ul', { id: 'list' }, h('li', {}, 'item'));
    expect(el.id).toBe('list');
    expect(el.firstChild).toBeInstanceOf(HTMLLIElement);
  });
});

describe('frag()', () => {
  it('returns a DocumentFragment', () => {
    expect(frag()).toBeInstanceOf(DocumentFragment);
  });

  it('starts empty', () => {
    expect(frag().childNodes.length).toBe(0);
  });

  it('appends string children as TextNodes', () => {
    const f = frag('hello', ' ', 'world');
    expect(f.childNodes[0]!.textContent).toBe('hello');
    expect(f.childNodes[1]!.textContent).toBe(' ');
    expect(f.childNodes[2]!.textContent).toBe('world');
  });

  it('appends Node children directly', () => {
    const span = document.createElement('span');
    span.textContent = 'inline';
    const f = frag('text ', span);
    expect(f.childNodes[0]!.textContent).toBe('text ');
    expect(f.childNodes[1]).toBe(span);
  });

  it('skips null, undefined, and false children', () => {
    const f = frag('a', null as unknown as Node, undefined as unknown as Node, false as unknown as Node, 'b');
    expect(f.childNodes.length).toBe(2);
    expect(f.textContent).toBe('ab');
  });

  it('appends the fragment to a parent correctly', () => {
    const f = frag('joined');
    document.body.appendChild(f);
    expect(document.body.textContent).toBe('joined');
    document.body.innerHTML = '';
  });
});
