/**
 * Collects teardown functions and runs them all on `dispose()`, in reverse
 * registration order (so the most-recently-acquired resource is released
 * first — mirrors normal stack unwinding). Idempotent: calling `dispose()`
 * more than once is a no-op after the first call. One disposer throwing
 * does not stop the rest from running.
 */
export class Disposables {
  private fns: Array<() => void> = [];
  private disposed = false;

  add(fn: () => void): () => void {
    if (this.disposed) {
      // Already torn down — run it immediately so callers registering late
      // (e.g. during teardown) don't leak.
      fn();
      return () => {};
    }
    this.fns.push(fn);
    return () => this.remove(fn);
  }

  private remove(fn: () => void): void {
    const index = this.fns.indexOf(fn);
    if (index !== -1) this.fns.splice(index, 1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const fns = this.fns.splice(0, this.fns.length);
    for (let i = fns.length - 1; i >= 0; i--) {
      try {
        fns[i]?.();
      } catch (err) {
        console.error('[webdots] disposer threw during teardown', err);
      }
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
