import { generateSelector } from './generateSelector';
import type { AnchorDescriptor } from './types';

export interface CreateAnchorOptions {
  testIdAttributes?: string[];
}

export interface CreateAnchorResult {
  anchor: AnchorDescriptor;
  /** Absolute page pixels — the last-resort fallback position. */
  pageX: number;
  pageY: number;
}

/**
 * Captures a click as an `AnchorDescriptor` plus the absolute page
 * coordinates of the click point. `ratio` is the click position as a
 * fraction of the element's box (guarded against a zero-size box, which
 * happens for collapsed/hidden elements), clamped to [0, 1] so it always
 * maps back inside the element even if float error pushes it slightly out.
 */
export function createAnchor(
  element: Element,
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  options: CreateAnchorOptions = {},
): CreateAnchorResult {
  const generated = generateSelector(element, { testIdAttributes: options.testIdAttributes });
  const rect = element.getBoundingClientRect();

  const ratioX = rect.width === 0 ? 0.5 : clamp01((event.clientX - rect.left) / rect.width);
  const ratioY = rect.height === 0 ? 0.5 : clamp01((event.clientY - rect.top) / rect.height);

  const anchor: AnchorDescriptor = {
    v: 1,
    strategy: generated.strategy,
    selector: generated.selector,
    path: generated.path,
    ratio: { x: ratioX, y: ratioY },
    viewportW: window.innerWidth,
    tag: generated.tag,
    textHint: generated.textHint,
  };

  const pageX = event.clientX + window.scrollX;
  const pageY = event.clientY + window.scrollY;

  return { anchor, pageX, pageY };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
