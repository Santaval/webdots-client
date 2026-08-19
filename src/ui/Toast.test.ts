import { describe, it, expect, vi, afterEach } from 'vitest';
import { Toast } from './Toast';
import { EventBus } from '../core/EventBus';

function emitError(bus: EventBus, message: string): void {
  bus.emit('state:error', { error: new Error(message) });
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a toast with the error message when state:error fires', () => {
    const bus = new EventBus();
    const toast = new Toast({ bus });

    emitError(bus, 'Something went wrong');

    const message = toast.el.querySelector('.wd-toast__message');
    expect(message?.textContent).toBe('Something went wrong');
  });

  it('renders the server message VERBATIM — never re-interpreted or altered', () => {
    const bus = new EventBus();
    const toast = new Toast({ bus });

    emitError(bus, 'El título es requerido');

    expect(toast.el.querySelector('.wd-toast__message')?.textContent).toBe('El título es requerido');
  });

  it('never uses innerHTML — an HTML-shaped message renders as inert text, not markup', () => {
    const bus = new EventBus();
    const toast = new Toast({ bus });

    emitError(bus, '<img src=x onerror=alert(1)>');

    const message = toast.el.querySelector('.wd-toast__message')!;
    expect(message.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(message.querySelector('img')).toBeNull();
  });

  it('auto-dismisses after the configured delay', () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const toast = new Toast({ bus, autoDismissMs: 1000 });

    emitError(bus, 'Boom');
    expect(toast.el.querySelectorAll('.wd-toast')).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(toast.el.querySelectorAll('.wd-toast')).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toast.el.querySelectorAll('.wd-toast')).toHaveLength(0);
  });

  it('the close button dismisses immediately, before the auto-dismiss timer', () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const toast = new Toast({ bus, autoDismissMs: 5000 });

    emitError(bus, 'Boom');
    const closeButton = toast.el.querySelector('.wd-toast__close') as HTMLButtonElement;
    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(toast.el.querySelectorAll('.wd-toast')).toHaveLength(0);
  });

  it('multiple errors stack as separate toasts rather than replacing each other', () => {
    const bus = new EventBus();
    const toast = new Toast({ bus });

    emitError(bus, 'First failure');
    emitError(bus, 'Second failure');

    const messages = Array.from(toast.el.querySelectorAll('.wd-toast__message')).map((el) => el.textContent);
    expect(messages).toEqual(['First failure', 'Second failure']);
  });

  it('never blocks interaction: the region itself has pointer-events:none via its class, only individual toasts opt in', () => {
    const bus = new EventBus();
    const toast = new Toast({ bus });
    expect(toast.el.classList.contains('wd-toast-region')).toBe(true);
  });

  it('the region is an aria-live status region for assistive tech', () => {
    const bus = new EventBus();
    const toast = new Toast({ bus });
    expect(toast.el.getAttribute('role')).toBe('status');
    expect(toast.el.getAttribute('aria-live')).toBe('polite');
  });

  it('dispose() unsubscribes from the bus, clears pending timers, and removes the DOM node', () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const toast = new Toast({ bus, autoDismissMs: 1000 });
    document.body.appendChild(toast.el);

    emitError(bus, 'Boom');
    toast.dispose();

    // Advancing timers after dispose must not throw (the timer was cleared).
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();

    // A further error after dispose produces no new toast content — the
    // bus subscription was torn down.
    emitError(bus, 'After dispose');
    expect(toast.el.querySelectorAll('.wd-toast')).toHaveLength(1); // the pre-dispose toast, un-touched
    expect(toast.el.isConnected).toBe(false);
  });
});
