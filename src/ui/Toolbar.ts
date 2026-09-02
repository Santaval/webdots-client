import { h } from './dom';
import type { EventBus } from '../core/EventBus';
import type { WidgetMode } from '../core/types';

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
}

interface UnplacedAnnotation {
  id: string;
  title: string;
  authorName: string;
}

/**
 * The floating toolbar. Rendered inside the shadow root. Per the "no UI
 * module imports another UI module" rule, Toolbar only ever talks to the
 * EventBus: it emits `intent:toggle-mode` when the user clicks the toggle,
 * and reacts to `state:mode-changed` / `state:visibility-changed` to update
 * its own rendering. It never reaches into Overlay, Store, or anything else.
 *
 * M5 adds the "N unplaced" tray: `PinManager` emits `state:unplaced-changed`
 * whenever the set of `lost`-confidence annotations (resolved position
 * beyond the document height — plan §4 step 5, not rendered as a pin at
 * all) changes. These annotations exist on the server but can't be placed
 * on THIS page, so getting them into the UI at all — as a simple clickable
 * count that expands to a title+author list — is the requirement; no more
 * than that. The list panel is built and toggled entirely within Toolbar's
 * own element tree (no Popover reuse, no new wiring through Widget), same
 * boundary discipline as everything else here.
 */
export class Toolbar {
  readonly el: HTMLDivElement;

  private toggleButton: HTMLButtonElement;
  private countEl: HTMLSpanElement;
  private refreshButton: HTMLButtonElement;
  private unplacedButton: HTMLButtonElement;
  private unplacedPanel: HTMLDivElement;
  private unplacedListEl: HTMLUListElement;
  private bus: EventBus;
  private mode: WidgetMode;
  private signedIn: boolean;
  private count = 0;
  private unplaced: UnplacedAnnotation[] = [];
  private unplacedOpen = false;
  private unsubscribers: Array<() => void> = [];

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
      this.toggleButton,
      this.countEl,
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
    );

    this.applyMode(this.mode);
    this.applySignedIn(this.signedIn);
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

  private applyUnplaced(annotations: UnplacedAnnotation[]): void {
    this.unplaced = annotations;
    this.unplacedButton.hidden = annotations.length === 0;
    this.unplacedButton.textContent = `${annotations.length} unplaced`;

    if (annotations.length === 0 && this.unplacedOpen) {
      this.closeUnplacedPanel();
    }

    this.renderUnplacedList();
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
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    this.unplacedPanel.removeEventListener('keydown', this.panelKeydownHandler);
    this.el.remove();
  }
}
