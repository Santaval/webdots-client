import { h } from './dom';
import type { Annotation } from '../core/types';
import type { ResolveConfidence } from '../anchor/types';

export interface PinOptions {
  annotation: Annotation;
  index: number;
}

const SHIFTED_SUFFIX = ' (position may have shifted)';

/**
 * A single numbered pin marker. Knows only its own id + how to position and
 * style itself — Overlay owns the collection, PinManager owns resolving
 * *where* to put it (and at what confidence). Positioned via `transform`
 * (not `left`/`top`) so repositioning on scroll/resize never triggers
 * layout.
 *
 * M5 confidence-aware treatment: `exact` looks like the original solid pin;
 * `degraded`/`orphaned` get a dashed border (`wd-pin--degraded`) AND an
 * amended aria-label, so a screen-reader user gets the same "this may have
 * moved" signal a sighted user gets from the dashed ring. `lost` renders as
 * `setPosition(null)` always has — hidden entirely (plan §4: lost pins are
 * not rendered, only counted, via the Toolbar's "N unplaced" tray).
 * `data-wd-confidence` mirrors the current confidence onto the DOM node
 * itself so `Overlay`'s click handler can read it back and forward it on
 * `intent:open-annotation` without needing to import PinManager (which
 * would violate "no UI module imports another UI module").
 *
 * `resolve cache`: PinManager avoids re-running the full selector-resolution
 * chain on every layout tick by caching the last-resolved live element (and
 * the confidence that produced it) here, on the Pin. PinManager only
 * re-resolves when the cached element is falsy OR `!el.isConnected` — which
 * is what lets a React/Vue re-mount (a genuinely different DOM node, even
 * for a still-matching selector) self-heal without a MutationObserver: the
 * moment the OLD node is detached, the cheap `isConnected` check fails and
 * the next tick re-runs `resolveSelector` for real.
 */
export class Pin {
  readonly el: HTMLDivElement;
  readonly id: string;

  private index: number;
  private title: string;
  private confidence: ResolveConfidence = 'exact';

  private cachedElement: Element | null = null;
  private cachedConfidence: ResolveConfidence = 'exact';

  constructor(options: PinOptions) {
    this.id = options.annotation.id;
    this.index = options.index;
    this.title = options.annotation.title;
    this.el = h(
      'div',
      {
        className: 'wd-pin',
        role: 'button',
        tabindex: '0',
        dataset: { webdotsPinId: this.id, wdConfidence: this.confidence },
      },
      String(this.index),
    );
    this.updateAriaLabel();
  }

  setIndex(index: number, title: string): void {
    this.index = index;
    this.title = title;
    this.el.textContent = String(index);
    this.updateAriaLabel();
  }

  /**
   * `null` hides the pin entirely (the `lost` confidence case, or an
   * annotation with no anchor data at all). Otherwise positions it and
   * applies the confidence-appropriate visual/aria treatment — see the
   * class doc.
   */
  setPosition(point: { x: number; y: number } | null, confidence: ResolveConfidence = 'exact'): void {
    this.confidence = confidence;
    this.el.dataset.wdConfidence = confidence;

    if (!point) {
      this.el.classList.add('wd-pin--hidden');
      return;
    }
    this.el.classList.remove('wd-pin--hidden');

    const shifted = confidence === 'degraded' || confidence === 'orphaned';
    this.el.classList.toggle('wd-pin--degraded', shifted);
    this.updateAriaLabel();

    // Compose the placement translate with a fixed centering translate in
    // one transform value — a second `style.transform` assignment would
    // replace rather than combine with a CSS class's own transform.
    this.el.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
  }

  /** The element (and confidence) `resolveSelector` found last time PinManager actually ran it. */
  getResolveCache(): { element: Element | null; confidence: ResolveConfidence } {
    return { element: this.cachedElement, confidence: this.cachedConfidence };
  }

  setResolveCache(element: Element | null, confidence: ResolveConfidence): void {
    this.cachedElement = element;
    this.cachedConfidence = confidence;
  }

  remove(): void {
    this.el.remove();
  }

  private updateAriaLabel(): void {
    const shifted = this.confidence === 'degraded' || this.confidence === 'orphaned';
    this.el.setAttribute('aria-label', `Annotation ${this.index}: ${this.title}${shifted ? SHIFTED_SUFFIX : ''}`);
  }
}
