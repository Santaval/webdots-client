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

Only `apiUrl` and `user.name` are required. Everything else has a sensible default.

---

## Configuration

`init(config)` validates eagerly and throws a clear `Error` on invalid input, so a misconfigured page fails loudly at startup rather than deep inside a later network call.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `apiUrl` | `string` | — | **Required.** Base URL of the annotations API, e.g. `https://api.example.com/api/v1`. Must be an absolute URL. |
| `apiKey` | `string` | — | Sent as the `x-api-key` header on every request. Omit if your backend is unauthenticated. |
| `user` | `{ name: string; email?: string }` | — | **Required** (`name` at minimum). Used for annotation attribution. |
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
  list:         (query, signal) => { /* … */ },
  get:          (id, signal) => { /* … */ },
  create:       (input, signal) => { /* … */ },
  update:       (id, input, signal) => { /* … */ },
  changeStatus: (id, status, signal) => { /* … */ },
  remove:       (id, signal) => { /* … */ },
};

init({ apiUrl: 'https://unused.example', user: { name: 'QA' }, api: myApi });
```

Every method receives an `AbortSignal` so `destroy()` can cancel in-flight work. All methods return the internal `Annotation` model — the wire format is confined to a single mapping module, so backend drift never reaches the UI.

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

Errors are expected as `{ "message": "…" }`. For `4xx` the server's message is surfaced to the user verbatim; for `5xx`, network, and timeout failures, generic copy is shown instead so internal detail is never leaked into the UI.

### CORS

The widget runs on the **host page's** origin, not the API's, so every request is cross-origin. Your API must:

- allow the embedding page's origin, and
- include `x-api-key` in `Access-Control-Allow-Headers` whenever `apiKey` is configured.

Omitting the header from the allow-list makes every preflight fail, which presents as a total inability to load or save annotations.

### The `anchor` field (recommended)

Each annotation stores `selector`, `x`, `y`, and an optional **`anchor`** JSON object. `anchor` records the click point as a *fraction of the target element's box*, plus the selector strategy used to find it.

If your backend persists `anchor` (a nullable JSON column is enough), pins re-anchor to their element and stay correct through responsive reflow. **Without it, pins fall back to absolute page coordinates and will drift** whenever the layout changes — the annotation still works, but the pin is only as accurate as the page is stable.

The client always sends `anchor` and tolerates its absence in responses, so adding the column later is a non-breaking improvement.

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

- **Screenshots** — the field exists but is never populated; a canvas rasterizer would dominate the bundle.
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
npm run dev        # demo page at localhost:5173
npm test           # vitest
npm run typecheck
npm run build      # es + umd + cjs + .d.ts
npm run size       # enforces the 25 KB gzip budget
```

The demo page is deliberately hostile — aggressive global `!important` resets, a sticky header, hashed class names, duplicate sibling structures — because that is what proves the isolation and anchoring actually work.

## License

MIT — see [LICENSE](./LICENSE).
