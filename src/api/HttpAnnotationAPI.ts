import type { AnnotationAPI, CreateAnnotationInput, ListAnnotationsQuery, UpdateAnnotationInput } from './AnnotationAPI';
import type { Annotation, AnnotationStatus } from '../core/types';
import { annotationFromWire, toCreateBody, toUpdateBody, type AnnotationWire } from './dto';
import { ApiError, NetworkError, TimeoutError } from './errors';

export interface HttpAnnotationAPIOptions {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
}

/**
 * `fetch`-based implementation of `AnnotationAPI`, talking to
 * `${apiUrl}/annotations`. Zero runtime dependencies — no fetch polyfill,
 * no HTTP client library.
 *
 * Every request:
 *  - sends `x-api-key` only when `apiKey` is configured;
 *  - sends `Content-Type: application/json` on bodied requests;
 *  - is bounded by `requestTimeoutMs` via an internal `AbortController`;
 *  - composes that internal timeout signal with the CALLER's `AbortSignal`
 *    (when given) so `Widget.destroy()` aborting its own controller cancels
 *    in-flight requests too — neither signal can starve the other.
 */
export class HttpAnnotationAPI implements AnnotationAPI {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: HttpAnnotationAPIOptions) {
    this.baseUrl = options.apiUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.requestTimeoutMs;
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
    const wire = await this.request<AnnotationWire[]>('GET', `/annotations${qs ? `?${qs}` : ''}`, undefined, signal);
    return wire.map(annotationFromWire);
  }

  async get(id: string, signal?: AbortSignal): Promise<Annotation> {
    const wire = await this.request<AnnotationWire>('GET', `/annotations/${encodeURIComponent(id)}`, undefined, signal);
    return annotationFromWire(wire);
  }

  async create(input: CreateAnnotationInput, signal?: AbortSignal): Promise<Annotation> {
    const body = toCreateBody(input);
    const wire = await this.request<AnnotationWire>('POST', '/annotations', body, signal);
    return annotationFromWire(wire);
  }

  async update(id: string, input: UpdateAnnotationInput, signal?: AbortSignal): Promise<Annotation> {
    const body = toUpdateBody(input);
    const wire = await this.request<AnnotationWire>('PATCH', `/annotations/${encodeURIComponent(id)}`, body, signal);
    return annotationFromWire(wire);
  }

  /** Separate endpoint from the generic `update()` — `PATCH /annotations/:id/status`. */
  async changeStatus(id: string, status: AnnotationStatus, signal?: AbortSignal): Promise<Annotation> {
    const wire = await this.request<AnnotationWire>(
      'PATCH',
      `/annotations/${encodeURIComponent(id)}/status`,
      { status },
      signal,
    );
    return annotationFromWire(wire);
  }

  async remove(id: string, signal?: AbortSignal): Promise<void> {
    // 204 No Content — request() already skips JSON parsing for that status.
    await this.request<null>('DELETE', `/annotations/${encodeURIComponent(id)}`, undefined, signal);
  }

  private async request<T>(method: string, path: string, body: unknown, callerSignal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const composed = composeSignals(callerSignal, timeoutController.signal);
    const signal = composed.signal;

    // Content-Type only when there IS a body. Setting it on bodiless GET/DELETE
    // turns an otherwise-simple CORS request into a preflighted one for no
    // benefit — and this backend's CORS config is already narrow enough that
    // avoiding avoidable preflights is worth the two extra lines.
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        // Distinguish "our own timeout fired" from "the caller aborted us"
        // by checking WHICH underlying signal tripped — the caller's abort
        // (e.g. Widget.destroy()) should propagate as-is, not be relabeled.
        if (timeoutController.signal.aborted && !callerSignal?.aborted) {
          throw new TimeoutError(url, this.timeoutMs);
        }
        throw err;
      }
      throw new NetworkError(url, err);
    } finally {
      clearTimeout(timeoutId);
      composed.dispose();
    }

    if (response.status === 204) {
      return null as T;
    }

    const text = await response.text();
    let payload: unknown;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      const serverMessage = isServerMessagePayload(payload) ? payload.message : undefined;
      throw new ApiError(response.status, url, serverMessage);
    }

    return payload as T;
  }
}

function isServerMessagePayload(payload: unknown): payload is { message: string } {
  return !!payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string';
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

interface ComposedSignal {
  signal: AbortSignal;
  /** MUST be called once the request settles — see the leak note below. */
  dispose(): void;
}

/**
 * Composes two AbortSignals into one that aborts when either does. Uses the
 * native `AbortSignal.any` where available; falls back to a manual listener
 * pair for older runtimes (no polyfill dependency either way).
 *
 * The fallback attaches listeners to the CALLER's signal, which is long-lived
 * (Widget owns one controller for the whole session). `{ once: true }` only
 * detaches them if an abort actually fires, so on the normal completion path
 * they would accumulate one per request and never be released. Callers must
 * invoke `dispose()` in a `finally` to detach them.
 */
function composeSignals(caller: AbortSignal | undefined, timeout: AbortSignal): ComposedSignal {
  if (!caller) return { signal: timeout, dispose: () => {} };

  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([caller, timeout]), dispose: () => {} };
  }

  const controller = new AbortController();
  if (caller.aborted || timeout.aborted) {
    controller.abort();
    return { signal: controller.signal, dispose: () => {} };
  }

  const onAbort = () => controller.abort();
  caller.addEventListener('abort', onAbort);
  timeout.addEventListener('abort', onAbort);
  return {
    signal: controller.signal,
    dispose: () => {
      caller.removeEventListener('abort', onAbort);
      timeout.removeEventListener('abort', onAbort);
    },
  };
}
