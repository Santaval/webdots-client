# @webdots/annotate-client

A framework-agnostic, zero-dependency library that QA teams embed on any web page to leave visual annotations, BugHerd/Marker.io style. Click an element, describe the problem, and a pin stays anchored to that element across scrolling, responsive reflow, and SPA re-renders.

The entire UI lives in a Shadow DOM root, so it neither leaks CSS into the host page nor inherits the host page's styles — even against `!important` rules.

- **No dependencies.** Nothing ships in the bundle but this library.
- **No framework.** Vanilla TypeScript; works alongside React, Vue, Angular, or plain HTML.
- **~14 KB gzipped** (UMD).

---

## Install

### Via `<script>` (no bundler)

```html
<script src="https://your-cdn/webdots.umd.js"></script>
<script>
  window.Webdots.init({
    apiUrl: 'https://api.example.com/api/v1',
    apiKey: 'your-project-key',
    user: { name: 'Dana Reyes', email: 'dana@example.com' },
  });
</script>
```

The UMD build exposes `window.Webdots = { init, destroy, version }`.

### Via npm

```bash
npm install @webdots/annotate-client
```

```ts
import { init } from '@webdots/annotate-client';

const widget = init({
  apiUrl: 'https://api.example.com/api/v1',
  apiKey: 'your-project-key',
  user: { name: 'Dana Reyes', email: 'dana@example.com' },
});

// later
widget.destroy();
```

