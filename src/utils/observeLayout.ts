import { rafThrottle } from './rafThrottle';

export interface ObserveLayoutHandle {
  /** Removes every listener/observer this call registered. Idempotent. */
  dispose(): void;
}

/**
 * Merges three independent sources of "the page's layout may have changed"
 * into a single rAF-throttled callback:
 *  - `scroll`, captured (`{ capture: true }`) so scrolling INSIDE a nested
 *    scroll container fires too, not just window-level scroll — `scroll`
 *    does not bubble, so a bubble-phase listener on `window` would miss it.
 *  - `resize` (viewport resize — e.g. rotating a device or a responsive
 *    breakpoint change).
 *  - A `ResizeObserver` on `document.documentElement` and `document.body`,
 *    which catches CONTENT-height changes that report neither a `scroll`
 *    nor a `resize` event (e.g. a collapsed accordion changing page height
 *    without the viewport itself resizing or the page scrolling).
 *
 * All three funnel through one `rafThrottle`'d callback, so a burst of
 * scroll+resize+RO events in the same frame still only recomputes once.
 *
 * `ResizeObserver` is feature-detected — its absence (very old Safari, or a
 * restrictive test environment) degrades gracefully to scroll+resize only,
 * it is never polyfilled (zero runtime dependencies).
 *
 * rAF throttling and background tabs: `requestAnimationFrame` callbacks are
 * suspended (not cancelled) while a tab is hidden and resume firing once it
 * is foregrounded again — a layout recompute that "should" happen while
 * hidden is legitimately deferred, not lost. `rafThrottle` itself cannot
 * deadlock in that window: every call while a frame is already scheduled
 * just overwrites the buffered args (`lastArgs`) rather than queuing a
 * second frame, and the single pending frame — whenever it eventually fires
 * — flips `scheduled` back to `false` before invoking the callback, so the
 * very next call schedules a fresh frame normally. See rafThrottle.test.ts.
 */
export function observeLayout(onChange: () => void): ObserveLayoutHandle {
  const throttled = rafThrottle(onChange);

  window.addEventListener('scroll', throttled, { capture: true, passive: true });
  window.addEventListener('resize', throttled);

  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => throttled());
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);
  }

  let disposed = false;

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('scroll', throttled, true);
      window.removeEventListener('resize', throttled);
      throttled.cancel();
      resizeObserver?.disconnect();
    },
  };
}
