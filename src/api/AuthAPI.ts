/**
 * The session established by a successful magic-link verification. `token` is
 * the credential the host app (and later milestones) attach to subsequent
 * annotation requests; `user` is the server-confirmed reviewer identity,
 * which Widget writes back into `config.user` so annotation attribution
 * works without the embedder having supplied a `user` at `init()`.
 */
export interface MagicLinkSession {
  token: string;
  user: { name: string; email: string };
}

/**
 * The swappable auth boundary for reviewer magic-link sign-in, parallel to
 * `AnnotationAPI` for annotations. `HttpAuthAPI` is the default
 * implementation; `config.authApi` is a DI escape hatch that lets a consumer
 * (or a test/demo) supply any other implementation — the rest of the library
 * only ever talks to this interface, never to `fetch` directly.
 *
 * Every method takes an optional `AbortSignal` so `Widget.destroy()` can
 * cancel in-flight auth work, identical to `AnnotationAPI`. The wire shape is
 * confined to `HttpAuthAPI` (there's no separate dto module because the auth
 * payloads are tiny and not shared with any other surface).
 *
 * Server contract (assumed RESTful — Santaval/webdots#10/#11):
 *  - `POST /auth/magic-link` `{ email }` -> `204 No Content`
 *  - `POST /auth/magic-link/verify` `{ code }` -> `200` `{ token, user }`
 *  - expired/invalid code -> `410 Gone` `{ message }` (mapped to
 *    `ExpiredCodeError` by `HttpAuthAPI`).
 */
export interface AuthAPI {
  requestMagicLink(email: string, signal?: AbortSignal): Promise<void>;
  verifyMagicLink(code: string, signal?: AbortSignal): Promise<MagicLinkSession>;
}
