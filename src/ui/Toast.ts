import { h } from './dom';
import type { EventBus } from '../core/EventBus';

export interface ToastOptions {
  bus: EventBus;
  /** Default 5000ms. */
  autoDismissMs?: number;
}

const DEFAULT_AUTO_DISMISS_MS = 5000;

/**
 * Transient error messages inside the shadow root. Per the "no UI module
 * imports another UI module" rule, Toast only ever talks to the EventBus —
 * it subscribes to `state:error` itself (the same self-managing pattern
 * Toolbar already uses for `state:mode-changed`/`state:annotations-changed`)
 * rather than Widget pushing messages into it directly.
 *
 * `state:error` already carries the copy `api/errors.ts` decided on: the
 * server's verbatim message for 4xx, generic English for 5xx/network/
 * timeout (`ApiError`/`NetworkError`/`TimeoutError` — see errors.ts's module
 * doc). Toast does no further translation; it just renders `error.message`.
 *
 * `.wd-toast-region` is a full-corner `position: fixed` container with
 * `pointer-events: none` — like Overlay, only the individual toast cards
 * inside it (`pointer-events: auto`) are interactive, so an empty region
 * never blocks clicks on the page or the widget's own UI underneath it.
 * `role="status"`/`aria-live="polite"` announces new toasts to assistive
 * tech without stealing focus.
 *
 * Each toast auto-dismisses after `autoDismissMs`, with its own close (×)
 * button for a manual dismiss at any time. Multiple simultaneous failures
 * stack (one card per `state:error` emission) rather than replacing each
 * other, so a burst of failures (e.g. list + create both failing) isn't
 * silently collapsed into one.
 */
export class Toast {
  readonly el: HTMLDivElement;

  private bus: EventBus;
  private autoDismissMs: number;
  private unsubscribers: Array<() => void> = [];
  private timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(options: ToastOptions) {
    this.bus = options.bus;
    this.autoDismissMs = options.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS;

    this.el = h('div', { className: 'wd-toast-region', role: 'status', 'aria-live': 'polite' });

    this.unsubscribers.push(this.bus.on('state:error', ({ error }) => this.show(error.message)));
  }

  private show(message: string): void {
    let toastEl!: HTMLDivElement;
    const closeButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-toast__close',
        'aria-label': 'Dismiss',
        onclick: () => this.dismiss(toastEl),
      },
      '×',
    );

    toastEl = h(
      'div',
      { className: 'wd-toast', role: 'alert' },
      h('p', { className: 'wd-toast__message' }, message),
      closeButton,
    );

    this.el.appendChild(toastEl);

    const timer = setTimeout(() => this.dismiss(toastEl), this.autoDismissMs);
    this.timers.set(toastEl, timer);
  }

  private dismiss(toastEl: HTMLDivElement): void {
    const timer = this.timers.get(toastEl);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(toastEl);
    toastEl.remove();
  }

  dispose(): void {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.el.remove();
  }
}
