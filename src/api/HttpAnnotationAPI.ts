import type { AnnotationAPI, CreateAnnotationInput, ListAnnotationsQuery, UpdateAnnotationInput } from './AnnotationAPI';
import type { Annotation, AnnotationStatus } from '../core/types';
import { annotationFromWire, toCreateBody, toUpdateBody, type AnnotationWire } from './dto';
import { httpRequest, type HttpCore } from './http';

export interface HttpAnnotationAPIOptions {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
}

/**
 * `fetch`-based implementation of `AnnotationAPI`, talking to
 * `${apiUrl}/annotations`. Zero runtime dependencies — no fetch polyfill,
 * no HTTP client library. The transport plumbing (timeout/abort
 * composition, header hygiene, 401/403 -> AuthError, 204 handling) lives in
 * the shared `api/http.ts` core; this module owns only the annotation
 * wire-format mapping (`dto.ts`) and the per-method URL/body shaping.
 */
export class HttpAnnotationAPI implements AnnotationAPI {
  private readonly core: HttpCore;

  constructor(options: HttpAnnotationAPIOptions) {
    this.core = {
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      requestTimeoutMs: options.requestTimeoutMs,
    };
  }

  async list(query: ListAnnotationsQuery, signal?: AbortSignal): Promise<Annotation[]> {
    const params = new URLSearchParams();
    if (query.pageUrl) params.set('pageUrl', query.pageUrl);
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));

    const qs = params.toString();
    // The backend returns a BARE array, not a wrapped envelope.
    const wire = await httpRequest<AnnotationWire[]>(this.core, 'GET', `/annotations${qs ? `?${qs}` : ''}`, undefined, signal);
    return wire.map(annotationFromWire);
  }

  async get(id: string, signal?: AbortSignal): Promise<Annotation> {
    const wire = await httpRequest<AnnotationWire>(this.core, 'GET', `/annotations/${encodeURIComponent(id)}`, undefined, signal);
    return annotationFromWire(wire);
  }

  async create(input: CreateAnnotationInput, signal?: AbortSignal): Promise<Annotation> {
    const body = toCreateBody(input);
    const wire = await httpRequest<AnnotationWire>(this.core, 'POST', '/annotations', body, signal);
    return annotationFromWire(wire);
  }

  async update(id: string, input: UpdateAnnotationInput, signal?: AbortSignal): Promise<Annotation> {
    const body = toUpdateBody(input);
    const wire = await httpRequest<AnnotationWire>(this.core, 'PATCH', `/annotations/${encodeURIComponent(id)}`, body, signal);
    return annotationFromWire(wire);
  }

  /** Separate endpoint from the generic `update()` — `PATCH /annotations/:id/status`. */
  async changeStatus(id: string, status: AnnotationStatus, signal?: AbortSignal): Promise<Annotation> {
    const wire = await httpRequest<AnnotationWire>(
      this.core,
      'PATCH',
      `/annotations/${encodeURIComponent(id)}/status`,
      { status },
      signal,
    );
    return annotationFromWire(wire);
  }

  async remove(id: string, signal?: AbortSignal): Promise<void> {
    // 204 No Content — httpRequest skips JSON parsing for that status.
    await httpRequest<null>(this.core, 'DELETE', `/annotations/${encodeURIComponent(id)}`, undefined, signal);
  }
}
