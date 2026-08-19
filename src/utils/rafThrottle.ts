/**
 * Coalesces bursty calls (scroll/resize/mousemove) into at most one call
 * per animation frame. Only the LAST set of args before the frame fires is
 * used — intermediate calls are dropped, which is exactly what a
 * position-recompute wants.
 */
export interface Throttled<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

export function rafThrottle<T extends (...args: never[]) => void>(fn: T): Throttled<T> {
  let scheduled = false;
  let rafId = 0;
  let lastArgs: Parameters<T> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      const args2 = lastArgs;
      lastArgs = null;
      if (args2) fn(...args2);
    });
  }) as Throttled<T>;

  throttled.cancel = () => {
    if (scheduled) cancelAnimationFrame(rafId);
    scheduled = false;
    lastArgs = null;
  };

  return throttled;
}
