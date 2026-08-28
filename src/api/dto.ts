import type { Annotation, AnnotationPriority, AnnotationStatus } from '../core/types';
import type { AnchorDescriptor } from '../anchor/types';
import type { CreateAnnotationInput, UpdateAnnotationInput } from './AnnotationAPI';

/**
 * The ONLY module that knows the backend wire shape. Everything else in
 * this library speaks the internal `Annotation` model; drift in the wire
 * contract — including the `anchor` column not existing on the live
 * backend today — is absorbed here so it never leaks upward.
 */

const MAX_VARCHAR_LENGTH = 512;

/**
 * What the backend actually returns today (`AnnotationResponse.ts`).
 * `anchor` is NOT present on the live backend at all right now — adding an
 * `anchor Json?` column is a pending, separate decision — so it's typed
 * optional/unknown here and tolerated as absent by `annotationFromWire`.
 */
export interface AnnotationWire {
  id: string;
  pageUrl: string;
  selector: string;
  x: number;
  y: number;
  anchor?: unknown;
  title: string;
  description?: string | null;
  status: AnnotationStatus;
  priority: AnnotationPriority;
  authorName: string;
  authorEmail?: string | null;
  screenshot?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Wire -> internal. Never throws — a malformed/missing `anchor` degrades to a synthesized fallback rather than rejecting the whole row. */
export function annotationFromWire(wire: AnnotationWire): Annotation {
  return {
    id: wire.id,
    pageUrl: wire.pageUrl,
    selector: wire.selector,
    x: wire.x,
    y: wire.y,
    anchor: normalizeAnchor(wire),
    title: wire.title,
    description: wire.description ?? undefined,
    status: wire.status,
    priority: wire.priority,
    authorName: wire.authorName,
    authorEmail: wire.authorEmail ?? undefined,
    screenshot: wire.screenshot ?? null,
    resolvedAt: wire.resolvedAt ?? null,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

/**
 * The backend has no `anchor` column today, so every live row has
 * `anchor: undefined`. Even once the pending column exists, older rows
 * will still have `anchor: null`. Either way, synthesize a `coords`
 * fallback from `selector`/`x`/`y` so the pin still renders — via absolute
 * page coordinates (`anchor/position.ts` special-cases
 * `strategy === 'coords'` to ignore ratio math entirely) — instead of
 * silently vanishing. `ratio` is unused by that short-circuit but kept at
 * the box-center default for shape-completeness.
 */
function normalizeAnchor(wire: AnnotationWire): AnchorDescriptor | null {
  if (isAnchorDescriptor(wire.anchor)) return wire.anchor;

  return {
    v: 1,
    strategy: 'coords',
    selector: wire.selector,
    path: wire.selector,
    ratio: { x: 0.5, y: 0.5 },
    viewportW: 0,
    tag: '',
  };
}

function isAnchorDescriptor(value: unknown): value is AnchorDescriptor {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const ratio = v.ratio as Record<string, unknown> | null | undefined;
  return (
    v.v === 1 &&
    typeof v.strategy === 'string' &&
    typeof v.selector === 'string' &&
    typeof v.path === 'string' &&
    typeof ratio === 'object' &&
    ratio !== null &&
    typeof ratio.x === 'number' &&
    typeof ratio.y === 'number' &&
    typeof v.viewportW === 'number' &&
    typeof v.tag === 'string'
  );
}

// ---- internal -> wire (request bodies) --------------------------------

export interface CreateAnnotationBody {
  pageUrl: string;
  selector: string;
  x: number;
  y: number;
  /** Always sent — harmless if the server ignores it until the `anchor` column exists. */
  anchor: AnchorDescriptor;
  title: string;
  description?: string;
  priority?: AnnotationPriority;
  /**
   * Anonymous-mode fallback ONLY (#6). When a JWT session is active the
   * server derives `authorName`/`authorEmail` from the session and ignores
   * any client-supplied value, so these are OMITTED from the body entirely
   * (see `toCreateBody`) rather than sent alongside the token. An embedder
   * who skips the sign-in panel by passing `config.user` still sends them.
   */
  authorName?: string;
  authorEmail?: string;
}

export interface UpdateAnnotationBody {
  title?: string;
  description?: string;
  priority?: AnnotationPriority;
  selector?: string;
  x?: number;
  y?: number;
  anchor?: AnchorDescriptor;
}

/**
 * Body for `POST /annotations/:id/screenshot` (#8 / server #17). Carries the
 * full `data:` URL so the server can parse the MIME prefix itself and reject
 * oversized/wrong-type payloads with a clear 400. Kept as a single `image`
 * field so the contract stays one-key and trivial to extend later.
 */
export interface ScreenshotBody {
  image: string;
}

/**
 * The server's ~2 MB upload ceiling (Santaval/webdots#17). Enforced HERE,
 * synchronously, so an oversized capture fails fast with a clear message
 * rather than after a network round-trip — same rationale as
 * `assertVarcharLength`. Measured against the RAW data-URL string length
 * (base64 inflation means the decoded bytes are ~3/4 of this, so this is the
 * conservative/honest direction).
 */
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

/**
 * Builds the screenshot upload body from a `data:` URL and fail-fast validates
 * it: rejects anything that isn't a `data:image/...;base64,...` URL (non-image
 * MIME, missing base64 marker, non-data URLs) and anything exceeding the 2 MB
 * ceiling. Thrown synchronously before any network call, mirroring
 * `toCreateBody`'s eager validation.
 */
export function toScreenshotBody(dataUrl: string): ScreenshotBody {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    throw new Error('[webdots] screenshot must be a non-empty data: URL string.');
  }
  // `data:[<mediatype>][;base64],<data>` — require an image MIME + base64.
  // The server re-validates, but catching the obvious mistakes here keeps the
  // error message local and avoids a pointless 400 round-trip.
  const match = /^data:([^;,]+)\/[^;,]+;base64,/.exec(dataUrl);
  if (!match) {
    throw new Error('[webdots] screenshot must be a data:image/*;base64,... URL.');
  }
  if (match[1] !== 'image') {
    throw new Error(`[webdots] screenshot must be an image MIME type, got "${match[1]}".`);
  }
  if (dataUrl.length > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `[webdots] screenshot is ${dataUrl.length} bytes, exceeding the ${MAX_SCREENSHOT_BYTES}-byte upload limit.`,
    );
  }
  return { image: dataUrl };
}

/**
 * `pageUrl` and `selector` are `VarChar(512)` on the backend. Truncating
 * either silently would corrupt the URL or stop a selector matching, so
 * both are REJECTED (never truncated) when too long — thrown synchronously
 * here, before any network call, per the "fail fast, clear error" rule.
 * `pageUrl` is also checked against the backend's zod `.url()` validator
 * up front so a bad value 400s here, with a clear message, rather than on
 * the server.
 *
 * `authorName`/`authorEmail` are included ONLY when the caller supplies
 * them — i.e. the anonymous-mode fallback path (an embedder-supplied
 * `config.user` with no session). When a JWT session is active the caller
 * omits them so the server derives authorship from the session (#6);
 * sending them alongside a `Bearer` token is deprecated and ignored by
 * the server anyway. They're conditionally spread rather than set to
 * `undefined` so the keys are genuinely absent from the serialized body,
 * not merely `null`-ish.
 */
export function toCreateBody(input: CreateAnnotationInput): CreateAnnotationBody {
  assertUrlShape(input.pageUrl, 'pageUrl');
  assertVarcharLength(input.pageUrl, 'pageUrl');
  assertVarcharLength(input.selector, 'selector');

  return {
    pageUrl: input.pageUrl,
    selector: input.selector,
    x: input.x,
    y: input.y,
    anchor: input.anchor,
    title: input.title,
    description: input.description,
    priority: input.priority,
    ...(input.authorName !== undefined
      ? { authorName: input.authorName, authorEmail: input.authorEmail }
      : {}),
  };
}

export function toUpdateBody(input: UpdateAnnotationInput): UpdateAnnotationBody {
  if (input.selector !== undefined) assertVarcharLength(input.selector, 'selector');

  return {
    title: input.title,
    description: input.description,
    priority: input.priority,
    selector: input.selector,
    x: input.x,
    y: input.y,
    anchor: input.anchor,
  };
}

function assertVarcharLength(value: string, field: string): void {
  if (value.length > MAX_VARCHAR_LENGTH) {
    throw new Error(
      `[webdots] ${field} is ${value.length} characters, exceeding the backend's ${MAX_VARCHAR_LENGTH}-character limit.`,
    );
  }
}

function assertUrlShape(value: string, field: string): void {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
  } catch {
    throw new Error(
      `[webdots] ${field} must be a valid absolute URL (the backend validates it with zod .url()), got: "${value}"`,
    );
  }
}
