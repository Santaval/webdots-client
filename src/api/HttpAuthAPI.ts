import type { AuthAPI, MagicLinkSession } from './AuthAPI';
import { ExpiredCodeError } from './errors';
import { httpRequest, type HttpCore, type HttpErrorMapper } from './http';

export interface HttpAuthAPIOptions {
  apiUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
}

/**
 * `fetch`-based implementation of `AuthAPI`, talking to `${apiUrl}/auth/*`.
 * Zero runtime dependencies. Reuses the shared `api/http.ts` transport so
 * timeout/abort-composition, header hygiene, and the 401/403 -> `AuthError`
 * mapping stay identical to `HttpAnnotationAPI` — only the auth-specific
 * error mapping (410 -> `ExpiredCodeError`) and the two endpoint paths live
 * here.
 *
 * `POST /auth/magic-link` returns 204 on success (no body to parse); the
 * `204 -> null` short-circuit in `httpRequest` means `requestMagicLink`
 * resolves to `void` with no JSON parsing attempted. `POST
 * /auth/magic-link/verify` returns `200` with `{ token, user }`, mapped to
 * the `MagicLinkSession` model.
 */
export class HttpAuthAPI implements AuthAPI {
  private readonly core: HttpCore;
  private readonly mapError: HttpErrorMapper;

  constructor(options: HttpAuthAPIOptions) {
    this.core = {
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      requestTimeoutMs: options.requestTimeoutMs,
    };
    // 410 is the auth-specific signal for an expired/invalid code. It runs
    // BEFORE http.ts's default 401/403/ApiError mapping; any other status
    // returns undefined and falls through to the defaults, so a 401 here
    // still surfaces as `AuthError` (a missing/invalid `x-api-key`) exactly
    // as it would on the annotations API.
    this.mapError = ({ status, url }) =>
      status === 410 ? new ExpiredCodeError(status, url) : undefined;
  }

  async requestMagicLink(email: string, signal?: AbortSignal): Promise<void> {
    // 204 No Content — httpRequest skips JSON parsing for that status.
    await httpRequest<void>(this.core, 'POST', '/auth/magic-link', { email }, signal, this.mapError);
  }

  async verifyMagicLink(code: string, signal?: AbortSignal): Promise<MagicLinkSession> {
    return httpRequest<MagicLinkSession>(this.core, 'POST', '/auth/magic-link/verify', { code }, signal, this.mapError);
  }
}
