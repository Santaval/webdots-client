export type PageKeyResolver = string | ((url: URL) => string);

/**
 * Resolves the key annotations are grouped by for the current page.
 * Default: `origin + pathname` — drops the query string and hash so, e.g.,
 * `?tab=2` and `?tab=3` on the same route share one annotation set.
 * `config.pageKey` overrides this with either a fixed string or a
 * `(url: URL) => string` resolver.
 */
export function resolvePageKey(url: URL, pageKey?: PageKeyResolver): string {
  if (typeof pageKey === 'string') return pageKey;
  if (typeof pageKey === 'function') return pageKey(url);
  return `${url.origin}${url.pathname}`;
}

/**
 * The backend's `CreateAnnotationSchema` validates `pageUrl` with zod
 * `.url()` — a `pageKey` resolver that returns a non-URL string (e.g. a
 * bare route name like `"checkout"`) would 400 on the FIRST create, deep
 * inside a network call, with a confusing server-side error. Validating
 * eagerly at `init()` instead fails fast with a clear, actionable message.
 */
export function assertValidPageKey(pageKey: string): void {
  try {
    // eslint-disable-next-line no-new
    new URL(pageKey);
  } catch {
    throw new Error(
      `[webdots] the resolved pageKey "${pageKey}" is not a valid absolute URL. ` +
        'The backend requires pageUrl to parse as a URL — check config.pageKey.',
    );
  }
}
