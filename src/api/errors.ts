/**
 * Error-copy decision (open question 1 in the plan): for 4xx responses, the
 * server's own `message` is the most accurate thing available — surfaced
 * VERBATIM even though today's backend returns it in Spanish
 * ("El título es requerido"). For 5xx, network failures, and timeouts, a
 * raw server/stack trace is an implementation detail no QA user should see,
 * so those get generic English copy instead.
 *
 * 401/403 are the ONE exception to the verbatim-4xx rule. Once the server
 * enforces API keys (`REQUIRE_API_KEY`, Santaval/webdots#7), a missing or
 * invalid key must read as an AUTH problem at a glance, not as the generic
 * "Request to … failed with status 401." copy a bodyless 401 would
 * otherwise produce. `AuthError` therefore carries fixed English auth copy
 * regardless of any server body, so a QA user always sees the same clear
 * hint to fix their `apiKey`. It subclasses `ApiError` so anything that
 * branches on `ApiError` (status, url) keeps working unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly serverMessage: string | undefined;

  constructor(status: number, url: string, serverMessage?: string) {
    const message =
      status >= 400 && status < 500 && serverMessage ? serverMessage : `Request to ${url} failed with status ${status}.`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.serverMessage = serverMessage;
  }
}

/**
 * 401/403 from the annotations API — the `x-api-key` is missing, wrong, or
 * not allow-listed by the server. Fixed copy (not the server's message) so
 * an auth failure is always recognizable, per the errors.ts module doc.
 */
export class AuthError extends ApiError {
  constructor(status: number, url: string) {
    super(status, url);
    this.message = 'Authentication failed — your API key is missing or invalid.';
    this.name = 'AuthError';
  }
}

/**
 * 410 Gone from `/auth/magic-link/verify` — the submitted code has expired
 * (or was never valid). Fixed copy (not the server's message), mirroring
 * `AuthError`'s reasoning: an expired code is a recognizable, recoverable
 * state the UI branches on (the AuthPanel shows its dedicated expired-code
 * surface + "Resend"), so the hint must always read identically rather than
 * echo whatever the server happened to return. The server body is therefore
 * NOT forwarded, exactly like `AuthError`.
 *
 * Subclasses `ApiError` so anything branching on `ApiError` (status, url)
 * keeps working, and so `HttpAuthAPI` can surface it through the shared
 * `api/http.ts` `mapError` hook without `HttpAnnotationAPI` knowing a 410
 * exists. Stays internal — the AuthPanel receives an `expired` boolean on
 * `state:auth-state-changed`, never this type, so it need not import the
 * error hierarchy (same "error types stay confined to api/" rule that keeps
 * `NetworkError`/`TimeoutError` out of the public surface).
 */
export class ExpiredCodeError extends ApiError {
  constructor(status: number, url: string) {
    super(status, url);
    this.message = 'That sign-in code has expired or is invalid — request a new one.';
    this.name = 'ExpiredCodeError';
  }
}

/** fetch itself failed (offline, DNS, CORS, connection refused…), not an HTTP error response. */
export class NetworkError extends Error {
  readonly url: string;
  readonly cause: unknown;

  constructor(url: string, cause?: unknown) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Unable to reach the server at ${url}${detail}`);
    this.name = 'NetworkError';
    this.url = url;
    this.cause = cause;
  }
}

/** The request exceeded `config.requestTimeoutMs` before a response arrived. */
export class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}
