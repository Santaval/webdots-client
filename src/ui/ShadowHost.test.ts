import { afterEach, describe, expect, it } from 'vitest';
import { ShadowHost } from './ShadowHost';

function createHost(zIndex = 2147483000): ShadowHost {
  return new ShadowHost({ container: document.body, zIndex, theme: 'auto' });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ShadowHost', () => {
  it('mounts an open shadow root under the container', () => {
    const host = createHost();
    expect(document.querySelectorAll('[data-webdots-root]')).toHaveLength(1);
    expect(host.shadowRoot).toBeTruthy();
    expect(host.host.shadowRoot).toBe(host.shadowRoot);
  });

  it('applies the stylesheet inside the shadow root, not the document', () => {
    const host = createHost();
    // jsdom lacks adoptedStyleSheets, so the <style> fallback must be exercised.
    const style = host.shadowRoot.querySelector('style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('.wd-toolbar');
    // The host page's document must never receive our CSS.
    expect(document.head.querySelector('style')).toBeNull();
  });

  /**
   * Regression guard. Plain inline styles lose to author `!important` rules,
   * which real host pages ship (`* { margin: 3px !important }`). Without
   * important priority the page repaints our full-viewport layer and, because
   * font/line-height inherit across the shadow boundary, restyles the widget.
   */
  it('pins every host style at important priority so author !important cannot win', () => {
    const host = createHost();
    const { style } = host.host;

    const mustBeImportant = [
      'all',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'margin',
      'padding',
      'border',
      'outline',
      'background',
      'z-index',
      'pointer-events',
    ];

    for (const property of mustBeImportant) {
      expect(
        style.getPropertyPriority(property),
        `${property} must be set with !important`,
      ).toBe('important');
    }
  });

  it('declares `all: initial` before the explicit overrides that follow it', () => {
    const { host } = createHost();
    const properties = Array.from(host.style);
    expect(properties[0]).toBe('all');
    expect(properties.indexOf('position')).toBeGreaterThan(0);
  });

  it('honours the configured z-index', () => {
    const { host } = createHost(500);
    expect(host.style.getPropertyValue('z-index')).toBe('500');
  });

  it('is click-through at the host level', () => {
    const { host } = createHost();
    expect(host.style.getPropertyValue('pointer-events')).toBe('none');
  });

  it('removes itself cleanly', () => {
    const host = createHost();
    host.remove();
    expect(document.querySelector('[data-webdots-root]')).toBeNull();
  });
});
