import { describe, it, expect, afterEach } from 'vitest';
import { init, destroy, version } from './index';
import type { AnnotationAPI } from './api/AnnotationAPI';

/**
 * A trivial stub AnnotationAPI so these lifecycle tests never touch the
 * real network — `init()` with no `config.api` would otherwise construct
 * an `HttpAnnotationAPI` and `autoLoad` would fire a real `fetch()` against
 * `https://api.example.com/...` on every test.
 */
function stubApi(): AnnotationAPI {
  return {
    list: async () => [],
    get: async () => {
      throw new Error('not used in these tests');
    },
    create: async () => {
      throw new Error('not used in these tests');
    },
    update: async () => {
      throw new Error('not used in these tests');
    },
    changeStatus: async () => {
      throw new Error('not used in these tests');
    },
    remove: async () => {},
    uploadScreenshot: async () => {
      throw new Error('not used in these tests');
    },
  };
}

const baseConfig = {
  apiUrl: 'https://api.example.com/api/v1',
  user: { name: 'QA Tester' },
  api: stubApi(),
};

describe('init/destroy lifecycle', () => {
  afterEach(() => {
    // Guard against a failing test leaving a widget mounted for the next one.
    destroy();
    document.body.innerHTML = '';
    // Issue #20: setAnnotationsVisible()/init() read+write a localStorage
    // key namespaced by apiUrl, which jsdom shares across tests.
    localStorage.clear();
  });

  it('exposes a semver-ish version string', () => {
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('mounts exactly one [data-webdots-root] element', () => {
    init(baseConfig);
    expect(document.querySelectorAll('[data-webdots-root]')).toHaveLength(1);
  });

  it('destroy() returns document.body to its pre-init innerHTML', () => {
    document.body.innerHTML = '<div id="host-content">hello</div>';
    const before = document.body.innerHTML;

    init(baseConfig);
    expect(document.body.innerHTML).not.toBe(before);

    destroy();
    expect(document.body.innerHTML).toBe(before);
  });

  it('destroy() without a prior init() is a safe no-op', () => {
    expect(() => destroy()).not.toThrow();
  });

  it('calling init() twice without destroy() returns the SAME handle and only one shadow root', () => {
    const first = init(baseConfig);
    const second = init(baseConfig);

    expect(second).toBe(first);
    expect(document.querySelectorAll('[data-webdots-root]')).toHaveLength(1);
  });

  it('destroy() then init() again creates a fresh handle', () => {
    const first = init(baseConfig);
    destroy();
    const second = init(baseConfig);

    expect(second).not.toBe(first);
    expect(document.querySelectorAll('[data-webdots-root]')).toHaveLength(1);
  });

  it('the returned handle exposes the WidgetHandle contract, refresh() included', async () => {
    const handle = init(baseConfig);

    expect(handle.getMode()).toBe('idle');
    expect(handle.getAnnotations()).toEqual([]);
    await expect(handle.refresh()).resolves.toBeUndefined();

    handle.setMode('annotate');
    expect(handle.getMode()).toBe('annotate');
  });

  it('the returned handle exposes the issue #20 annotation-visibility methods', () => {
    const handle = init(baseConfig);

    expect(handle.getAnnotationsVisible()).toBe(true);
    handle.setAnnotationsVisible(false);
    expect(handle.getAnnotationsVisible()).toBe(false);
    handle.setAnnotationsVisible(true);
    expect(handle.getAnnotationsVisible()).toBe(true);
  });

  it('the returned handle exposes the issue #21 toolbar-position methods', () => {
    const handle = init(baseConfig);

    expect(handle.getToolbarPosition()).toBe('bottom-right'); // the documented default
    handle.setToolbarPosition('top-left');
    expect(handle.getToolbarPosition()).toBe('top-left');
    handle.setToolbarPosition({ x: 40, y: 90 });
    expect(handle.getToolbarPosition()).toEqual({ x: 40, y: 90 });
    expect(() =>
      handle.setToolbarPosition('diagonal' as unknown as Parameters<typeof handle.setToolbarPosition>[0]),
    ).toThrow(/setToolbarPosition/);
  });
});
