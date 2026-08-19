import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rafThrottle } from './rafThrottle';

/**
 * A controllable `requestAnimationFrame` stand-in: frames are queued but
 * never fire on their own — the test decides exactly when a frame "runs" by
 * calling `flush()`. This is what lets the deadlock-recovery test simulate
 * a frame that legitimately never fires (a backgrounded tab) without a real
 * timer or a real hidden document.
 */
function installControllableRaf() {
  let queue: Array<FrameRequestCallback> = [];
  let nextId = 1;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.push(cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });

  return {
    /** Runs every currently-queued frame callback (simulates the tab becoming visible again). */
    flush(): void {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) cb(0);
    },
    pendingCount(): number {
      return queue.length;
    },
  };
}

describe('rafThrottle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coalesces multiple calls within the same frame into a single invocation', () => {
    const raf = installControllableRaf();
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled();
    throttled();
    throttled();
    expect(fn).not.toHaveBeenCalled();

    raf.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('only schedules one frame no matter how many calls arrive before it fires', () => {
    const raf = installControllableRaf();
    const throttled = rafThrottle(() => {});

    throttled();
    throttled();
    throttled();

    expect(raf.pendingCount()).toBe(1);
  });

  it('does not deadlock: if a scheduled frame never fires, later calls still coalesce and run exactly once the frame finally does fire', () => {
    const raf = installControllableRaf();
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    // Simulates a tab going into the background right after the first call:
    // a frame is scheduled but — correctly — never runs while hidden.
    throttled('first-call');
    expect(fn).not.toHaveBeenCalled();

    // More calls arrive while still "hidden" (e.g. a late scroll/resize
    // event queued up). None of these should be dropped into limbo or
    // throw for scheduling a second frame — they just update the buffered
    // args on the one pending frame.
    throttled('second-call');
    throttled('third-call');
    expect(raf.pendingCount()).toBe(1); // still only ONE frame queued, not one per call

    // Tab becomes visible again -> the browser finally runs the queued frame.
    raf.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third-call'); // only the LAST buffered call's args survive

    // Recovery check: the throttle must not be stuck "scheduled forever" —
    // a call after the frame ran schedules a fresh frame and fires normally.
    throttled('fourth-call');
    expect(raf.pendingCount()).toBe(1);
    raf.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith('fourth-call');
  });

  it('cancel() drops a pending frame and clears buffered args without calling fn', () => {
    const raf = installControllableRaf();
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled();
    throttled.cancel();
    raf.flush();

    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() is safe to call when nothing is scheduled', () => {
    const throttled = rafThrottle(vi.fn());
    expect(() => throttled.cancel()).not.toThrow();
  });
});

describe('rafThrottle against the real requestAnimationFrame', () => {
  beforeEach(() => {
    // jsdom does implement a real rAF loop tied to its own timers — a
    // sanity check against the real thing, not just the controllable stub.
  });

  it('invokes the callback asynchronously via the real rAF', async () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled();
    expect(fn).not.toHaveBeenCalled();

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
