import type { Annotation, AnnotationPriority, AnnotationStatus, WidgetMode } from './types';
import type { ResolveConfidence } from '../anchor/types';

/**
 * Single source of truth for every event the internal EventBus carries.
 * Two families:
 *  - `intent:*` — a UI component wants something to happen (e.g. the
 *    Toolbar wants annotate mode toggled). UI emits intents and never calls
 *    the API directly; Widget subscribes and performs the action.
 *  - `state:*`  — something happened (mode changed, data changed, layout
 *    changed). UI subscribes to state to re-render.
 *
 * Only a subset of `state:*` is whitelisted for external consumers via
 * `handle.on()` — see `PublicEvents` below. Not every event listed here is
 * wired up yet in M1; several are declared ahead of the milestones that
 * implement them (Store, PinManager, anchor resolution, API) so the map
 * doesn't churn later.
 */
export interface WebdotsEvents {
  // ---- intents (UI -> Widget) ----------------------------------------
  'intent:toggle-mode': void;
  'intent:set-mode': WidgetMode;
  'intent:create-annotation': { title: string; description?: string; priority: AnnotationPriority };
  'intent:cancel-annotation': undefined;
  'intent:refresh': undefined;
  /**
   * A pin (click or Enter/Space) wants its detail view opened. Coordinates
   * are viewport-space, for Popover placement. `confidence` is the pin's
   * CURRENTLY-RENDERED resolve confidence (read off the pin element's own
   * `data-wd-confidence`, set by PinManager/Pin each layout tick) — Overlay
   * forwards it rather than Widget re-deriving it, since Overlay is the one
   * place that already has the clicked pin element in hand. `undefined`
   * only for a synthetic/test dispatch that never went through a real pin.
   */
  'intent:open-annotation': { id: string; clientX: number; clientY: number; confidence?: ResolveConfidence };
  /** Close whatever view/edit detail popover is open — Close button, Escape, or Cancel from the edit form. */
  'intent:close-detail': undefined;
  /** Swap the open card's view content for an edit form pre-filled with its current values. */
  'intent:edit-annotation': undefined;
  'intent:update-annotation': { title: string; description?: string; priority: AnnotationPriority };
  'intent:change-status': { status: AnnotationStatus };
  'intent:delete-annotation': undefined;

  // ---- state (Widget/Store -> UI) -------------------------------------
  'state:mode-changed': { mode: WidgetMode };
  'state:visibility-changed': { visible: boolean };
  'state:annotations-changed': {
    added: Annotation[];
    updated: Annotation[];
    removed: string[];
  };
  'state:layout-changed': undefined;
  'state:error': { error: Error };
  /**
   * Fires whenever the SET of `lost`-confidence annotations (resolved
   * position beyond the current document height, nothing else to fall back
   * to — plan §4 step 5) changes, on any `PinManager` reconcile or layout
   * tick. Carries enough of each annotation (title + author) for the
   * Toolbar's "N unplaced" tray to list them without importing Store.
   */
  'state:unplaced-changed': { annotations: Array<{ id: string; title: string; authorName: string }> };
}

/** Event names available to library consumers via `handle.on()`. */
export type PublicEventName = 'state:mode-changed' | 'state:visibility-changed';

export type PublicEvents = Pick<WebdotsEvents, PublicEventName>;
