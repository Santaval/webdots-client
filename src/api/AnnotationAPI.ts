import type { Annotation, AnnotationPriority, AnnotationStatus } from '../core/types';
import type { AnchorDescriptor } from '../anchor/types';

export interface ListAnnotationsQuery {
  pageUrl?: string;
  status?: AnnotationStatus;
  priority?: AnnotationPriority;
  limit?: number;
  offset?: number;
}

export interface CreateAnnotationInput {
  pageUrl: string;
  selector: string;
  x: number;
  y: number;
  anchor: AnchorDescriptor;
  title: string;
  description?: string;
  priority?: AnnotationPriority;
  /**
   * Anonymous-mode fallback ONLY (#6): omit these when a JWT session is
   * active so the server derives authorship from the session. An embedder
   * who skips the sign-in panel by passing `config.user` supplies them
   * from that identity.
   */
  authorName?: string;
  authorEmail?: string;
}

export interface UpdateAnnotationInput {
  title?: string;
  description?: string;
  priority?: AnnotationPriority;
  selector?: string;
  x?: number;
  y?: number;
  anchor?: AnchorDescriptor;
}

/**
 * The swappable HTTP boundary. `HttpAnnotationAPI` is the default
 * implementation; `config.api` is a DI escape hatch that lets a consumer
 * (or a test/demo) supply any other implementation — the rest of the
 * library only ever talks to this interface, never to `fetch` directly.
 *
 * Every method takes an optional `AbortSignal` so `Widget.destroy()` can
 * cancel in-flight work. `Annotation` here is the library's INTERNAL model
 * — `api/dto.ts` is the only module that knows the wire shape, so backend
 * drift never reaches the UI.
 *
 * `changeStatus` is deliberately its own method, not folded into `update`:
 * the backend exposes `PATCH /annotations/:id/status` as a separate
 * endpoint from the generic `PATCH /annotations/:id`.
 *
 * `uploadScreenshot` (#8) targets the separate `POST /annotations/:id/screenshot`
 * endpoint (server Santaval/webdots#17). It receives a `data:` URL string,
 * is fire-and-forget from the create flow's perspective, and returns the
 * fully-reconciled annotation row — the same shape every other mutating
 * method returns — so `Widget` upserts it directly. Failure is non-fatal to
 * the annotation and must never roll it back — `Widget` handles that policy.
 */
export interface AnnotationAPI {
  list(query: ListAnnotationsQuery, signal?: AbortSignal): Promise<Annotation[]>;
  get(id: string, signal?: AbortSignal): Promise<Annotation>;
  create(input: CreateAnnotationInput, signal?: AbortSignal): Promise<Annotation>;
  update(id: string, input: UpdateAnnotationInput, signal?: AbortSignal): Promise<Annotation>;
  changeStatus(id: string, status: AnnotationStatus, signal?: AbortSignal): Promise<Annotation>;
  remove(id: string, signal?: AbortSignal): Promise<void>;
  /**
   * Uploads a screenshot for an existing annotation. `data` is a full
   * `data:image/...;base64,...` URL string. Returns the server-confirmed,
   * fully-reconciled annotation row (mirroring `update`/`changeStatus`) so the
   * caller can upsert it directly — the `screenshot` column (and `updatedAt`)
   * reflect the stored URL/key. Implementations should validate MIME + size
   * client-side before the network call (see `toScreenshotBody`).
   */
  uploadScreenshot(id: string, data: string, signal?: AbortSignal): Promise<Annotation>;
}
