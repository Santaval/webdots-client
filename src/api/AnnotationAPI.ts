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
  authorName: string;
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
 */
export interface AnnotationAPI {
  list(query: ListAnnotationsQuery, signal?: AbortSignal): Promise<Annotation[]>;
  get(id: string, signal?: AbortSignal): Promise<Annotation>;
  create(input: CreateAnnotationInput, signal?: AbortSignal): Promise<Annotation>;
  update(id: string, input: UpdateAnnotationInput, signal?: AbortSignal): Promise<Annotation>;
  changeStatus(id: string, status: AnnotationStatus, signal?: AbortSignal): Promise<Annotation>;
  remove(id: string, signal?: AbortSignal): Promise<void>;
}
