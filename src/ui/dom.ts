/**
 * Tiny, framework-free element factory. Deliberately never touches
 * `innerHTML` — every node is built with `createElement`/`textContent` so
 * untrusted annotation text (title, description, author name) can never be
 * interpreted as markup.
 */

type Props = Record<string, unknown> | null | undefined;
type Child = Node | string | null | undefined | false;

const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'required', 'readonly', 'hidden', 'selected']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

function applyProps(el: HTMLElement, props: Props): void {
  if (!props) return;

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'className') {
      el.setAttribute('class', String(value));
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value as Partial<CSSStyleDeclaration>);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value as EventListener);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value as Record<string, string>);
    } else if (BOOLEAN_ATTRS.has(key)) {
      if (value === true) el.setAttribute(key, '');
      else el.removeAttribute(key);
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
}

/** Builds a document fragment from a list of children, same append rules as `h`. */
export function frag(...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    fragment.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return fragment;
}
