import type { EventBus } from './EventBus';
import type { Annotation, WidgetMode } from './types';

export interface AnnotationDiff {
  added: Annotation[];
  updated: Annotation[];
  removed: string[];
}

/**
 * The single source of truth: a `Map<string, Annotation>` plus the current
 * `WidgetMode`. Every mutation (`upsert`/`remove`/`replaceAll`/`setMode`)
 * emits a typed event on the bus carrying a **diff**
 * (`{ added, updated, removed }` for annotations; `{ mode }` for mode) so
 * `PinManager`/`Toolbar` can reconcile incrementally instead of
 * re-rendering everything on every change.
 */
export class Store {
  private annotations = new Map<string, Annotation>();
  private mode: WidgetMode = 'idle';
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  upsert(annotation: Annotation): void {
    const existed = this.annotations.has(annotation.id);
    this.annotations.set(annotation.id, annotation);

    const diff: AnnotationDiff = existed
      ? { added: [], updated: [annotation], removed: [] }
      : { added: [annotation], updated: [], removed: [] };
    this.bus.emit('state:annotations-changed', diff);
  }

  remove(id: string): void {
    if (!this.annotations.delete(id)) return;
    this.bus.emit('state:annotations-changed', { added: [], updated: [], removed: [id] });
  }

  /**
   * Atomically swaps an annotation's id — used to reconcile an optimistic
   * `local_...` id to the server-assigned id after a successful create.
   * Rebuilds the map preserving the ENTRY'S ORIGINAL POSITION (rather than
   * a remove()-then-upsert() pair, which would both re-append the
   * reconciled row at the end of iteration order AND fire two separate
   * diffs) so `PinManager` renumbers pins once, and the reconciled pin
   * keeps its existing number instead of jumping to the end.
   */
  replaceId(oldId: string, next: Annotation): void {
    if (oldId === next.id) {
      this.upsert(next);
      return;
    }
    if (!this.annotations.has(oldId)) {
      this.upsert(next);
      return;
    }

    const rebuilt = new Map<string, Annotation>();
    for (const [id, annotation] of this.annotations) {
      rebuilt.set(id === oldId ? next.id : id, id === oldId ? next : annotation);
    }
    this.annotations = rebuilt;
    this.bus.emit('state:annotations-changed', { added: [next], updated: [], removed: [oldId] });
  }

  /** Wholesale replace (e.g. after a list-on-init fetch in M3). Diffs against the previous set. */
  replaceAll(annotations: Annotation[]): void {
    const previousIds = new Set(this.annotations.keys());
    const nextIds = new Set(annotations.map((a) => a.id));

    const added: Annotation[] = [];
    const updated: Annotation[] = [];
    for (const annotation of annotations) {
      if (previousIds.has(annotation.id)) updated.push(annotation);
      else added.push(annotation);
    }
    const removed = [...previousIds].filter((id) => !nextIds.has(id));

    this.annotations = new Map(annotations.map((a) => [a.id, a]));
    this.bus.emit('state:annotations-changed', { added, updated, removed });
  }

  setMode(mode: WidgetMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.bus.emit('state:mode-changed', { mode });
  }

  getMode(): WidgetMode {
    return this.mode;
  }

  get(id: string): Annotation | undefined {
    return this.annotations.get(id);
  }

  getAll(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  clear(): void {
    const removed = [...this.annotations.keys()];
    this.annotations.clear();
    if (removed.length > 0) {
      this.bus.emit('state:annotations-changed', { added: [], updated: [], removed });
    }
  }
}
