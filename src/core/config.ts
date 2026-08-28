import type { Annotation, ScreenshotContext, WidgetMode } from './types';
import type { AnnotationAPI } from '../api/AnnotationAPI';
import type { AuthAPI } from '../api/AuthAPI';
import { resolvePageKey, assertValidPageKey, type PageKeyResolver } from '../utils/pageKey';

/**
 * Public configuration surface. `api`/`authApi` are DI escape hatches: supply
 * any `AnnotationAPI`/`AuthAPI` implementation (e.g. a test stub) to override
 * the default HTTP implementations built from `apiUrl`/`apiKey`.
 */
export interface WebdotsConfig {
  apiUrl: string;
  apiKey?: string;
  /**
   * Reviewer identity for annotation attribution. Optional as of M3: when
   * omitted, the widget mounts the magic-link sign-in panel and a reviewer
   * signs in to establish `user` (and a session) at runtime. An embedder
   * who already knows the reviewer may still pass it to skip the panel.
   */
  user?: { name: string; email?: string };

  /** Default: origin + pathname of `location` (query/hash dropped). See utils/pageKey.ts. */
  pageKey?: PageKeyResolver;
  autoLoad?: boolean;
  showResolved?: boolean;
  container?: HTMLElement;
  zIndex?: number;
  theme?: 'light' | 'dark' | 'auto';
  ignoreSelector?: string;
  testIdAttributes?: string[];
  requestTimeoutMs?: number;
  debug?: boolean;

  /**
   * Opt-in screenshot capture for newly-created annotations (#8). The library
   * ships no rasterizer (bundle budget); supply a callback that returns a
   * `data:` URL (e.g. via html2canvas). Invoked at create time with the
   * clicked element + viewport + in-flight fields. Returning null/undefined
   * skips the upload; throwing/rejecting is non-fatal (surfaces via
   * `onError` + toast, the annotation is never lost). See `ScreenshotContext`.
   */
  captureScreenshot?: (ctx: ScreenshotContext) => Promise<string | null | undefined>;

  /** DI escape hatch; overrides apiUrl/apiKey for the annotations API. */
  api?: AnnotationAPI;
  /** DI escape hatch; overrides apiUrl/apiKey for the auth (magic-link) API. */
  authApi?: AuthAPI;
  onError?: (error: Error) => void;
  onAnnotationCreated?: (a: Annotation) => void;
  onModeChange?: (mode: WidgetMode) => void;
}

/**
 * Fully-resolved config with every optional field defaulted. `pageKey` here
 * is the already-COMPUTED string (resolved once, at `init()`, against the
 * current `location` — see utils/pageKey.ts's module doc for why it's not
 * recomputed per-request: the plan treats SPA navigation as an explicit
 * `handle.refresh()` concern, not something this library auto-detects).
 * `user` is `undefined` until a reviewer completes magic-link sign-in (or
 * immediately when the embedder supplied one).
 */
export interface ResolvedWebdotsConfig {
  apiUrl: string;
  apiKey: string | undefined;
  user: { name: string; email: string | undefined } | undefined;
  pageKey: string;
  autoLoad: boolean;
  showResolved: boolean;
  container: HTMLElement;
  zIndex: number;
  theme: 'light' | 'dark' | 'auto';
  ignoreSelector: string | undefined;
  testIdAttributes: string[];
  requestTimeoutMs: number;
  debug: boolean;
  captureScreenshot: ((ctx: ScreenshotContext) => Promise<string | null | undefined>) | undefined;
  api: AnnotationAPI | undefined;
  authApi: AuthAPI | undefined;
  onError: ((error: Error) => void) | undefined;
  onAnnotationCreated: ((a: Annotation) => void) | undefined;
  onModeChange: ((mode: WidgetMode) => void) | undefined;
}

const DEFAULT_TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy'];
const DEFAULT_Z_INDEX = 2147483000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

/**
 * Applies defaults and fails fast with clear Error messages on invalid
 * input. Validated eagerly at `init()` time so a misconfigured host page
 * fails loudly and immediately rather than surfacing a cryptic error deep
 * inside a later network call.
 */
export function resolveConfig(raw: WebdotsConfig): ResolvedWebdotsConfig {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('[webdots] init() requires a config object.');
  }

  if (!raw.apiUrl || typeof raw.apiUrl !== 'string') {
    throw new Error('[webdots] config.apiUrl is required and must be a non-empty string.');
  }

  try {
    // eslint-disable-next-line no-new
    new URL(raw.apiUrl);
  } catch {
    throw new Error(`[webdots] config.apiUrl must be a valid absolute URL, got: "${raw.apiUrl}"`);
  }

  if (raw.user !== undefined && (typeof raw.user !== 'object' || raw.user === null)) {
    throw new Error('[webdots] config.user must be an object ({ name, email? }) when provided.');
  }

  if (raw.user && (!raw.user.name || typeof raw.user.name !== 'string')) {
    throw new Error('[webdots] config.user.name must be a non-empty string when user is provided.');
  }

  if (raw.container !== undefined && !(raw.container instanceof HTMLElement)) {
    throw new Error('[webdots] config.container must be an HTMLElement when provided.');
  }

  if (raw.zIndex !== undefined && (typeof raw.zIndex !== 'number' || !Number.isFinite(raw.zIndex))) {
    throw new Error('[webdots] config.zIndex must be a finite number when provided.');
  }

  if (raw.theme !== undefined && !['light', 'dark', 'auto'].includes(raw.theme)) {
    throw new Error('[webdots] config.theme must be one of "light" | "dark" | "auto".');
  }

  if (
    raw.requestTimeoutMs !== undefined &&
    (typeof raw.requestTimeoutMs !== 'number' || raw.requestTimeoutMs <= 0)
  ) {
    throw new Error('[webdots] config.requestTimeoutMs must be a positive number when provided.');
  }

  if (raw.testIdAttributes !== undefined && !Array.isArray(raw.testIdAttributes)) {
    throw new Error('[webdots] config.testIdAttributes must be an array of strings when provided.');
  }

  if (
    raw.captureScreenshot !== undefined &&
    typeof raw.captureScreenshot !== 'function'
  ) {
    throw new Error('[webdots] config.captureScreenshot must be a function when provided.');
  }

  // Resolved once, eagerly, against the current location — the backend's
  // CreateAnnotationSchema validates `pageUrl` with zod `.url()`, so a
  // pageKey resolver that returns a non-URL string must fail fast here
  // rather than 400 deep inside the first create() call.
  const pageKey = resolvePageKey(new URL(location.href), raw.pageKey);
  assertValidPageKey(pageKey);

  return {
    apiUrl: raw.apiUrl,
    apiKey: raw.apiKey,
    user: raw.user ? { name: raw.user.name, email: raw.user.email } : undefined,
    pageKey,
    autoLoad: raw.autoLoad ?? true,
    showResolved: raw.showResolved ?? false,
    container: raw.container ?? document.body,
    zIndex: raw.zIndex ?? DEFAULT_Z_INDEX,
    theme: raw.theme ?? 'auto',
    ignoreSelector: raw.ignoreSelector,
    testIdAttributes: raw.testIdAttributes ?? DEFAULT_TEST_ID_ATTRIBUTES,
    requestTimeoutMs: raw.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    debug: raw.debug ?? false,
    captureScreenshot: raw.captureScreenshot,
    api: raw.api,
    authApi: raw.authApi,
    onError: raw.onError,
    onAnnotationCreated: raw.onAnnotationCreated,
    onModeChange: raw.onModeChange,
  };
}
