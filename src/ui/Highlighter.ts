import { h } from './dom';
import type { EventBus } from '../core/EventBus';
import { rafThrottle, type Throttled } from '../utils/rafThrottle';
import type { WidgetMode } from '../core/types';

export interface HighlighterOptions {
  bus: EventBus;
  /** The widget's own shadow HOST element (light DOM) — used to ignore hovers over our own UI. */
  hostElement: Element;
  ignoreSelector?: string;
}

/**
 * Hover outline of the element under the cursor while in `annotate` mode.
 * Only ever talks to the EventBus (subscribes to `state:mode-changed`) and
 * the raw DOM — never imports Overlay/Toolbar/etc.
 *
 * Uses `event.composedPath()[0]` rather than `event.target` to find the
 * true innermost element even across the shadow boundary, and checks
 * whether our own shadow host appears anywhere in that path to skip
 * highlighting our own UI (native `click`/`mousemove` events are
 * "composed", so a plain `document`-level listener sees the shadow HOST as
 * `event.target` for anything happening inside it — `composedPath()` is
 * what un-retargets that).
 */
export class Highlighter {
  readonly el: HTMLDivElement;

  private bus: EventBus;
  private hostElement: Element;
  private ignoreSelector: string | undefined;
  private mode: WidgetMode = 'idle';
  private unsubscribers: Array<() => void> = [];
  private onMouseMove: Throttled<(event: MouseEvent) => void>;
  private rawHandler = (event: MouseEvent) => this.handleMouseMove(event);

  constructor(options: HighlighterOptions) {
    this.bus = options.bus;
    this.hostElement = options.hostElement;
    this.ignoreSelector = options.ignoreSelector;

    this.el = h('div', { className: 'wd-highlight wd-highlight--hidden', 'aria-hidden': 'true' });

    this.onMouseMove = rafThrottle(this.rawHandler);
    document.addEventListener('mousemove', this.onMouseMove, true);

    this.unsubscribers.push(
      this.bus.on('state:mode-changed', ({ mode }) => {
        this.mode = mode;
        if (mode !== 'annotate') this.clear();
      }),
    );
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.mode !== 'annotate') return;

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const target = path[0];

    if (!(target instanceof Element)) {
      this.clear();
      return;
    }
    if (path.includes(this.hostElement)) {
      this.clear();
      return;
    }
    if (this.ignoreSelector && target.closest(this.ignoreSelector)) {
      this.clear();
      return;
    }

    this.show(target);
  }

  private show(target: Element): void {
    const rect = target.getBoundingClientRect();
    this.el.classList.remove('wd-highlight--hidden');
    this.el.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    this.el.style.width = `${rect.width}px`;
    this.el.style.height = `${rect.height}px`;
  }

  private clear(): void {
    this.el.classList.add('wd-highlight--hidden');
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMouseMove, true);
    this.onMouseMove.cancel();
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    this.el.remove();
  }
}
