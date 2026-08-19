/**
 * Error-copy decision (open question 1 in the plan): for 4xx responses, the
 * server's own `message` is the most accurate thing available — surfaced
 * VERBATIM even though today's backend returns it in Spanish
 * ("El título es requerido"). For 5xx, network failures, and timeouts, a
 * raw server/stack trace is an implementation detail no QA user should see,
 * so those get generic English copy instead.
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
