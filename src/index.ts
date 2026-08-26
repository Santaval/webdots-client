import { resolveConfig, type WebdotsConfig } from './core/config';
import { Widget } from './core/Widget';
import { createLogger } from './utils/log';
import type { WidgetHandle } from './core/types';

export const version = '0.1.0';

let activeWidget: Widget | null = null;

/**
 * Initializes the widget and mounts it into the page. Calling `init()`
 * again while a widget is already active (without calling `destroy()`
 * first) logs a warning and returns the EXISTING handle — it never creates
 * a second shadow root.
 */
export function init(config: WebdotsConfig): WidgetHandle {
  if (activeWidget) {
    // Use the already-resolved debug flag captured on the live instance is
    // not available here, so fall back to the incoming config's debug flag
    // for this one warning — it's the only signal we have pre-validation.
    const log = createLogger('index', Boolean(config?.debug));
    log.warn('init() called again without destroy() — returning the existing widget instance.');
    return activeWidget;
  }

  const resolved = resolveConfig(config);
  activeWidget = new Widget(resolved, version);
  return activeWidget;
}

/** Tears down the singleton created by `init()`, if any. Safe to call repeatedly. */
export function destroy(): void {
  if (!activeWidget) return;
  activeWidget.destroy();
  activeWidget = null;
}

export type { WebdotsConfig } from './core/config';
export type { WidgetHandle, WidgetMode, Annotation, AnnotationStatus, AnnotationPriority } from './core/types';
export type { AnchorDescriptor } from './anchor/types';
export type { PublicEvents } from './core/events';
export type { AnnotationAPI, ListAnnotationsQuery, CreateAnnotationInput, UpdateAnnotationInput } from './api/AnnotationAPI';
// `AuthError` is the one error type worth exporting: a consumer can branch on
// `error instanceof AuthError` inside `onError` to e.g. prompt for a fresh API
// key. `ApiError`/`NetworkError`/`TimeoutError` stay internal — their copy is
// the contract, and exposing the full hierarchy would balloon the public API
// for no caller benefit.
export { AuthError } from './api/errors';
