import type { Annotation } from './types';
import type { AnchorDescriptor } from '../anchor/types';

export interface AnchorUpgraderOptions {
  /**
   * PATCHes one upgraded anchor back for `id`. Resolves with the
   * server-returned annotation (which the Widget upserts via `onApplied`).
   * Rejections are non-fatal: a failed self-heal just leaves the pin on its
   * current (coords) anchor — graceful degradation, never a retry storm.
   */
  patch: (id: string, anchor: AnchorDescriptor, signal: AbortSignal) => Promise<Annotation>;
  /** Called for each PATCH that resolves, with the server-confirmed annotation. */
  onApplied: (annotation: Annotation) => void;
  /** The Widget's session abort signal; aborting cancels pending + in-flight work. */
  signal: AbortSignal;
  /** Debounce window (ms). Defaults to 1500. */
  flushMs?: number;
  /**
   * Predicate for ids that are safe to PATCH (i.e. already persisted by the
   * server). Optimistic `local_*` ids are skipped — their create round-trip
   * is still in flight. Defaults to "all ids live."
   */
  isLiveId?: (id: string) => boolean;
}

const DEFAULT_FLUSH_MS = 1500;

/**
 * Issue #7 self-healing write-back. PinManager detects an upgraded anchor
 * (a `coords` fallback that now resolves to a real element); this class
 * debounces those signals into PATCHed writes and prevents the write loop
 * that a no-`anchor`-column server would otherwise cause.
 *
 * **Loop prevention**: the moment an id is DISPATCHED (handed to `patch`),
 * it's added to `attempted` and never re-dispatched this session — regardless
 * of whether the PATCH succeeded, failed, or the server silently dropped the
 * field and re-synthesized `coords` on the next load. That last case is the
 * real hazard: the server returns no `anchor`, `dto.ts` re-synthesizes
 * `coords`, PinManager re-detects the upgrade, and without this guard the
 * cycle would write forever. With it, each id gets exactly one self-heal
 * attempt per session; a no-column server simply leaves the pin on coords
 * (the documented fallback), and a columned server persists it on the first
 * PATCH so PinManager never re-detects.
 *
 * **Debounce**: per-id the LATEST anchor wins (a rapidly-improving resolution
 * doesn't stack writes); a single timer coalesces a burst across ids into one
 * flush so an initial load of N legacy rows doesn't fire N immediate PATCHes.
 */
export class AnchorUpgrader {
  private pending = new Map<string, AnchorDescriptor>();
  private attempted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly patch: AnchorUpgraderOptions['patch'];
  private readonly onApplied: AnchorUpgraderOptions['onApplied'];
  private readonly signal: AbortSignal;
  private readonly flushMs: number;
  private readonly isLiveId: (id: string) => boolean;

  constructor(options: AnchorUpgraderOptions) {
    this.patch = options.patch;
    this.onApplied = options.onApplied;
    this.signal = options.signal;
    this.flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
    this.isLiveId = options.isLiveId ?? (() => true);
  }

  schedule(id: string, anchor: AnchorDescriptor): void {
    if (this.signal.aborted) return;
    if (this.attempted.has(id)) return;
    if (!this.isLiveId(id)) return;
    this.pending.set(id, anchor);
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  private flush(): void {
    this.timer = null;
    if (this.signal.aborted) {
      this.pending.clear();
      return;
    }
    const batch = this.pending;
    this.pending = new Map();
    for (const [id, anchor] of batch) {
      if (this.attempted.has(id)) continue;
      if (!this.isLiveId(id)) continue;
      this.attempted.add(id);
      void this.dispatch(id, anchor);
    }
  }

  private async dispatch(id: string, anchor: AnchorDescriptor): Promise<void> {
    try {
      const annotation = await this.patch(id, anchor, this.signal);
      if (this.signal.aborted) return;
      this.onApplied(annotation);
    } catch {
      if (this.signal.aborted) return;
      // Silent + no-retry. `attempted` was set at dispatch, so a transient
      // failure (or a no-column server) won't loop. The pin simply stays on
      // its current anchor — graceful degradation, not a user-facing error.
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }
}
