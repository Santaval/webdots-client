import { h } from './dom';
import type { EventBus } from '../core/EventBus';
import type { AuthPhase } from '../core/events';

export interface AuthPanelOptions {
  bus: EventBus;
}

/**
 * M3 reviewer magic-link sign-in panel. Rendered inside the shadow root as a
 * centered modal-style card (its own `.wd-auth` chrome, NOT pin-anchored
 * like Popover). Per the "no UI module imports another UI module" rule,
 * AuthPanel only ever talks to the EventBus: it emits
 * `intent:request-magic-link` / `intent:verify-magic-link` /
 * `intent:cancel-auth` / `intent:close-auth` / `intent:resend-magic-link`
 * and reacts to `state:auth-state-changed` to re-render. It has no idea
 * what an AuthAPI, a token, or a Widget is — Widget combines the submitted
 * email/code with the API calls and emits the resulting phase back.
 *
 * The two surfaces (email entry, code entry) are both built up front and
 * toggled by `data-phase` on the card; rebuilding on every phase change
 * would drop focus mid-flow and clobber the user's typed-but-unsubmitted
 * input. Loading is shown via a `data-loading` attribute (CSS dims and
 * disables the fields). Errors render verbatim (`error.message`, the same
 * contract Toast uses — `ApiError` surfaces the server's 4xx message, 5xx/
 * network/timeout get generic copy), and `expired: true` swaps the generic
 * error for the dedicated expired-code surface plus a "Resend" action that
 * emits `intent:resend-magic-link`.
 *
 * Issue #19 — dismissal: the panel is opened deliberately (the toolbar's
 * "Sign in to annotate" button, or a programmatic `setMode('annotate')`),
 * not forced on load, so it must also be closeable. Three paths all emit
 * `intent:close-auth` — Escape, the "×" button, and a click on the backdrop
 * itself (not one that bubbled out of the card) — and are kept distinct
 * from `intent:cancel-auth` ("Use a different email", which only resets the
 * surface back to email entry rather than closing anything).
 *
 * A11y: `role="dialog"` + `aria-modal="true"` + an `aria-labelledby` the
 * active title; focus moves into the active input on mount and on each
 * surface transition; Escape emits `intent:close-auth`. Never uses
 * `innerHTML` — every node is `createElement`/`textContent`, so an
 * attacker-controlled error message (or a hostile host page) can never be
 * interpreted as markup.
 */
export class AuthPanel {
  readonly el: HTMLDivElement;

  private bus: EventBus;
  private phase: AuthPhase = 'email';
  private lastError: Error | undefined;
  private lastExpired = false;
  private lastEmail = '';
  private unsubscribers: Array<() => void> = [];

  private card: HTMLDivElement;
  private emailTitle: HTMLHeadingElement;
  private emailSubtitle: HTMLParagraphElement;
  private emailView: HTMLFormElement;
  private emailInput: HTMLInputElement;
  private codeView: HTMLFormElement;
  private codeTitle: HTMLHeadingElement;
  private codeSubtitle: HTMLParagraphElement;
  private codeInput: HTMLInputElement;
  private errorEl: HTMLParagraphElement;
  private expiredEl: HTMLParagraphElement;
  private resendButton: HTMLButtonElement;
  private successView: HTMLDivElement;
  private closeButton: HTMLButtonElement;

