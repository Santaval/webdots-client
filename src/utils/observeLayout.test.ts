import { describe, it, expect, vi, afterEach } from 'vitest';
import { observeLayout } from './observeLayout';

/** Controllable rAF — see rafThrottle.test.ts for why: precise control over when a "frame" runs. */
function installControllableRaf() {
  let queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
  return {
    flush(): void {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) cb(0);
    },
  };
}

describe('observeLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires once per frame even when scroll and resize both happen before the frame runs', () => {
    const raf = installControllableRaf();
    const onChange = vi.fn();
    const handle = observeLayout(onChange);

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalled();

    raf.flush();
    expect(onChange).toHaveBeenCalledTimes(1);

    handle.dispose();
  });

  it('a scroll on a nested element (which does not bubble) still triggers the callback via the capture-phase listener', () => {
    const raf = installControllableRaf();
    const onChange = vi.fn();
    const handle = observeLayout(onChange);

    const container = document.createElement('div');
    document.body.appendChild(container);

    // `scroll` does not bubble; only a capture-phase listener on an ancestor
    // (or `window`) sees it. This is the whole reason observeLayout binds
    // with `{ capture: true }`.
    container.dispatchEvent(new Event('scroll', { bubbles: false }));
    raf.flush();

    expect(onChange).toHaveBeenCalledTimes(1);

    container.remove();
    handle.dispose();
  });

  it('resize events trigger the callback', () => {
    const raf = installControllableRaf();
    const onChange = vi.fn();
    const handle = observeLayout(onChange);

    window.dispatchEvent(new Event('resize'));
    raf.flush();

    expect(onChange).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it('a ResizeObserver callback on documentElement/body triggers the throttled callback', () => {
    const raf = installControllableRaf();

    const captured: { cb?: ResizeObserverCallback } = {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        captured.cb = cb;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const onChange = vi.fn();
    const handle = observeLayout(onChange);

    expect(observe).toHaveBeenCalledWith(document.documentElement);
    expect(observe).toHaveBeenCalledWith(document.body);

    captured.cb?.([], {} as ResizeObserver);
    raf.flush();

    expect(onChange).toHaveBeenCalledTimes(1);

    handle.dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully without ResizeObserver: scroll/resize still work, and dispose() does not throw', () => {
    const raf = installControllableRaf();
    vi.stubGlobal('ResizeObserver', undefined);

    const onChange = vi.fn();
    const handle = observeLayout(onChange);

    window.dispatchEvent(new Event('resize'));
    raf.flush();
    expect(onChange).toHaveBeenCalledTimes(1);

    expect(() => handle.dispose()).not.toThrow();
  });

  it('dispose() removes every listener and the ResizeObserver so nothing fires afterward', () => {
    const raf = installControllableRaf();
    const disconnect = vi.fn();
    class FakeResizeObserver {
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const onChange = vi.fn();
    const handle = observeLayout(onChange);
    handle.dispose();

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    raf.flush();

    expect(onChange).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('dispose() is idempotent', () => {
    installControllableRaf();
    const handle = observeLayout(vi.fn());
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });
});
