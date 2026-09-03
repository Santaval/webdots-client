import { h } from './dom';
import type { EventBus } from '../core/EventBus';
import type { ToolbarPosition, WidgetMode } from '../core/types';
import { TOOLBAR_CORNERS, clampToolbarPosition } from '../utils/toolbarPosition';
import { observeLayout, type ObserveLayoutHandle } from '../utils/observeLayout';

export interface ToolbarOptions {
  bus: EventBus;
  initialMode: WidgetMode;
  /**
   * Issue #19: whether a reviewer session already exists at construction
   * time — mirrors the `initialMode` pattern exactly (a snapshot handed in
   * once, then kept current via a `state:*` subscription). Widget passes
   * `hasUser()`: true for an embedder-supplied `config.user` or a restored
   * session, false when the reviewer hasn't signed in yet.
   */
  initialSignedIn: boolean;
  /**
   * Issue #21: the starting placement — a preset corner (from
   * `config.toolbarPosition`) or a previously-dragged `{ x, y }` point
   * (restored from the per-`apiUrl` stored preference). Same snapshot
   * pattern as `initialMode`/`initialSignedIn`, kept current via
   * `state:toolbar-position-changed`. Defaults to the historical
   * bottom-right corner.
   */
  initialPosition?: ToolbarPosition;
}

interface UnplacedAnnotation {
  id: string;
  title: string;
  authorName: string;
}

/** Pointer travel (px) before a press on the grip counts as a drag rather than a tap. */
const DRAG_THRESHOLD_PX = 4;
/** Arrow-key nudge size (px) — one space step, matching `--wd-space-4`. */
const KEYBOARD_STEP_PX = 16;
/**
 * How much room above the toolbar the unplaced panel needs (its 220px
 * max-height + the 8px gap + breathing room). A toolbar whose top edge is
 * closer than this flips the panel below instead of above it.
 */
const PANEL_CLEARANCE_PX = 240;

/**
 * The floating toolbar. Rendered inside the shadow root. Per the "no UI
 * module imports another UI module" rule, Toolbar only ever talks to the
 * EventBus: it emits `intent:toggle-mode` when the user clicks the toggle,
 * and reacts to `state:mode-changed` / `state:visibility-changed` to update
 * its own rendering. It never reaches into Overlay, Store, or anything else.
 *
 * M5 adds the "N unplaced" tray: `PinManager` emits `state:unplaced-changed`
 * whenever the set of `lost`-confidence annotations (resolved position
 * beyond the document height — plan §4 step 5, not rendered as a pin
 * at all) changes. These annotations exist on the server but can't be placed
 * on THIS page, so getting them into the UI at all — as a simple clickable
 * count that expands to a title+author list — is the requirement; no more
 * than that. The list panel is built and toggled entirely within Toolbar's
 * own element tree (no Popover reuse, no new wiring through Widget), same
 * boundary discipline as everything else here.
 *
 * Issue #21 adds placement: a leading drag grip the reviewer can drag
 * (pointer) or nudge (arrow keys, 16px steps). Rendering is Toolbar's own
 * concern — corner positions are modifier classes, dragged positions inline
 * left/top, both re-clamped on layout ticks — while the *position state*
 * belongs to Widget: every completed move emits `intent:set-toolbar-position`
 * (already clamped) and the authoritative value comes back as
 * `state:toolbar-position-changed`, which Widget persists per-`apiUrl`.
 * The optimistic local apply just means zero-latency rendering; the echo is
 * idempotent. Transient drag frames never touch the bus — only the released
 * position does.
 */
export class Toolbar {
  readonly el: HTMLDivElement;

  private toggleButton: HTMLButtonElement;
  private countEl: HTMLSpanElement;
  private annotationsButton: HTMLButtonElement;
  private refreshButton: HTMLButtonElement;
  private unplacedButton: HTMLButtonElement;
  private unplacedPanel: HTMLDivElement;
  private unplacedListEl: HTMLUListElement;
  private gripEl: HTMLSpanElement;
  private bus: EventBus;
  private mode: WidgetMode;
  private signedIn: boolean;
  /** Issue #21: mirrors `Widget.toolbarPosition`, kept current via `state:toolbar-position-changed`. */
  private position: ToolbarPosition;
  private count = 0;
  private unplaced: UnplacedAnnotation[] = [];
  private unplacedOpen = false;
  /** Issue #20: mirrors `Widget.annotationsVisible`, kept current via `state:annotations-visibility-changed`. */
  private annotationsVisible = true;
  private unsubscribers: Array<() => void> = [];

