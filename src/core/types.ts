import type { AnchorDescriptor } from '../anchor/types';
import type { PublicEvents } from './events';

export type AnnotationStatus = 'OPEN' | 'RESOLVED';

export type AnnotationPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** The widget's interaction mode. */
export type WidgetMode = 'idle' | 'annotate' | 'composing';

/**
 * Issue #21: the four preset resting spots for the floating toolbar. This is
 * the embedder-facing half of the placement config — `init({ toolbarPosition })`
 * accepts (and validates) exactly these, and they are all the config can
 * express: a free point only ever comes from the reviewer dragging the
 * toolbar or an embedder calling `handle.setToolbarPosition({ x, y })`.
 */
export type ToolbarCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Issue #21: a toolbar placement — one of the four preset corners, or a free
 * `{ x, y }` viewport-space top-left point (what a drag or an arrow-key move
 * produces). Corners re-resolve on every viewport resize (pure CSS); points
 * are clamped fully on-screen when applied and re-clamped when the viewport
 * shrinks. The stored per-`apiUrl` preference and `handle.getToolbarPosition()`
 * both use this union.
 */
export type ToolbarPosition = ToolbarCorner | { x: number; y: number };

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
  /**
   * Issue #21: moves the floating toolbar. Accepts a preset corner or a free
   * `{ x, y }` viewport point (finite numbers, clamped fully on-screen).
   * Persisted per-`apiUrl`, so it wins over `config.toolbarPosition` on every
   * subsequent load. Throws on a shape-invalid position, same fail-loud
   * contract as `init()` config validation.
   */
  setToolbarPosition(position: ToolbarPosition): void;
  getToolbarPosition(): ToolbarPosition;
  /** Defensive copy of the currently-loaded annotations. */
  getAnnotations(): readonly Annotation[];
  on<K extends keyof PublicEvents>(event: K, handler: (payload: PublicEvents[K]) => void): () => void;
  readonly version: string;
}
