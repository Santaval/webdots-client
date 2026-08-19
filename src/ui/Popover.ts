import { h } from './dom';

export interface PopoverPlacementInput {
  /** Viewport coordinates of the point the popover should anchor to (e.g. the click position). */
  anchorX: number;
  anchorY: number;
  /** The popover's own measured (or estimated) size. */
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}

export interface PopoverPlacement {
  x: number;
  y: number;
}

/**
 * Pure anchored-positioning + flip/shift math, shared by AnnotationForm now
 * and AnnotationCard in M4. Given a desired anchor point and the popover's
 * own size, returns a top-left position that keeps it fully on screen:
 * flips above the anchor when there's no room below, and shifts
 * horizontally to stay within the viewport. No DOM access — trivially
 * unit-testable.
 */
export function computePlacement(input: PopoverPlacementInput): PopoverPlacement {
  const margin = input.margin ?? 8;
  let x = input.anchorX + margin;
  let y = input.anchorY + margin;

  // Flip above the anchor if there's not enough room below; if there's
  // *also* no room above, just clamp inside the viewport.
  if (y + input.height > input.viewportHeight - margin) {
    const above = input.anchorY - input.height - margin;
    y = above >= margin ? above : Math.max(margin, input.viewportHeight - input.height - margin);
  }

  if (x + input.width > input.viewportWidth - margin) {
    x = Math.max(margin, input.viewportWidth - input.width - margin);
  }
  if (x < margin) x = margin;
  if (y < margin) y = margin;

  return { x, y };
}

export interface PopoverOptions {
  className?: string;
}

/**
 * A minimal anchored container that AnnotationForm (and later
 * AnnotationCard) render their content into. Owns only positioning and an
 * Escape-to-close listener — no knowledge of form fields or annotation
 * data, keeping it reusable across both popovers per the plan.
 */
export class Popover {
  readonly el: HTMLDivElement;

  private onEscape: (() => void) | null = null;
  private keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.onEscape?.();
    }
  };

  constructor(options: PopoverOptions = {}) {
    this.el = h('div', {
      className: `wd-popover ${options.className ?? ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'false',
    });
    this.el.addEventListener('keydown', this.keydownHandler);
  }

  setOnEscape(handler: () => void): void {
    this.onEscape = handler;
  }

  /** Must be called after the popover is in the DOM so its size can be measured. */
  placeAt(anchorX: number, anchorY: number): void {
    const rect = this.el.getBoundingClientRect();
    const placement = computePlacement({
      anchorX,
      anchorY,
      width: rect.width || 280,
      height: rect.height || 160,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    this.el.style.transform = `translate(${placement.x}px, ${placement.y}px)`;
  }

  dispose(): void {
    this.el.removeEventListener('keydown', this.keydownHandler);
    this.el.remove();
  }
}
