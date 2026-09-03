import { h } from './dom';
import { Pin } from './Pin';
import type { Annotation } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { ResolveConfidence } from '../anchor/types';

export interface OverlayOptions {
  bus: EventBus;
}

/**
 * `position: fixed; inset: 0; pointer-events: none` layer inside the shadow
 * root. Pins are the only children with `pointer-events: auto` (set in
 * pin.css), so the overlay never blocks clicks on the host page except
 * exactly where a pin is drawn. Positioned in VIEWPORT coordinates — pins
 * are just a recompute of `getBoundingClientRect()` on scroll, which is
 * what makes `position: sticky`/`fixed` anchors work correctly.
 *
 * M4 adds pin activation: a single delegated click/keydown listener on
 * `this.el` (not one per Pin) turns activating a pin into
 * `intent:open-annotation`. Delegation, not a listener per Pin, because
 * Pin/PinManager churn pins on every diff and a per-pin listener would need
 * matching add/remove bookkeeping for no benefit. Per the "no UI module
 * imports another UI module" rule this only imports `Pin` (its own child)
 * and `EventBus` (core/, not ui/), never Toolbar/Popover/etc.
 *
 * Issue #20 adds two INDEPENDENT visibility flags: `widgetVisible` (whole
 * widget, `state:visibility-changed`) and `annotationsVisible`
 * (annotations only, `state:annotations-visibility-changed`). The overlay
 * hides itself (`.wd-overlay--hidden`) whenever EITHER is false, rather
 * than Widget collapsing the two into one state and mutating it from both
 * `hide()`/`show()` and `setAnnotationsVisible()` — that would need a
 * "remember the previous annotation-visibility value" field just to make
 * `show()` restore it instead of force-revealing. Keeping the two flags
 * here, independently, makes that fall out for free: neither `hide()` nor
 * `show()` ever touches `annotationsVisible`.
 *
 * Deliberately NOT `.wd-pin--hidden`: `PinManager.repositionAll()` ->
 * `Pin.setPosition()` unconditionally removes that class on every layout
 * tick, so a second writer here would fight it. Container-level
 * `display: none` also removes pins from the tab order, which
 * `opacity`/`visibility` would not (pins are `role="button"`/`tabindex="0"`).
 * `repositionAll()` is left running while hidden — PinManager positions
 * from host-page element rects, so positions stay correct inside a
 * `display: none` overlay and there is no reveal flash.
 */
export class Overlay {
  readonly el: HTMLDivElement;
  private pins = new Map<string, Pin>();
  private bus: EventBus;
  private widgetVisible = true;
  private annotationsVisible = true;
  private unsubscribers: Array<() => void> = [];

  constructor(options: OverlayOptions) {
    this.bus = options.bus;
    // No `aria-hidden` here (unlike M2): pins are now genuinely interactive
    // (role="button", tabindex="0", real click/keyboard handling below), so
    // hiding the whole layer from assistive tech would create a
    // focusable-but-hidden a11y violation.
    this.el = h('div', { className: 'wd-overlay' });
    this.el.addEventListener('click', (event) => this.handleClick(event));
    this.el.addEventListener('keydown', (event) => this.handleKeydown(event));

    this.unsubscribers.push(
      this.bus.on('state:visibility-changed', ({ visible }) => {
        this.widgetVisible = visible;
        this.applyVisibility();
      }),
      this.bus.on('state:annotations-visibility-changed', ({ visible }) => {
        this.annotationsVisible = visible;
        this.applyVisibility();
      }),
    );
  }

  private applyVisibility(): void {
    this.el.classList.toggle('wd-overlay--hidden', !(this.widgetVisible && this.annotationsVisible));
  }

  /** Creates the pin if new, or renumbers it in place if it already exists. */
  upsertPin(annotation: Annotation, index: number): Pin {
    let pin = this.pins.get(annotation.id);
    if (!pin) {
      pin = new Pin({ annotation, index });
      this.pins.set(annotation.id, pin);
      this.el.appendChild(pin.el);
    } else {
      pin.setIndex(index, annotation.title);
    }
    return pin;
  }

  removePin(id: string): void {
    const pin = this.pins.get(id);
    if (!pin) return;
    pin.remove();
    this.pins.delete(id);
  }

  getPin(id: string): Pin | undefined {
    return this.pins.get(id);
  }

  private handleClick(event: MouseEvent): void {
    const pinEl = pinElementFromTarget(event.target);
    if (!pinEl) return;

    // Never let a pin click fall through to the host page or to Widget's
    // capture-phase click-to-annotate listener on `document` — a pin click
    // must never be misread as the start of a new annotation.
    event.preventDefault();
    event.stopPropagation();

    this.bus.emit('intent:open-annotation', {
      id: pinEl.dataset.webdotsPinId ?? '',
      clientX: event.clientX,
      clientY: event.clientY,
      confidence: readConfidence(pinEl),
    });
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const pinEl = pinElementFromTarget(event.target);
    if (!pinEl) return;

    event.preventDefault();
    event.stopPropagation();

    // No pointer position for a keyboard activation — anchor the popover to
    // the pin's own on-screen center instead.
    const rect = pinEl.getBoundingClientRect();
    this.bus.emit('intent:open-annotation', {
      id: pinEl.dataset.webdotsPinId ?? '',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      confidence: readConfidence(pinEl),
    });
  }

  dispose(): void {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    for (const pin of this.pins.values()) pin.remove();
    this.pins.clear();
    this.el.remove();
  }
}

function pinElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const pinEl = target.closest('.wd-pin');
  return pinEl instanceof HTMLElement ? pinEl : null;
}

/** Reads the confidence Pin.setPosition() last stamped onto the element, per plan §4's confidence union. */
function readConfidence(pinEl: HTMLElement): ResolveConfidence | undefined {
  const value = pinEl.dataset.wdConfidence;
  return value === 'exact' || value === 'degraded' || value === 'orphaned' || value === 'lost' ? value : undefined;
}