  // ---- issue #21: drag state ------------------------------------------
  // `dragOrigin` non-null == a drag is in progress. The rendered position
  // moves live (inline styles) while `position` (the STATE) stays put — the
  // state only changes when the drag ends and Widget echoes the intent back.
  // Escape / pointercancel restores the pre-drag rendering via applyPosition.
  private dragOrigin: { pointerX: number; pointerY: number; startX: number; startY: number } | null = null;
  private dragMoved = false;
  private dragPoint: { x: number; y: number } | null = null;

  // Viewport/size changes re-clamp a dragged point fully on-screen (a
  // corner needs nothing — pure CSS). observeLayout covers resize/scroll;
  // the ResizeObserver on the toolbar itself covers the toolbar's OWN size
  // changing (e.g. the signed-in label swap widening it) and, via RO's
  // initial-observation callback, the first real measurement after Widget
  // appends the element — the constructor applies positions with a 0-sized
  // jsdom-style rect otherwise.
  private layoutObserver: ObserveLayoutHandle;
  private resizeObserver: ResizeObserver | undefined;

  // Escape-to-close for the unplaced panel, matching Popover's own
  // keydown-driven Escape handling for Form/Card — same contract, different
  // surface, since this panel deliberately isn't built on top of Popover
  // (see the class doc: no Popover reuse, no new Widget wiring).
  private panelKeydownHandler = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this.closeUnplacedPanel();
    this.unplacedButton.focus();
  };

  constructor(options: ToolbarOptions) {
    this.bus = options.bus;
    this.mode = options.initialMode;
    this.signedIn = options.initialSignedIn;
    this.position = options.initialPosition ?? 'bottom-right';

    // Issue #21: the drag grip, FIRST child so it sits at the toolbar's
    // leading edge. A span with its own class — deliberately NOT a
    // `.wd-toolbar__button`, because Widget.test.ts relies on
    // `.wd-toolbar__button` (first match) meaning the mode toggle. The
    // separator role is the established pattern for focusable drag handles;
    // arrow keys nudge the toolbar (see onGripKeydown).
    this.gripEl = h(
      'span',
      {
        className: 'wd-toolbar__grip',
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': 'Move toolbar',
        tabindex: '0',
        onpointerdown: (event: PointerEvent) => this.onGripPointerDown(event),
        onkeydown: (event: KeyboardEvent) => this.onGripKeydown(event),
      },
    );

    this.toggleButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-toolbar__button',
        'aria-label': 'Toggle annotation mode',
        'aria-pressed': String(this.mode === 'annotate'),
        onclick: () => this.bus.emit('intent:toggle-mode', undefined),
      },
      'New annotation',
    );

    this.countEl = h(
      'span',
      { className: 'wd-toolbar__count', 'aria-label': 'Annotation count', 'aria-live': 'polite' },
      '0',
    );

    // Issue #20: a second, independent visibility toggle — hides pins/
    // overlay/popovers without touching the toolbar (see Overlay's class
    // doc for the two-flag design). Inserted between `countEl` and
    // `refreshButton` so it stays AFTER the mode-toggle button in document
    // order — `Widget.test.ts` relies on `.wd-toolbar__button` (first match)
    // meaning the mode toggle.
    this.annotationsButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-toolbar__button wd-toolbar__annotations',
        'aria-label': 'Hide annotations',
        'aria-pressed': 'false',
        onclick: () => this.bus.emit('intent:toggle-annotations', undefined),
      },
      'Hide annotations',
    );

    this.refreshButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-toolbar__button',
        'aria-label': 'Refresh annotations',
        onclick: () => this.bus.emit('intent:refresh', undefined),
      },
      'Refresh',
    );

    this.unplacedButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-toolbar__button wd-toolbar__unplaced',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
        hidden: true,
        onclick: () => this.toggleUnplacedPanel(),
      },
      '',
    );

    this.unplacedListEl = h('ul', { className: 'wd-unplaced-list' });
    this.unplacedPanel = h(
      'div',
      {
        className: 'wd-unplaced-panel',
        hidden: true,
        role: 'dialog',
        'aria-label': 'Unplaced annotations',
        // Not in the tab sequence on its own (-1) — it's made focusable so
        // it can receive programmatic focus the moment it opens, same
        // "focus moves into the surface, Escape returns it" contract
        // Popover already gives Form/Card (see popoverKeydownHandler below).
        tabindex: '-1',
      },
      this.unplacedListEl,
    );
    this.unplacedPanel.addEventListener('keydown', this.panelKeydownHandler);

    this.el = h(
      'div',
      { className: 'wd-toolbar', role: 'toolbar', 'aria-label': 'Webdots annotation toolbar' },
      this.gripEl,
      this.toggleButton,
      this.countEl,
      this.annotationsButton,
      this.refreshButton,
      this.unplacedButton,
      this.unplacedPanel,
    );

    this.unsubscribers.push(
      this.bus.on('state:mode-changed', ({ mode }) => this.applyMode(mode)),
      this.bus.on('state:visibility-changed', ({ visible }) => this.applyVisibility(visible)),
      this.bus.on('state:annotations-changed', (diff) => {
        this.count += diff.added.length - diff.removed.length;
        this.setAnnotationCount(this.count);
      }),
      this.bus.on('state:unplaced-changed', ({ annotations }) => this.applyUnplaced(annotations)),
      this.bus.on('state:session-changed', ({ signedIn }) => this.applySignedIn(signedIn)),
      this.bus.on('state:annotations-visibility-changed', ({ visible }) => this.applyAnnotationsVisibility(visible)),
      this.bus.on('state:toolbar-position-changed', ({ position }) => this.applyPosition(position)),
    );

    this.applyMode(this.mode);
    this.applySignedIn(this.signedIn);
    this.applyPosition(this.position);

    this.layoutObserver = observeLayout(() => this.onLayoutTick());
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onLayoutTick());
      this.resizeObserver.observe(this.el);
    }
  }

  setAnnotationCount(count: number): void {
    this.countEl.textContent = String(count);
  }

  private applyMode(mode: WidgetMode): void {
    this.mode = mode;
    const active = mode === 'annotate' || mode === 'composing';
    this.toggleButton.setAttribute('aria-pressed', String(active));
  }

  /**
   * Issue #19: while signed out, the toggle button reads "Sign in to
   * annotate" instead of "New annotation" so a reviewer knows what clicking
   * it will do (open the sign-in panel, not enter annotate mode directly).
   * Swaps text + `aria-label` only — `applyMode()` owns `aria-pressed`
   * alone, so the two renderers never fight over the same attribute.
   */
  private applySignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
    const label = signedIn ? 'New annotation' : 'Sign in to annotate';
    this.toggleButton.textContent = label;
    this.toggleButton.setAttribute('aria-label', label);
  }

  /**
   * Returns focus to the toggle button — called by Widget when the reviewer
   * dismisses the AuthPanel (`intent:close-auth`) without signing in, the
   * same "focus moves into the surface, Escape returns it" contract this
   * class already gives the unplaced panel (see `panelKeydownHandler`).
   */
  focusToggle(): void {
    this.toggleButton.focus();
  }

  private applyVisibility(visible: boolean): void {
    this.el.classList.toggle('wd-toolbar--hidden', !visible);
  }

  // ---- issue #21: placement -------------------------------------------

  /**
   * Renders the authoritative position (constructor snapshot, or the
   * `state:toolbar-position-changed` echo). Corners become the matching
   * modifier class (clearing any dragged inline position first — otherwise
   * the inline left/top would out-rank the class); points are clamped fully
   * on-screen and rendered inline with right/bottom reset to auto, so the
   * two halves of the union can never both apply.
   */
  private applyPosition(position: ToolbarPosition): void {
    this.position = position;
    if (typeof position === 'string') {
      this.el.style.removeProperty('left');
      this.el.style.removeProperty('top');
      this.el.style.removeProperty('right');
      this.el.style.removeProperty('bottom');
      for (const corner of TOOLBAR_CORNERS) {
        this.el.classList.toggle(`wd-toolbar--${corner}`, corner === position);
      }
      this.syncPanelPlacement(position === 'top-left' || position === 'top-right');
    } else {
      const clamped = this.clampToViewport(position);
      this.renderPoint(clamped.x, clamped.y);
      this.syncPanelPlacement(clamped.y < PANEL_CLEARANCE_PX);
    }
  }

  private clampToViewport(point: { x: number; y: number }): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return clampToolbarPosition(point, window.innerWidth, window.innerHeight, rect.width, rect.height);
  }

  private renderPoint(x: number, y: number): void {
    for (const corner of TOOLBAR_CORNERS) this.el.classList.remove(`wd-toolbar--${corner}`);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.right = 'auto';
    this.el.style.bottom = 'auto';
  }

  /**
   * The unplaced panel opens ABOVE the toolbar by default (toolbar.css),
   * which only makes sense while the toolbar rests near the bottom. Near
   * the top (a top corner, or a dragged point with a small y) it flips
   * below via the `--panel-below` modifier — same flip idea as
   * `computePlacement()`, decided from the position state rather than a
   * measured rect so it's correct before the first layout tick.
   */
  private syncPanelPlacement(below: boolean): void {
    this.el.classList.toggle('wd-toolbar--panel-below', below);
  }

  /**
   * Re-clamps a dragged point on viewport/size changes (a corner needs
   * nothing — its CSS re-resolves on its own). Skipped mid-drag so a layout
   * tick can't fight the pointer. Rendering-only: the stored point in
   * Widget's state is deliberately NOT rewritten — a reviewer who dragged
   * to x=1900 and shrinks the window gets the toolbar pulled on-screen, and
   * widening the window again puts it right back where they left it.
   */
  private onLayoutTick(): void {
    if (this.dragOrigin || typeof this.position !== 'object') return;
    this.applyPosition(this.position);
  }

  private onGripPointerDown(event: PointerEvent): void {
    // Primary pointer only — a right-click/second-touch press on the grip
    // is not a drag (and must not swallow the context menu).
    if (event.button !== 0) return;
    const rect = this.el.getBoundingClientRect();
    this.dragOrigin = { pointerX: event.clientX, pointerY: event.clientY, startX: rect.left, startY: rect.top };
    this.dragMoved = false;
    this.dragPoint = null;
    this.el.classList.add('wd-toolbar--dragging');
    // Document-level move/up (the Highlighter pattern) tracks the drag even
    // when the pointer leaves the small grip; setPointerCapture additionally
    // keeps a browser reporting moves made outside the window, but is
    // best-effort — jsdom has no pointer capture, and an uncaptured drag
    // still works through the document listeners.
    document.addEventListener('pointermove', this.onDragPointerMove);
    document.addEventListener('pointerup', this.onDragPointerUp);
    document.addEventListener('pointercancel', this.onDragPointerCancel);
    if (typeof this.gripEl.setPointerCapture === 'function') {
      try {
        this.gripEl.setPointerCapture(event.pointerId);
      } catch {
        // Unknown pointer id (e.g. a synthetic test event) — document listeners carry the drag.
      }
    }
    this.gripEl.focus({ preventScroll: true });
  }

  private onDragPointerMove = (event: PointerEvent): void => {
    if (!this.dragOrigin) return;
    const dx = event.clientX - this.dragOrigin.pointerX;
    const dy = event.clientY - this.dragOrigin.pointerY;
    // A press-and-wiggle on the grip is a tap, not a drag — only real
    // travel flips dragMoved, and only then does the toolbar (ever) move.
    if (!this.dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.dragMoved = true;
    const clamped = this.clampToViewport({ x: this.dragOrigin.startX + dx, y: this.dragOrigin.startY + dy });
    this.dragPoint = clamped;
    this.renderPoint(clamped.x, clamped.y);
    this.syncPanelPlacement(clamped.y < PANEL_CLEARANCE_PX);
  };

  private onDragPointerUp = (): void => {
    const moved = this.dragMoved;
    const point = this.dragPoint;
    this.endDrag();
    if (!moved || !point) return; // a grip tap — focus only, nothing moved
    // Optimistic local apply (the rendering already shows this point; this
    // just syncs the state so a later layout tick keeps it), then the intent
    // — Widget persists it and echoes `state:toolbar-position-changed` back,
    // which re-applies the same value idempotently.
    this.applyPosition(point);
    this.bus.emit('intent:set-toolbar-position', point);
  };

  private onDragPointerCancel = (): void => {
    if (!this.dragOrigin) return;
    this.endDrag();
    this.applyPosition(this.position); // restore the pre-drag rendering
  };

  private endDrag(): void {
    this.dragOrigin = null;
    this.dragMoved = false;
    this.dragPoint = null;
    this.el.classList.remove('wd-toolbar--dragging');
    document.removeEventListener('pointermove', this.onDragPointerMove);
    document.removeEventListener('pointerup', this.onDragPointerUp);
    document.removeEventListener('pointercancel', this.onDragPointerCancel);
  }

  /**
   * Keyboard placement: arrows nudge 16px, Escape cancels an in-flight drag
   * (the grip holds focus for the whole drag, so this handler sees it).
   * Moves are clamped and emitted as intents — same round trip as a drag
   * release, so the result is persisted per-`apiUrl` like a drag would be.
   */
  private onGripKeydown(event: KeyboardEvent): void {
    if (this.dragOrigin) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.endDrag();
        this.applyPosition(this.position);
      }
      return;
    }
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft':
        dx = -KEYBOARD_STEP_PX;
        break;
      case 'ArrowRight':
        dx = KEYBOARD_STEP_PX;
        break;
      case 'ArrowUp':
        dy = -KEYBOARD_STEP_PX;
        break;
      case 'ArrowDown':
        dy = KEYBOARD_STEP_PX;
        break;
      default:
        return;
    }
    // Arrows would otherwise scroll the page — the grip is the widget's
    // own control, so it consumes them.
    event.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const base = typeof this.position === 'string' ? { x: rect.left, y: rect.top } : this.position;
    const clamped = this.clampToViewport({ x: base.x + dx, y: base.y + dy });
    this.applyPosition(clamped);
    this.bus.emit('intent:set-toolbar-position', clamped);
  }

  private applyUnplaced(annotations: UnplacedAnnotation[]): void {
    this.unplaced = annotations;
    this.unplacedButton.textContent = `${annotations.length} unplaced`;
    this.syncUnplacedButton();
    this.renderUnplacedList();
  }

  /**
   * Issue #20 rule 4: the unplaced tray is an annotation surface, so it
   * hides along with the pins (and closes its panel if open) — same as it
   * already does when the unplaced set itself empties out. Factored out of
   * `applyUnplaced()` so both call sites (a changed unplaced set, and a
   * changed annotations-visibility flag) agree on the one hidden rule
   * instead of duplicating it.
   */
  private syncUnplacedButton(): void {
    this.unplacedButton.hidden = !this.annotationsVisible || this.unplaced.length === 0;
    if (this.unplacedButton.hidden && this.unplacedOpen) this.closeUnplacedPanel();
  }

  /**
   * Issue #20: reflects `Widget.annotationsVisible` on the toggle button.
   * `aria-pressed` means "annotations are hidden" here — an active,
   * unusual state worth flagging visually via the accent fill
   * `[aria-pressed='true']` already gets in toolbar.css — so it is the
   * negation of `visible`, not `visible` itself.
   */
  private applyAnnotationsVisibility(visible: boolean): void {
    this.annotationsVisible = visible;
    const label = visible ? 'Hide annotations' : 'Show annotations';
    this.annotationsButton.textContent = label;
    this.annotationsButton.setAttribute('aria-label', label);
    this.annotationsButton.setAttribute('aria-pressed', String(!visible));
    this.syncUnplacedButton();
  }

  private toggleUnplacedPanel(): void {
    if (this.unplacedOpen) this.closeUnplacedPanel();
    else this.openUnplacedPanel();
  }

  private openUnplacedPanel(): void {
    this.unplacedOpen = true;
    this.unplacedPanel.hidden = false;
    this.unplacedButton.setAttribute('aria-expanded', 'true');
    // Move focus into the panel, same as Form/Card do when their own
    // Popover opens — a keyboard user who activated the button lands
    // somewhere useful instead of the panel opening silently off-screen
    // from their focus's point of view.
    this.unplacedPanel.focus();
  }

  private closeUnplacedPanel(): void {
    this.unplacedOpen = false;
    this.unplacedPanel.hidden = true;
    this.unplacedButton.setAttribute('aria-expanded', 'false');
  }

  private renderUnplacedList(): void {
    this.unplacedListEl.replaceChildren(
      ...this.unplaced.map((a) =>
        h('li', { className: 'wd-unplaced-list__item' }, `${a.title} — ${a.authorName}`),
      ),
    );
  }

  dispose(): void {
    // Issue #21: a drag in flight has DOCUMENT-level listeners that outlive
    // this element — end it first so nothing leaks past the teardown.
    this.endDrag();
    this.layoutObserver.dispose();
    this.resizeObserver?.disconnect();
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    this.unplacedPanel.removeEventListener('keydown', this.panelKeydownHandler);
    this.el.remove();
  }
}