Only `apiUrl` is required at the type level; `user` is optional — when omitted, the widget mounts a magic-link sign-in panel and the reviewer establishes their identity (and `user`) at runtime. `apiKey` is additionally required when targeting the hosted webdots server (see [Authentication](#authentication)). Everything else has a sensible default.

---

## Configuration

`init(config)` validates eagerly and throws a clear `Error` on invalid input, so a misconfigured page fails loudly at startup rather than deep inside a later network call.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `apiUrl` | `string` | — | **Required.** Base URL of the annotations API, e.g. `https://api.example.com/api/v1`. Must be an absolute URL. |
| `apiKey` | `string` | — | **Required for the hosted webdots server** (sent as the `x-api-key` header on every request). Omit only for a custom `config.api` backend or a self-hosted backend with `REQUIRE_API_KEY` disabled. See [Authentication](#authentication). |
| `user` | `{ name: string; email?: string }` | — | Reviewer identity for annotation attribution. **Optional.** Omit it to mount the magic-link sign-in panel (see [Reviewer sign-in](#reviewer-sign-in)); pass it only to skip the panel when the embedder already knows the reviewer and a session is not used — it is now an **anonymous-mode fallback** (see [Deriving author identity from the session](#deriving-author-identity-from-the-session)). Supplying it alongside an active session is deprecated and logs a warning. |
| `pageKey` | `string \| (url: URL) => string` | `origin + pathname` | How annotations are scoped to a page. The default drops query string and hash so `?utm_source=…` doesn't create a separate bucket. Resolved **once** at `init()`. |
| `autoLoad` | `boolean` | `true` | Fetch and render existing annotations on init. |
| `showResolved` | `boolean` | `false` | Render resolved annotations. When `false`, resolving an annotation removes its pin. |
| `container` | `HTMLElement` | `document.body` | Where the shadow host is mounted. |
| `zIndex` | `number` | `2147483000` | Stacking order of the widget layer. |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | `'auto'` follows `prefers-color-scheme`. |
| `ignoreSelector` | `string` | — | CSS selector for elements that can never be annotated. |
| `testIdAttributes` | `string[]` | `['data-testid','data-test','data-qa','data-cy']` | Attributes preferred when generating a stable selector. |
| `requestTimeoutMs` | `number` | `10000` | Per-request timeout. |
| `debug` | `boolean` | `false` | Verbose namespaced console logging. |
| `api` | `AnnotationAPI` | — | Escape hatch: supply your own transport. Overrides `apiUrl`/`apiKey`. See [Custom backend](#custom-backend). |
| `onError` | `(error: Error) => void` | — | Called on every failure path (network, timeout, validation, failed mutation). |
| `onAnnotationCreated` | `(a: Annotation) => void` | — | Called once per creation, with the **server-confirmed** annotation. |
| `onModeChange` | `(mode: WidgetMode) => void` | — | Called when the widget switches between `'idle'`, `'annotate'`, and `'composing'`. |

---

## The handle

`init()` returns a `WidgetHandle`:

```ts
interface WidgetHandle {
  destroy(): void;                    // full teardown; idempotent
  refresh(): Promise<void>;           // re-fetch and re-render for the current pageKey
  setMode(mode: WidgetMode): void;    // 'idle' | 'annotate' | 'composing'
  getMode(): WidgetMode;
  show(): void;                       // hide/show the widget chrome without tearing down
  hide(): void;
  getAnnotations(): readonly Annotation[];  // defensive copy
  on<K extends keyof PublicEvents>(event: K, handler: (payload: PublicEvents[K]) => void): () => void;
  readonly version: string;
}
```

`on()` returns an unsubscribe function. Public events are `'state:mode-changed'` and `'state:visibility-changed'`.

Calling `init()` twice without `destroy()` logs a warning and returns the existing handle — it never creates a second shadow root.

### Single-page apps

`pageKey` is resolved once at `init()`. This library deliberately does not monkey-patch `history.pushState`, so on a route change call `refresh()` yourself:

```ts
router.afterEach(() => widget.refresh());
```

---

## Custom backend

The HTTP layer is swappable. Implement `AnnotationAPI` and pass it as `config.api`:

```ts
import { init, type AnnotationAPI } from '@webdots/annotate-client';

const myApi: AnnotationAPI = {
  list:               (query, signal) => { /* … */ },
  get:                (id, signal) => { /* … */ },
  create:             (input, signal) => { /* … */ },
  update:             (id, input, signal) => { /* … */ },
  changeStatus:       (id, status, signal) => { /* … */ },
  remove:             (id, signal) => { /* … */ },
  uploadScreenshot:   (id, data, signal) => { /* … */ },
};

init({ apiUrl: 'https://unused.example', user: { name: 'QA' }, api: myApi });
```

Every method receives an `AbortSignal` so `destroy()` can cancel in-flight work. All methods return the internal `Annotation` model — the wire format is confined to a single mapping module, so backend drift never reaches the UI.

---

## Screenshots (opt-in)

The `Annotation.screenshot` field exists on the model but the library ships **no rasterizer** — a canvas-based one (html2canvas is ~100+ KB) would blow the 25 KB gzip budget, and the SVG `foreignObject` technique is unreliable on real pages (cross-origin images taint the canvas; external stylesheets and web fonts aren't applied). Instead, capture is **opt-in via a callback** you supply, so the weight stays outside the bundle:

```ts
import { init, type ScreenshotContext } from '@webdots/annotate-client';
import html2canvas from 'html2canvas';

const widget = init({
  apiUrl: 'https://api.webdots.app/api/v1',
  apiKey: 'your-project-key',
  user: { name: 'QA' },
  captureScreenshot: async (ctx: ScreenshotContext) => {
    // ctx.target      — the element the reviewer clicked
    // ctx.pageX/pageY — click coordinates in document space
    // ctx.viewportW/H — current viewport size
    // ctx.title/description/priority — the in-flight annotation fields
    const canvas = await html2canvas(ctx.target, { backgroundColor: '#ffffff' });
    return canvas.toDataURL('image/png'); // a data: URL; return null to skip
  },
});
```

When a reviewer creates an annotation, the callback runs **in parallel** with the network create. After the annotation is saved, the captured `data:` URL is uploaded to `POST /annotations/:id/screenshot` (server issue Santaval/webdots#17) and the returned, server-confirmed row replaces the local one — so the pin/card renders the stored screenshot on the next paint.

**Failure is non-fatal.** If the callback throws/rejects, or the upload fails, the error surfaces via `onError` and a toast, but **the annotation is never lost or rolled back** — the screenshot is an optional enrichment, not part of the core data. Returning `null`/`undefined` silently skips the upload (the embedder's choice). The data URL is validated client-side first: only `data:image/*;base64,...` URLs are sent, and payloads over ~2 MB are rejected before the network call.

---

## Reviewer sign-in (magic link)

Reviewers sign in via an email magic link. Because the widget is embedded in arbitrary host pages (where a link redirect would lose the embed context), the primary flow is **pasting the short code** from the email into the widget's own panel — not following the link.

When `init()` is called **without** a `user`, the widget loads unobtrusively — it does not block the host page or force sign-in on load. The sign-in panel opens only once the reviewer presses the toolbar's "Sign in to annotate" button (which reads "New annotation" once a session exists), or an embedder calls `handle.setMode('annotate')` programmatically before a reviewer has signed in. The panel is dismissible (Escape, its "×" button, or clicking outside it), and doing so simply returns to the idle state — the reviewer can reopen it at any time by asking to annotate again:

```ts
import { init } from '@webdots/annotate-client';

const widget = init({
  apiUrl: 'https://api.webdots.app/api/v1',
  apiKey: 'your-project-key',
  // no `user` — a reviewer signs in via the panel
});
```

The panel drives two endpoints on the configured `apiUrl`:

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/auth/magic-link` | Body `{ email }`. Returns `204 No Content`. |
| `POST` | `/auth/magic-link/verify` | Body `{ code }`. Returns `200` with `{ token, user: { name, email } }`. |

An expired or invalid code is signalled by the server as `410 Gone` and rendered as a dedicated **expired-code** surface with a "Resend" action. Loading, error, and expired states are all themed through the widget's existing design tokens, and the whole flow ships with zero runtime dependencies.

Once verification succeeds, the returned `user` is written back into the widget's config, the panel unmounts, annotate mode is entered automatically (resuming whatever action asked for sign-in in the first place), and annotation loading runs (if `autoLoad` is on) — annotations for a signed-out visitor stay deferred until a session exists, so there's no attribution identity to load against beforehand. An embedder who already knows the reviewer can pass `user` at `init()` to skip the panel entirely.

The session `token` is attached to subsequent annotation requests as `Authorization: Bearer` and persisted in `localStorage` (namespaced by `apiUrl`, and implicitly the host origin since `localStorage` is origin-scoped), so a reviewer stays signed in across reloads and navigation to other pages on the same site — no re-prompting on every page. The stored token is trusted optimistically: if it has since expired, the next annotation request returns `401` and the widget clears the session, re-opens the sign-in panel, and rolls back any in-flight optimistic write (drop + rollback) — no page reload required.

---

## Backend requirements

The default transport calls:

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/annotations` | Query: `pageUrl`, `status`, `priority`, `limit`, `offset`. Expects a **bare JSON array**. |
| `POST` | `/annotations` | Returns `201` with the created annotation. |
| `PATCH` | `/annotations/:id` | Partial update. |
| `PATCH` | `/annotations/:id/status` | Body is exactly `{ "status": "OPEN" \| "RESOLVED" }`. Separate from the generic `PATCH`. |
| `DELETE` | `/annotations/:id` | Expects `204` with no body. |
| `POST` | `/annotations/:id/screenshot` | Body `{ image: dataUrl }` (a `data:image/*;base64,...` string). Returns `200` with the full, updated annotation row — the `screenshot` field carries the stored URL/key. ~2 MB ceiling, image MIME only. |

### Authentication

The hosted webdots server enforces API keys via the `REQUIRE_API_KEY` flag (Santaval/webdots#7). When enforcement is on, **every** request must carry a valid `x-api-key` header, which the client sets from `config.apiKey`. Configure it at `init()`:

```ts
init({
  apiUrl: 'https://api.webdots.app/api/v1',
  apiKey: 'your-project-key', // required for the hosted server
  user: { name: 'Dana Reyes' },
});
```

A missing or invalid key makes the server respond `401`/`403`, which the client surfaces as a single clear auth failure — never a silent drop:

- the in-flight optimistic pin rolls back, so no orphaned local state is left behind;
- `config.onError` fires with an `AuthError` (exported from the package) so your app can branch on it — e.g. prompt the user for a fresh key;
- a non-blocking toast appears in the widget's Shadow DOM with the message *"Authentication failed — your API key is missing or invalid."*

```ts
import { init, AuthError } from '@webdots/annotate-client';

const handle = init({
  apiUrl: 'https://api.webdots.app/api/v1',
  apiKey: process.env.WEBDOTS_API_KEY!,
  user: { name: 'Dana Reyes' },
  onError(error) {
    if (error instanceof AuthError) {
      // key expired or was revoked — re-prompt, don't retry blindly
      showReconfigureKeyPrompt();
    }
  },
});
```

`apiKey` stays **optional in the types** so a custom `config.api` backend and a self-hosted server with `REQUIRE_API_KEY` disabled keep working without a key.

#### Reviewer sessions (JWT)

When a reviewer signs in via the magic-link panel (no `user` passed at `init()`), the session `token` from `POST /auth/magic-link/verify` is attached to **annotation** requests as `Authorization: Bearer <token>` (the auth endpoints themselves never carry it — they exchange a code for the token). The session is persisted in `localStorage`, namespaced by `apiUrl` (and implicitly the host origin, since `localStorage` is origin-scoped), so a reviewer stays signed in across both a page reload and navigation to other pages on the same site. The stored token is trusted optimistically: if it has expired server-side, the next annotation request returns `401`, the widget clears the session, re-opens the sign-in panel, and rolls back any in-flight optimistic write — no page reload required. This `401`-with-a-session path is distinct from an `x-api-key` `401`: the latter still surfaces via `onError` + toast as described above.

Errors are expected as `{ "message": "…" }`. For `4xx` (other than 401/403) the server's message is surfaced to the user verbatim; for `5xx`, network, and timeout failures, generic copy is shown instead so internal detail is never leaked into the UI. `401`/`403` always render the fixed auth message above, regardless of any server body.

#### Deriving author identity from the session

When a reviewer is signed in (a JWT session is active), annotation **authorship is derived from the session on the server** — the client does **not** send `authorName`/`authorEmail` on the create request. The server resolves the author from the `Bearer` token and returns the resulting `authorName`/`authorEmail` on the response, so the optimistic pin's locally-stamped attribution is reconciled to the server-confirmed identity the moment the create resolves.

`config.user` is retained only as an **anonymous-mode fallback**: an embedder who skips the sign-in panel by passing `user` (and has no stored session) still sends `authorName`/`authorEmail` from that identity. Supplying `config.user` alongside an active session is deprecated — the server-derived session identity takes precedence, `config.user` is ignored, and the widget logs a one-time deprecation warning at `init()`. If you currently pass `user` while relying on magic-link sessions, remove `user` from your `init()` call; the session alone is sufficient.

**Migration (breaking):** `CreateAnnotationInput.authorName` is now optional. Custom `config.api` implementations that previously read a required `authorName` from the create input must tolerate its absence when a session is active — the field is omitted entirely from the request body, not sent as `null`. Existing `init({ user: { name } })` configs without a session keep working unchanged.

### CORS

The widget runs on the **host page's** origin, not the API's, so every request is cross-origin. Your API must:

- allow the embedding page's origin, and
- include `x-api-key` and `Authorization` in `Access-Control-Allow-Headers` (the latter whenever reviewer sessions are used).

Omitting the header from the allow-list makes every preflight fail, which presents as a total inability to load or save annotations.

### The `anchor` field (recommended)

Each annotation stores `selector`, `x`, `y`, and an optional **`anchor`** JSON object. `anchor` records the click point as a *fraction of the target element's box*, plus the selector strategy used to find it.

If your backend persists `anchor` (a nullable JSON column is enough), pins re-anchor to their element and stay correct through responsive reflow. **Without it, pins fall back to absolute page coordinates and will drift** whenever the layout changes — the annotation still works, but the pin is only as accurate as the page is stable.

The client always sends `anchor` and tolerates its absence in responses, so adding the column later is a non-breaking improvement.

### The `screenshot` field (optional)

`POST /annotations/:id/screenshot` (above) stores a captured screenshot against an existing annotation. The request body is `{ image: dataUrl }` — a `data:image/*;base64,...` string the server parses, persists, and echoes back on the returned row as the `screenshot` field (a stored URL/key, or `null` when no screenshot exists). A nullable text/URL column on the annotations table is all the schema needs; the client never sends a raw blob, only the data URL, and rejects payloads over ~2 MB or non-image MIME types before the network call (see [Screenshots](#screenshots-opt-in)). The upload is non-fatal: if it fails the annotation is never rolled back, so the column and the endpoint can land independently of the core create flow.

---

## Anchoring, and being honest about it

Pins are re-resolved against the live DOM on load and on every layout change. Each resolution carries a confidence level, and the UI reflects it rather than presenting a guess as fact:

| Confidence | Meaning | Shown as |
| --- | --- | --- |
| `exact` | The stored selector matched exactly one element. | Normal pin. |
| `degraded` | Recovered via the structural path or a text hint. | Dashed pin + "position may have shifted" note. |
| `orphaned` | No element matched; placed at last-known coordinates. | Dashed pin + explanatory note in the card. |
| `lost` | Cannot be placed on this page at all. | Not rendered; counted in the toolbar's **"N unplaced"** tray. |

Selector generation prefers, in order: test-id attributes → a stable `id` → a form control `name` → an ARIA label/role → a structural `nth-of-type` path → raw coordinates. Generated-looking ids (hashes, React `useId` output, long digit runs) are rejected, and CSS classes are never used — hashed class names are the single biggest source of selector rot.

---

## Browser support

Chrome, Edge, and Firefox current; **Safari 15+**. Constructable Stylesheets are used where available, with an automatic `<style>` element fallback for older Safari.

---

## What v1 deliberately does not do

Scoped out on purpose, not forgotten:

- **Screenshots** — capture is opt-in via a `captureScreenshot` callback (see above); the library ships no rasterizer to stay within the bundle budget.
- **Pin clustering** — overlapping pins simply stack.
- **Comments, threads, mentions, assignees** — one annotation is one note.
- **Offline queue** — a failed write surfaces an error and rolls back.
- **Drag-to-reposition pins**, **region/rectangle annotations**, **iframe support**.
- **Automatic SPA route detection** — call `refresh()` instead.
- **Realtime sync** — refresh is manual.
- **Touch/mobile gestures**, **pagination**, **filter UI**, **i18n** (UI copy is English).

---

## Development

```bash
npm install
npm run dev        # source demo page at localhost:5173 (imports ../src)
npm run demo:umd   # build, then serve the UMD embed demo at localhost:4173
npm test           # vitest
npm run typecheck
npm run build      # es + umd + cjs + .d.ts
npm run size       # enforces the 25 KB gzip budget
```

The demo pages are deliberately hostile — aggressive global `!important` resets, a sticky header, hashed class names, duplicate sibling structures — because that is what proves the isolation and anchoring actually work.

### Two demos, two distribution paths

| Command | Page | Loads the widget via |
| --- | --- | --- |
| `npm run dev` | `demo/index.html` | `import { init } from '../src/index'` (Vite, source) |
| `npm run demo:umd` | `demo/umd.html` | `<script src="../dist/webdots.umd.js">` then `window.Webdots.init` (the built UMD bundle — the primary distribution mode) |

`npm run demo:umd` runs `npm run build` first (the bundle is gitignored and only exists after a build), then starts a zero-dependency static server ([`scripts/serve-demo.mjs`](./scripts/serve-demo.mjs)) rooted at the repo root so the page can reach `dist/webdots.umd.js`. Open `http://localhost:4173/demo/umd.html`.

### Live mode setup

Both demos always talk to a real `webdots` server — there is no stub/mock fallback. The `api` and `user` config overrides are omitted, so the default `HttpAnnotationAPI` transport is used and the magic-link sign-in panel mounts — the reviewer signs in to establish a session.

- **Source demo** (`npm run dev`): set `VITE_WEBDOTS_API_URL` (and `VITE_WEBDOTS_API_KEY` for the hosted server) in `.env` (see [`.env.example`](./.env.example)).
- **UMD demo** (`npm run demo:umd`): edit the `API_URL` / `API_KEY` constants at the top of the inline `<script>` in `demo/umd.html`.

To run against a local server: start `webdots` locally, add the demo's origin (e.g. `http://localhost:5173`) to the server's `devOrigins`, and ensure CORS allows `x-api-key` and `Authorization` (see [CORS](#cors)).

## License

MIT — see [LICENSE](./LICENSE).
