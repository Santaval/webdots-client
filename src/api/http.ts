import { ApiError, AuthError, NetworkError, TimeoutError } from './errors';

/**
 * Shared `fetch` transport used by every HTTP-backed API implementation
 * (`HttpAnnotationAPI`, `HttpAuthAPI`). Centralizing the request core here
 * keeps the timeout/abort-composition, header-hygience, and error-mapping
 * rules in ONE place so the two API surfaces can't drift — the wire format
 * itself still lives in each API's own module (`dto.ts` for annotations),
 * only the transport plumbing is shared.
 *
 * Behaviour contract (preserved verbatim from the original
 * `HttpAnnotationAPI.request<T>()` so its test suite remains the regression
 * net):
 *  - sends `x-api-key` only when `apiKey` is configured;
 *  - sends `Content-Type: application/json` only on bodied requests (a
 *    Content-Type on a bodiless GET/DELETE needlessly forces a CORS
 *    preflight);
 *  - is bounded by `requestTimeoutMs` via an internal `AbortController`,
 *    composed with the caller's `AbortSignal` so `Widget.destroy()` aborting
 *    its own controller cancels in-flight requests too — neither signal can
 *    starve the other, and the composed-signal listeners are detached in a
 *    `finally` so they never accumulate on a long-lived caller signal;
 *  - distinguishes "our own timeout fired" (-> `TimeoutError`) from "the
 *    caller aborted us" (propagated as-is, NOT relabelled);
 *  - 204 No Content -> `null` (no JSON parsing attempted);
 *  - 401/403 -> `AuthError` with fixed auth copy, ignoring any server body;
 *  - other 4xx -> `ApiError` surfacing the server's `{ message }` verbatim;
 *  - 5xx -> `ApiError` with generic copy (the server body is never leaked).
 *
 * `mapError` is an optional hook run BEFORE the default 401/403/ApiError
 * mapping. If it returns an `Error`, that error is thrown; returning
 * `undefined` falls through to the default mapping. `HttpAuthAPI` uses it to
 * turn 410 (expired/invalid magic-link code) into a branchable
 * `ExpiredCodeError` without `HttpAnnotationAPI` having to know such a
 * status exists.
 */
export interface HttpCore {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
}

export interface HttpErrorMapContext {
  status: number;
  url: string;
  serverMessage: string | undefined;
  payload: unknown;
}

export type HttpErrorMapper = (ctx: HttpErrorMapContext) => Error | undefined;

export async function httpRequest<T>(
  core: HttpCore,
  method: string,
  path: string,
  body: unknown,
  callerSignal?: AbortSignal,
  mapError?: HttpErrorMapper,
): Promise<T> {
  const baseUrl = core.apiUrl.replace(/\/+$/, '');
  const url = `${baseUrl}${path}`;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), core.requestTimeoutMs);
  const composed = composeSignals(callerSignal, timeoutController.signal);
  const signal = composed.signal;

  // Content-Type only when there IS a body. Setting it on bodiless GET/DELETE
  // turns an otherwise-simple CORS request into a preflighted one for no
  // benefit — and this backend's CORS config is already narrow enough that
  // avoiding avoidable preflights is worth the two extra lines.
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (core.apiKey) headers['x-api-key'] = core.apiKey;

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
        throw new TimeoutError(url, core.requestTimeoutMs);
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
    if (mapError) {
      const mapped = mapError({ status: response.status, url, serverMessage, payload });
      if (mapped) throw mapped;
    }
    // 401/403 are auth failures first, HTTP errors second — a missing or
    // invalid `x-api-key` must read as an auth problem at a glance, not as
    // the generic status copy a bodyless 401 would otherwise produce. The
    // server's own message is deliberately ignored here so the auth hint is
    // always identical — see errors.ts's module doc.
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(response.status, url);
    }
    throw new ApiError(response.status, url, serverMessage);
  }

  return payload as T;
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
