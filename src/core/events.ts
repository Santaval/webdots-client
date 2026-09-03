import type { Annotation, AnnotationPriority, AnnotationStatus, ToolbarPosition, WidgetMode } from './types';
import type { ResolveConfidence } from '../anchor/types';
import type { MagicLinkSession } from '../api/AuthAPI';

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

  // ---- auth intents (AuthPanel -> Widget) ----------------------------
  // M3 reviewer magic-link sign-in. AuthPanel emits these; Widget drives the
  // AuthAPI and replies with `state:auth-state-changed`. Same intent/state
  // split as the annotation family — the panel never calls the API itself.
  /** Email-entry submit. Widget calls `authApi.requestMagicLink(email)`. */
  'intent:request-magic-link': { email: string };
  /** Code-entry submit. Widget calls `authApi.verifyMagicLink(code)`. */
  'intent:verify-magic-link': { code: string };
  /** Cancel/Escape from the panel — Widget returns to the email phase. */
  'intent:cancel-auth': undefined;
  /**
   * Dismiss the panel entirely — Escape, the "×" close button, or a
   * backdrop click. Deliberately distinct from `intent:cancel-auth` (which
   * means "go back to email entry" and is what the "Use a different email"
   * back button emits): conflating the two would make the back button close
   * the panel instead of resetting its surface. Issue #19 — the panel is no
   * longer mandatory, so it needs a way to go away.
   */
  'intent:close-auth': undefined;
  /** "Resend" from the expired-code surface — Widget re-requests a link for the last email. */
  'intent:resend-magic-link': undefined;

  /**
   * Issue #20: the toolbar's "Hide/Show annotations" button wants the
   * annotation-visibility flag flipped. Distinct from `intent:toggle-mode` —
   * this only ever affects pins/overlay/popovers, never the toolbar itself
   * (see Widget's `setAnnotationsVisible`). `undefined`, matching every
   * intent in this file but the legacy `intent:toggle-mode`.
   */
  'intent:toggle-annotations': undefined;

  /**
   * Issue #21: the toolbar's grip wants the toolbar moved — the payload is
   * the ALREADY-CLAMPED free `{ x, y }` point the drag/arrow-key ended on.
   * Corners never travel over the bus: they are config-only seeds, and a
   * drag by definition produces a point. Typed payload, same as
   * `intent:set-mode`. Widget answers with `state:toolbar-position-changed`.
   */
  'intent:set-toolbar-position': { x: number; y: number };

  // ---- state (Widget/Store -> UI) -------------------------------------
  'state:mode-changed': { mode: WidgetMode };
  'state:visibility-changed': { visible: boolean };
  /**
   * Issue #20: fires whenever `Widget.setAnnotationsVisible()` changes the
   * annotation-visibility flag — a DISTINCT concept from
   * `state:visibility-changed` (whole-widget show/hide). Overlay applies
   * `.wd-overlay--hidden` off BOTH flags independently (see Overlay's class
   * doc); Toolbar reacts to update its toggle button's label/aria-pressed
   * and the unplaced tray. Public — see `PublicEventName` below — so an
   * embedder can observe the reviewer hiding/showing annotations.
   */
  'state:annotations-visibility-changed': { visible: boolean };
  /**
   * Issue #21: fires whenever the toolbar's placement changes — a drag
   * releasing, an arrow-key move on the grip, or `handle.setToolbarPosition()`.
   * Carries the full corner-or-point position (the same union
   * `handle.getToolbarPosition()` returns), not just the drag point, because
   * an embedder can set a corner programmatically. Public — see
   * `PublicEventName` below — so an embedder can observe the reviewer moving
   * the toolbar.
   */
  'state:toolbar-position-changed': { position: ToolbarPosition };
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
  /**
   * M3 reviewer auth. Widget emits this after every auth intent resolves
   * (or rejects). `phase` drives the AuthPanel's surface; `error`/`expired`
   * carry the failure detail (the panel branches on `expired` rather than
   * on the `ExpiredCodeError` type, so it need not import the error
   * hierarchy — same "error types stay confined to api/" rule as Toast);
   * `session` is set only on `phase: 'verified'`, after which Widget writes
   * it back into `config.user` and unmounts the panel.
   */
  'state:auth-state-changed': {
    phase: AuthPhase;
    error?: Error;
    expired?: boolean;
    session?: MagicLinkSession;
  };
  /**
   * Issue #19: lets Toolbar render its signed-out "Sign in to annotate"
   * label without importing Widget or Store — same bus-only discipline as
   * `state:unplaced-changed`. Deliberately NOT `state:auth-state-changed`:
   * that carries the panel's `AuthPhase` (email/requesting/code-sent/…),
   * which Toolbar has no business knowing about; this carries only the one
   * fact it needs, "is there a reviewer right now."
   */
  'state:session-changed': { signedIn: boolean };
}

/**
 * The AuthPanel's lifecycle states. `'idle'` means no panel is mounted —
 * the Widget's value before the reviewer has ever asked to sign in, AND
 * (issue #19) what it emits when the panel is dismissed (Escape, the "×",
 * or a backdrop click) without completing the flow. The panel itself mounts
 * only into `'email'`, and Widget drives it through `'requesting'` ->
 * `'code-sent'` -> `'verifying'` -> `'verified'` as the flow progresses.
 * Failures are NOT a separate phase:
 * the panel re-renders the surface the failure occurred on (`'email'` or
 * `'code-sent'`) with an `error`/`expired` companion on the same event, so
 * the user stays in context — a rejected `requestMagicLink` returns to the
 * email field with its error, a rejected `verifyMagicLink` returns to the
 * code field with its error (or the dedicated expired surface when
 * `expired: true`). This is issue #4's expired-code path.
 */
export type AuthPhase = 'idle' | 'email' | 'requesting' | 'code-sent' | 'verifying' | 'verified';

/** Event names available to library consumers via `handle.on()`. */
export type PublicEventName =
  | 'state:mode-changed'
  | 'state:visibility-changed'
  | 'state:annotations-visibility-changed'
  | 'state:toolbar-position-changed';

export type PublicEvents = Pick<WebdotsEvents, PublicEventName>;
