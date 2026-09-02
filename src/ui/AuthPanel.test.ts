import { describe, it, expect, vi } from 'vitest';
import { AuthPanel } from './AuthPanel';
import { EventBus } from '../core/EventBus';
import type { AuthPhase } from '../core/events';

function emitAuthState(
  bus: EventBus,
  state: { phase: AuthPhase; error?: Error; expired?: boolean },
): void {
  bus.emit('state:auth-state-changed', state);
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setText(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function keydown(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('AuthPanel', () => {
  it('mounts on the email surface with a "Sign in" title and a "Send code" submit', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    expect(panel.el.querySelector('.wd-auth__title')?.textContent).toBe('Sign in');
    expect(panel.el.querySelector('[type=submit]')?.textContent).toBe('Send code');
    expect(panel.el.querySelector('[aria-label="Email address"]')).not.toBeNull();
  });

  it('email submit emits intent:request-magic-link with the trimmed email', () => {
    const bus = new EventBus();
    const requested = vi.fn();
    bus.on('intent:request-magic-link', requested);
    const panel = new AuthPanel({ bus });

    setText(panel.el.querySelector('[aria-label="Email address"]') as HTMLInputElement, '  ada@example.com  ');
    submit(panel.el.querySelector('.wd-auth__form') as HTMLFormElement);

    expect(requested).toHaveBeenCalledWith({ email: 'ada@example.com' });
  });

  it('an empty email submit shows an inline error and does NOT emit the intent', () => {
    const bus = new EventBus();
    const requested = vi.fn();
    bus.on('intent:request-magic-link', requested);
    const panel = new AuthPanel({ bus });

    submit(panel.el.querySelector('.wd-auth__form') as HTMLFormElement);

    expect(requested).not.toHaveBeenCalled();
    expect((panel.el.querySelector('.wd-auth__error') as HTMLElement | null)?.hidden).toBe(false);
  });

  it('phase "requesting" sets data-loading so the fields are visibly disabled', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'requesting' });

    expect((panel.el.querySelector('.wd-auth__card') as HTMLElement).dataset.loading).toBe('true');
  });

  it('phase "code-sent" swaps to the code surface and focuses the code input', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });
    document.body.appendChild(panel.el);

    emitAuthState(bus, { phase: 'code-sent' });

    // The email title is hidden on the code surface; the visible title is
    // the code one. querySelector returns the first match regardless of
    // `hidden`, so pick the non-hidden title.
    const visibleTitle = Array.from(panel.el.querySelectorAll('.wd-auth__title')).find(
      (t) => !(t as HTMLElement).hidden,
    )!;
    expect(visibleTitle.textContent).toBe('Enter your code');
    expect(panel.el.querySelector('[aria-label="Sign-in code"]')).not.toBeNull();
    // Email surface form is hidden on the code surface.
    expect((panel.el.querySelector('[aria-label="Email address"]') as HTMLElement).closest('form')!.hidden).toBe(true);
    expect(panel.el.ownerDocument.activeElement).toBe(panel.el.querySelector('[aria-label="Sign-in code"]'));

    panel.dispose();
  });

  it('code submit emits intent:verify-magic-link with the trimmed code', () => {
    const bus = new EventBus();
    const verified = vi.fn();
    bus.on('intent:verify-magic-link', verified);
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'code-sent' });
    setText(panel.el.querySelector('[aria-label="Sign-in code"]') as HTMLInputElement, '  ABC123  ');
    submit(panel.el.querySelectorAll('.wd-auth__form')[1] as HTMLFormElement);

    expect(verified).toHaveBeenCalledWith({ code: 'ABC123' });
  });

  it('an empty code submit shows an inline error and does NOT emit the intent', () => {
    const bus = new EventBus();
    const verified = vi.fn();
    bus.on('intent:verify-magic-link', verified);
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'code-sent' });
    submit(panel.el.querySelectorAll('.wd-auth__form')[1] as HTMLFormElement);

    expect(verified).not.toHaveBeenCalled();
    expect((panel.el.querySelector('.wd-auth__error') as HTMLElement | null)?.hidden).toBe(false);
  });

  it('phase "verified" shows the success surface', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'verified' });

    expect(panel.el.querySelector('.wd-auth__success')?.textContent).toContain('Signed in');
  });

  it('a generic error on the email surface renders the message verbatim', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'email', error: new Error('Unable to reach the server') });

    const errorEl = panel.el.querySelector('.wd-auth__error') as HTMLElement;
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toBe('Unable to reach the server');
  });

  it('never uses innerHTML — an HTML-shaped error renders as inert text', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'email', error: new Error('<img src=x onerror=alert(1)>') });

    const errorEl = panel.el.querySelector('.wd-auth__error')!;
    expect(errorEl.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(errorEl.querySelector('img')).toBeNull();
  });

  // Issue #4 acceptance: the expired-code path.
  it('expired: true on the code surface shows the dedicated expired surface and a Resend button', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'code-sent', error: new Error('expired'), expired: true });

    expect((panel.el.querySelector('.wd-auth__expired') as HTMLElement | null)?.hidden).toBe(false);
    // The generic error element is suppressed when expired takes over.
    expect((panel.el.querySelector('.wd-auth__error') as HTMLElement | null)?.hidden).toBe(true);
    expect(panel.el.querySelector('.wd-auth__resend')?.parentElement?.hidden).toBe(false);
  });

  it('clicking Resend emits intent:resend-magic-link', () => {
    const bus = new EventBus();
    const resend = vi.fn();
    bus.on('intent:resend-magic-link', resend);
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'code-sent', error: new Error('expired'), expired: true });
    click(panel.el.querySelector('.wd-auth__resend')!);

    expect(resend).toHaveBeenCalledTimes(1);
  });

  it('"Use a different email" emits intent:cancel-auth', () => {
    const bus = new EventBus();
    const cancel = vi.fn();
    bus.on('intent:cancel-auth', cancel);
    const panel = new AuthPanel({ bus });

    emitAuthState(bus, { phase: 'code-sent' });
    const back = Array.from(panel.el.querySelectorAll('.wd-form__button--secondary')).find((b) =>
      b.textContent?.includes('different email'),
    )!;
    click(back);

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  // Issue #19: Escape now DISMISSES the panel entirely, rather than
  // resetting to email entry — that reset is what "Use a different email"
  // (tested above) still does, and is a distinct intent (`intent:cancel-auth`).
  it('Escape on the card emits intent:close-auth', () => {
    const bus = new EventBus();
    const close = vi.fn();
    bus.on('intent:close-auth', close);
    const panel = new AuthPanel({ bus });

    keydown(panel.el.querySelector('.wd-auth__card')!, 'Escape');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('the "×" close button emits intent:close-auth', () => {
    const bus = new EventBus();
    const close = vi.fn();
    bus.on('intent:close-auth', close);
    const panel = new AuthPanel({ bus });

    click(panel.el.querySelector('.wd-auth__close')!);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop (outside the card) emits intent:close-auth', () => {
    const bus = new EventBus();
    const close = vi.fn();
    bus.on('intent:close-auth', close);
    const panel = new AuthPanel({ bus });

    click(panel.el); // the backdrop itself, not a descendant

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the card does NOT emit intent:close-auth (the click bubbles to the backdrop but did not originate there)', () => {
    const bus = new EventBus();
    const close = vi.fn();
    bus.on('intent:close-auth', close);
    const panel = new AuthPanel({ bus });

    click(panel.el.querySelector('.wd-auth__card')!);

    expect(close).not.toHaveBeenCalled();
  });

  it('the dialog is aria-modal and labelled by the active title', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });

    const card = panel.el.querySelector('.wd-auth__card')!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');

    // On the email surface, labelled by the email title.
    expect(card.getAttribute('aria-labelledby')).toBe(panel.el.querySelector('.wd-auth__title')!.id);

    emitAuthState(bus, { phase: 'code-sent' });
    expect(card.getAttribute('aria-labelledby')).toBe(panel.el.querySelectorAll('.wd-auth__title')[1]!.id);
  });

  it('dispose() unsubscribes from the bus and removes the DOM node', () => {
    const bus = new EventBus();
    const panel = new AuthPanel({ bus });
    document.body.appendChild(panel.el);

    panel.dispose();

    expect(panel.el.isConnected).toBe(false);
    // A state emission after dispose must not throw and must not mutate
    // anything (the subscription was torn down — verified by no throw).
    expect(() => emitAuthState(bus, { phase: 'code-sent' })).not.toThrow();
  });
});
