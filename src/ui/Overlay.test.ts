import { describe, it, expect, vi } from 'vitest';
import { Overlay } from './Overlay';
import { EventBus } from '../core/EventBus';
import type { Annotation } from '../core/types';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    pageUrl: 'https://example.com/',
    selector: 'button',
    x: 10,
    y: 20,
    anchor: null,
    title: 'Broken layout',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Overlay pin activation', () => {
  it('clicking a pin emits intent:open-annotation with its id and the click coordinates', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    const handler = vi.fn();
    bus.on('intent:open-annotation', handler);

    const pin = overlay.upsertPin(makeAnnotation({ id: 'a1' }), 1);
    document.body.appendChild(overlay.el); // dispatchEvent needs the node in a document for composedPath/target resolution to behave normally

    pin.el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 42, clientY: 84 }));

    // `confidence` mirrors the pin's own `data-wd-confidence` — 'exact' here
    // since this pin was never passed through `positionPin` (Pin.setPosition
    // was never called), only constructed, which defaults to 'exact'.
    expect(handler).toHaveBeenCalledWith({ id: 'a1', clientX: 42, clientY: 84, confidence: 'exact' });
    overlay.el.remove();
  });

  it('forwards the pin\'s CURRENT confidence (e.g. degraded) read off its data-wd-confidence attribute', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    const handler = vi.fn();
    bus.on('intent:open-annotation', handler);

    const pin = overlay.upsertPin(makeAnnotation({ id: 'a1' }), 1);
    pin.setPosition({ x: 0, y: 0 }, 'degraded');
    document.body.appendChild(overlay.el);

    pin.el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 2 }));

    expect(handler).toHaveBeenCalledWith({ id: 'a1', clientX: 1, clientY: 2, confidence: 'degraded' });
    overlay.el.remove();
  });

  it('a click that does not land on a pin (e.g. the empty overlay layer) does not emit', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    const handler = vi.fn();
    bus.on('intent:open-annotation', handler);

    overlay.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('pressing Enter on a focused pin emits intent:open-annotation, anchored to the pin\'s own position', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    const handler = vi.fn();
    bus.on('intent:open-annotation', handler);

    const pin = overlay.upsertPin(makeAnnotation({ id: 'a2' }), 1);
    document.body.appendChild(overlay.el);

    pin.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].id).toBe('a2');
    expect(typeof handler.mock.calls[0]![0].clientX).toBe('number');
    overlay.el.remove();
  });

  it('a keydown for a key other than Enter/Space does not emit', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    const handler = vi.fn();
    bus.on('intent:open-annotation', handler);

    const pin = overlay.upsertPin(makeAnnotation(), 1);
    pin.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('the overlay element itself carries no aria-hidden, since pins are now genuinely interactive', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    expect(overlay.el.hasAttribute('aria-hidden')).toBe(false);
  });

  it('a pin click does not bubble past the overlay to a document-level bubble-phase listener', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    document.body.appendChild(overlay.el);

    const bubbleHandler = vi.fn();
    document.addEventListener('click', bubbleHandler);

    const pin = overlay.upsertPin(makeAnnotation(), 1);
    pin.el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    document.removeEventListener('click', bubbleHandler);
    overlay.el.remove();

    expect(bubbleHandler).not.toHaveBeenCalled();
  });
});

// Issue #20: the overlay hides off TWO independent flags — whole-widget
// visibility (`state:visibility-changed`) and annotations-only visibility
// (`state:annotations-visibility-changed`) — and applies
// `.wd-overlay--hidden` when EITHER is false. See Overlay's class doc for
// why this beats collapsing the two into one Widget-owned state.
describe('Overlay visibility (issue #20)', () => {
  it('starts visible (no .wd-overlay--hidden) by default', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });
    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(false);
  });

  it('state:visibility-changed with visible:false hides the overlay', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });

    bus.emit('state:visibility-changed', { visible: false });

    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(true);
  });

  it('state:annotations-visibility-changed with visible:false hides the overlay independently', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });

    bus.emit('state:annotations-visibility-changed', { visible: false });

    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(true);
  });

  it('re-showing ONE flag does not reveal the overlay while the other is still false', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });

    bus.emit('state:visibility-changed', { visible: false });
    bus.emit('state:annotations-visibility-changed', { visible: false });
    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(true);

    bus.emit('state:visibility-changed', { visible: true });
    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(true); // annotations still hidden

    bus.emit('state:annotations-visibility-changed', { visible: true });
    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(false); // both visible now
  });

  it('dispose() unsubscribes — a later state event no longer toggles the (removed) element', () => {
    const bus = new EventBus();
    const overlay = new Overlay({ bus });

    overlay.dispose();
    bus.emit('state:visibility-changed', { visible: false });
    bus.emit('state:annotations-visibility-changed', { visible: false });

    expect(overlay.el.classList.contains('wd-overlay--hidden')).toBe(false);
  });
});