  private keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.bus.emit('intent:close-auth', undefined);
    }
  };

  constructor(options: AuthPanelOptions) {
    this.bus = options.bus;

    this.emailInput = h('input', {
      className: 'wd-form__input',
      type: 'email',
      placeholder: 'you@example.com',
      required: true,
      'aria-label': 'Email address',
      autocomplete: 'email',
    });

    this.emailTitle = h('h2', { className: 'wd-auth__title' }, 'Sign in');
    this.emailSubtitle = h('p', { className: 'wd-auth__subtitle' }, 'Enter your email and we’ll send you a sign-in code.');

    const sendButton = h(
      'button',
      { type: 'submit', className: 'wd-form__button wd-form__button--primary' },
      'Send code',
    );

    this.emailView = h(
      'form',
      {
        className: 'wd-auth__form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          this.handleEmailSubmit();
        },
      },
      h('div', { className: 'wd-form__field' }, h('label', { className: 'wd-form__label' }, 'Email'), this.emailInput),
      h('div', { className: 'wd-auth__actions' }, sendButton),
    );

    this.codeInput = h('input', {
      className: 'wd-form__input',
      type: 'text',
      placeholder: '6-character code',
      required: true,
      'aria-label': 'Sign-in code',
      autocomplete: 'one-time-code',
      maxlength: '64',
    });

    this.codeTitle = h('h2', { className: 'wd-auth__title' }, 'Enter your code');
    this.codeSubtitle = h('p', { className: 'wd-auth__subtitle' }, 'We sent a code to your email.');

    this.resendButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-auth__resend',
        onclick: () => this.bus.emit('intent:resend-magic-link', undefined),
      },
      'Resend code',
    );

    const verifyButton = h(
      'button',
      { type: 'submit', className: 'wd-form__button wd-form__button--primary' },
      'Verify',
    );
    const backButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-form__button wd-form__button--secondary',
        onclick: () => this.bus.emit('intent:cancel-auth', undefined),
      },
      'Use a different email',
    );

    this.codeView = h(
      'form',
      {
        className: 'wd-auth__form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          this.handleCodeSubmit();
        },
      },
      h('div', { className: 'wd-form__field' }, h('label', { className: 'wd-form__label' }, 'Code'), this.codeInput),
      h('div', { className: 'wd-auth__actions' }, backButton, verifyButton),
    );

    this.errorEl = h('p', { className: 'wd-auth__error', role: 'alert', hidden: true });
    this.expiredEl = h('p', { className: 'wd-auth__expired', role: 'alert', hidden: true }, 'That sign-in code has expired or is invalid.');
    this.successView = h('div', { className: 'wd-auth__success-view' }, h('p', { className: 'wd-auth__success' }, 'Signed in — loading annotations…'));

    // Issue #19: the panel is no longer mandatory, so it needs a visible way
    // to go away. Same close-button shape as AnnotationCard's (`×`,
    // `aria-label`, `data-wd-action`) but its own class since it sits over
    // the card rather than in a `.wd-card__header` row.
    this.closeButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-auth__close',
        'aria-label': 'Close sign-in',
        'data-wd-action': 'close',
        onclick: () => this.bus.emit('intent:close-auth', undefined),
      },
      '×',
    );

    this.card = h(
      'div',
      {
        className: 'wd-auth__card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wd-auth-title',
        tabindex: '-1',
        onkeydown: this.keydownHandler,
      },
      this.closeButton,
      this.emailTitle,
      this.emailSubtitle,
      this.emailView,
      this.codeTitle,
      this.codeSubtitle,
      this.codeView,
      this.errorEl,
      this.expiredEl,
      h('div', { hidden: true }, this.resendButton),
      this.successView,
    );
    this.emailTitle.id = 'wd-auth-title-email';
    this.codeTitle.id = 'wd-auth-title-code';

    // Backdrop click dismisses — but only a click that actually landed on
    // the backdrop itself (`event.target === this.el`), not one that
    // bubbled up from inside the card. Without that check, any click
    // anywhere in the card (which bubbles through `this.el`) would close it.
    this.el = h(
      'div',
      {
        className: 'wd-auth',
        onclick: (event: MouseEvent) => {
          if (event.target === this.el) this.bus.emit('intent:close-auth', undefined);
        },
      },
      this.card,
    );

    this.unsubscribers.push(
      this.bus.on('state:auth-state-changed', (state) => this.applyState(state)),
    );

    this.render();
  }

  /** Moves focus into the active input — called by Widget after mounting. */
  focus(): void {
    if (this.phase === 'code-sent' || this.phase === 'verifying') {
      this.codeInput.focus();
    } else if (this.phase !== 'verified') {
      this.emailInput.focus();
    } else {
      this.card.focus();
    }
  }

  private applyState(state: { phase: AuthPhase; error?: Error; expired?: boolean }): void {
    this.phase = state.phase;
    this.lastError = state.error;
    this.lastExpired = Boolean(state.expired);
    this.render();
    // Move focus to the active field on surface transitions so a keyboard
    // user lands somewhere useful (e.g. into the code field once the email
    // is accepted), mirroring Popover/Form/Card's "focus moves into the
    // surface" contract.
    if (state.phase === 'code-sent') this.codeInput.focus();
    else if (state.phase === 'email' && state.error) this.emailInput.focus();
  }

  private handleEmailSubmit(): void {
    const email = this.emailInput.value.trim();
    if (!email) {
      this.showError('Enter your email address.');
      this.emailInput.focus();
      return;
    }
    this.lastEmail = email;
    this.bus.emit('intent:request-magic-link', { email });
  }

  private handleCodeSubmit(): void {
    const code = this.codeInput.value.trim();
    if (!code) {
      this.showError('Enter the code from your email.');
      this.codeInput.focus();
      return;
    }
    this.bus.emit('intent:verify-magic-link', { code });
  }

  private showError(message: string): void {
    this.lastError = new Error(message);
    this.lastExpired = false;
    this.render();
  }

  private render(): void {
    const surface: 'email' | 'code' | 'success' =
      this.phase === 'verified' ? 'success' : this.phase === 'code-sent' || this.phase === 'verifying' ? 'code' : 'email';
    const loading = this.phase === 'requesting' || this.phase === 'verifying';

    this.card.dataset.phase = surface;
    this.card.dataset.loading = String(loading);

    this.emailTitle.hidden = surface !== 'email';
    this.emailSubtitle.hidden = surface !== 'email';
    this.emailView.hidden = surface !== 'email';
    this.codeTitle.hidden = surface !== 'code';
    this.codeSubtitle.hidden = surface !== 'code';
    this.codeView.hidden = surface !== 'code';
    this.successView.hidden = surface !== 'success';

    // aria-labelledby points at whichever title is visible.
    if (surface === 'code') this.card.setAttribute('aria-labelledby', this.codeTitle.id);
    else this.card.setAttribute('aria-labelledby', this.emailTitle.id);

    // Error vs expired: expired takes over the code surface; generic errors
    // render verbatim on either surface. Both are hidden on the success view.
    const showErrorNow = surface !== 'success' && this.lastError && !this.lastExpired;
    this.errorEl.hidden = !showErrorNow;
    if (showErrorNow) this.errorEl.textContent = this.lastError!.message;

    const showExpiredNow = surface === 'code' && this.lastExpired;
    this.expiredEl.hidden = !showExpiredNow;
    this.resendButton.parentElement!.hidden = !showExpiredNow;

    // Keep the code subtitle in sync with the email the link was sent to.
    if (this.lastEmail) {
      this.codeSubtitle.textContent = `We sent a code to ${this.lastEmail}.`;
    }
  }

  dispose(): void {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    this.el.remove();
  }
}
