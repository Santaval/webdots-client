import type { AnchorDescriptor } from '../anchor/types';
import type { PublicEvents } from './events';

export type AnnotationStatus = 'OPEN' | 'RESOLVED';

export type AnnotationPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** The widget's interaction mode. */
export type WidgetMode = 'idle' | 'annotate' | 'composing';

/**
 * Full annotation domain model, defined now so later milestones (API client,
 * pins, forms) don't have to churn the shape. `anchor` is nullable to cover
 * legacy rows created before the anchor column existed.
 */
export interface Annotation {
  id: string;
  pageUrl: string;
  selector: string;
  x: number;
  y: number;
  anchor: AnchorDescriptor | null;
  title: string;
  description?: string;
  status: AnnotationStatus;
  priority: AnnotationPriority;
  authorName: string;
  authorEmail?: string;
  screenshot?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Handed to `config.captureScreenshot` when a reviewer creates an annotation,
 * so the embedder can rasterize the clicked element (or the viewport) however
 * it likes — html2canvas, modern-screenshot, a headless service, etc. The
 * library ships NO rasterizer itself: a canvas-based one would blow the
 * 25 KB gzip budget, and the SVG `foreignObject` technique is unreliable on
 * real pages (cross-origin images taint the canvas; external stylesheets and
 * web fonts are not applied). Returning a `data:` URL string uploads it;
 * returning null/undefined skips the upload silently. Throwing/rejecting is
 * non-fatal to the annotation and surfaces via `onError` + toast.
 */
export interface ScreenshotContext {
  /** The element the reviewer clicked to start the annotation. */
  target: Element;
  /** Click coordinates in document/page space (same space as `Annotation.x/y`). */
  pageX: number;
  pageY: number;
  /** Current viewport size at capture time. */
  viewportW: number;
  viewportH: number;
  /** The in-flight annotation fields the reviewer is about to submit. */
  title: string;
  description?: string;
  priority: AnnotationPriority;
}

/** The object returned by `init()` / exposed to consumers. */
export interface WidgetHandle {
  destroy(): void;
  /** Re-fetch + re-render for the current pageKey. Call this after SPA route changes. */
  refresh(): Promise<void>;
  setMode(mode: WidgetMode): void;
  getMode(): WidgetMode;
  show(): void;
  hide(): void;
  /**
   * Issue #20: shows/hides annotations (pins/overlay/popovers) only — the
   * toolbar stays usable. Distinct from `show()`/`hide()`, which affect the
   * whole widget. Persisted per-`apiUrl`.
   */
  setAnnotationsVisible(visible: boolean): void;
  getAnnotationsVisible(): boolean;
  /** Defensive copy of the currently-loaded annotations. */
  getAnnotations(): readonly Annotation[];
  on<K extends keyof PublicEvents>(event: K, handler: (payload: PublicEvents[K]) => void): () => void;
  readonly version: string;
}
