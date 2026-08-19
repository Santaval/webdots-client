import type { Annotation, WidgetMode } from './types';
import type { AnnotationAPI } from '../api/AnnotationAPI';
import { resolvePageKey, assertValidPageKey, type PageKeyResolver } from '../utils/pageKey';

/**
 * Public configuration surface. `api` is a DI escape hatch: supply any
 * `AnnotationAPI` implementation (e.g. a test stub) to override the
 * default `HttpAnnotationAPI` built from `apiUrl`/`apiKey`.
 */
export interface WebdotsConfig {
  apiUrl: string;
  apiKey?: string;
  user: { name: string; email?: string };

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

  /** DI escape hatch; overrides apiUrl/apiKey. */
  api?: AnnotationAPI;
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
 */
export interface ResolvedWebdotsConfig {
  apiUrl: string;
  apiKey: string | undefined;
  user: { name: string; email: string | undefined };
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
  api: AnnotationAPI | undefined;
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

  if (!raw.user || typeof raw.user !== 'object') {
    throw new Error('[webdots] config.user is required (expected { name, email? }).');
  }

  if (!raw.user.name || typeof raw.user.name !== 'string') {
    throw new Error('[webdots] config.user.name is required and must be a non-empty string.');
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

  // Resolved once, eagerly, against the current location — the backend's
  // CreateAnnotationSchema validates `pageUrl` with zod `.url()`, so a
  // pageKey resolver that returns a non-URL string must fail fast here
  // rather than 400 deep inside the first create() call.
  const pageKey = resolvePageKey(new URL(location.href), raw.pageKey);
  assertValidPageKey(pageKey);

  return {
    apiUrl: raw.apiUrl,
    apiKey: raw.apiKey,
    user: { name: raw.user.name, email: raw.user.email },
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
    api: raw.api,
    onError: raw.onError,
    onAnnotationCreated: raw.onAnnotationCreated,
    onModeChange: raw.onModeChange,
  };
}
