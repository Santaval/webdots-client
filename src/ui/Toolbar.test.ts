import { describe, it, expect, afterEach, vi } from 'vitest';
import { Toolbar } from './Toolbar';
import { EventBus } from '../core/EventBus';

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function escape(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('Toolbar "N unplaced" tray', () => {
  it('the unplaced button is hidden when there are no unplaced annotations', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    expect(button.hidden).toBe(true);
  });

  it('state:unplaced-changed with a non-empty list reveals the button with the count', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });

    bus.emit('state:unplaced-changed', {
      annotations: [
        { id: 'a', title: 'Off-screen note', authorName: 'QA One' },
        { id: 'b', title: 'Way below', authorName: 'QA Two' },
      ],
    });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('2 unplaced');
  });

  it('clicking the button opens a panel listing title + author for each unplaced annotation', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });

    bus.emit('state:unplaced-changed', {
      annotations: [{ id: 'a', title: 'Off-screen note', authorName: 'QA One' }],
    });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);

    click(button);

    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = Array.from(panel.querySelectorAll('.wd-unplaced-list__item')).map((el) => el.textContent);
    expect(items).toEqual(['Off-screen note — QA One']);
  });

  it('clicking the button again closes the panel', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;

    click(button);
    expect(panel.hidden).toBe(false);
    click(button);
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('the list updates in place when state:unplaced-changed fires again while the panel is open', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'First', authorName: 'A' }] });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    click(button);

    bus.emit('state:unplaced-changed', {
      annotations: [
        { id: 'a', title: 'First', authorName: 'A' },
        { id: 'b', title: 'Second', authorName: 'B' },
      ],
    });

    const items = Array.from(toolbar.el.querySelectorAll('.wd-unplaced-list__item')).map((el) => el.textContent);
    expect(items).toEqual(['First — A', 'Second — B']);
  });

  it('the tray hides itself and closes its panel once the unplaced set empties out', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    click(button); // open it

    bus.emit('state:unplaced-changed', { annotations: [] });

    expect(button.hidden).toBe(true);
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);
  });

  it('dispose() unsubscribes — a later state:unplaced-changed no longer updates the (removed) button', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;

    toolbar.dispose();
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    expect(button.hidden).toBe(true); // never updated post-dispose
  });
});

// Issue #19: the toggle button's label doubles as the affordance that
// explains what clicking it does — "Sign in to annotate" while signed out,
// reverting to "New annotation" once a session exists. No extra chip or
// chrome, per the decision settled with the user.
describe('Toolbar signed-out label (issue #19)', () => {
  it('reads "Sign in to annotate" when constructed with initialSignedIn: false', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: false });

    expect(toolbar.el.querySelector('.wd-toolbar__button')?.textContent).toBe('Sign in to annotate');
    expect(toolbar.el.querySelector('.wd-toolbar__button')?.getAttribute('aria-label')).toBe('Sign in to annotate');
  });

  it('reads "New annotation" when constructed with initialSignedIn: true', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });

    expect(toolbar.el.querySelector('.wd-toolbar__button')?.textContent).toBe('New annotation');
  });

  it('flips from "Sign in to annotate" to "New annotation" on state:session-changed', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: false });
    const button = toolbar.el.querySelector('.wd-toolbar__button') as HTMLButtonElement;
    expect(button.textContent).toBe('Sign in to annotate');

    bus.emit('state:session-changed', { signedIn: true });

    expect(button.textContent).toBe('New annotation');
    expect(button.getAttribute('aria-label')).toBe('New annotation');
  });

  it('flips back to "Sign in to annotate" on state:session-changed with signedIn: false', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    const button = toolbar.el.querySelector('.wd-toolbar__button') as HTMLButtonElement;

    bus.emit('state:session-changed', { signedIn: false });

    expect(button.textContent).toBe('Sign in to annotate');
  });

  it('focusToggle() moves focus to the toggle button', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    document.body.appendChild(toolbar.el);
    const button = toolbar.el.querySelector('.wd-toolbar__button') as HTMLButtonElement;

    toolbar.focusToggle();

    expect(document.activeElement).toBe(button);
    toolbar.el.remove();
  });
});

describe('Toolbar "N unplaced" panel keyboard/focus behavior (M6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opening the panel (click) moves focus into it', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    document.body.appendChild(toolbar.el);
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    click(button);

    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;
    expect(document.activeElement).toBe(panel);
  });

  it('Escape closes the panel and returns focus to the toggle button', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    document.body.appendChild(toolbar.el);
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    click(button);
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;
    expect(panel.hidden).toBe(false);

    escape(panel);

    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('the panel is focusable (tabindex="-1") and carries a dialog role + accessible name', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;

    expect(panel.getAttribute('tabindex')).toBe('-1');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Unplaced annotations');
  });

  it('dispose() removes the panel keydown listener', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    document.body.appendChild(toolbar.el);
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });
    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    click(button);
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;

    toolbar.dispose();

    // Escape after dispose must not throw and must not re-trigger any
    // handler logic (nothing left listening).
    expect(() => escape(panel)).not.toThrow();
  });
});

// Issue #20: a second, independent visibility toggle for annotations
// (pins/overlay/popovers) — distinct from `state:visibility-changed`, which
// is the whole-widget show()/hide(). The toolbar itself is never hidden by
// this toggle.
describe('Toolbar annotation-visibility toggle (issue #20)', () => {
  it('the annotations button renders after the mode-toggle button in document order', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });

    // Widget.test.ts relies on `.wd-toolbar__button` (first match) meaning
    // the mode toggle — the annotations button must never come before it.
    const firstMatch = toolbar.el.querySelector('.wd-toolbar__button');
    expect(firstMatch?.classList.contains('wd-toolbar__annotations')).toBe(false);

    const annotationsButton = toolbar.el.querySelector('.wd-toolbar__annotations');
    expect(annotationsButton).not.toBeNull();
  });

  it('clicking the annotations button emits intent:toggle-annotations', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    const handler = vi.fn();
    bus.on('intent:toggle-annotations', handler);

    const button = toolbar.el.querySelector('.wd-toolbar__annotations') as HTMLButtonElement;
    click(button);

    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it('state:annotations-visibility-changed with visible:false flips the label and presses the button', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    const button = toolbar.el.querySelector('.wd-toolbar__annotations') as HTMLButtonElement;
    expect(button.textContent).toBe('Hide annotations');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    bus.emit('state:annotations-visibility-changed', { visible: false });

    expect(button.textContent).toBe('Show annotations');
    expect(button.getAttribute('aria-label')).toBe('Show annotations');
    // aria-pressed means "annotations are hidden" — the negation of visible.
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('state:annotations-visibility-changed with visible:true flips back', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    bus.emit('state:annotations-visibility-changed', { visible: false });

    bus.emit('state:annotations-visibility-changed', { visible: true });

    const button = toolbar.el.querySelector('.wd-toolbar__annotations') as HTMLButtonElement;
    expect(button.textContent).toBe('Hide annotations');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('rule 4: hiding annotations hides the unplaced tray and closes its open panel', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    document.body.appendChild(toolbar.el);
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    const unplacedButton = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    expect(unplacedButton.hidden).toBe(false);
    click(unplacedButton); // open the panel
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;
    expect(panel.hidden).toBe(false);

    bus.emit('state:annotations-visibility-changed', { visible: false });

    expect(unplacedButton.hidden).toBe(true);
    expect(panel.hidden).toBe(true);
    toolbar.el.remove();
  });

  it('rule 4: re-showing annotations restores the unplaced tray if unplaced annotations still exist', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });
    bus.emit('state:annotations-visibility-changed', { visible: false });
    const unplacedButton = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    expect(unplacedButton.hidden).toBe(true);

    bus.emit('state:annotations-visibility-changed', { visible: true });

    expect(unplacedButton.hidden).toBe(false);
  });

  it('rule 5: the count badge is unaffected by annotations-visibility changes', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    bus.emit('state:annotations-changed', { added: [{ id: 'a' } as never], updated: [], removed: [] });
    const countEl = toolbar.el.querySelector('.wd-toolbar__count') as HTMLElement;
    expect(countEl.textContent).toBe('1');

    bus.emit('state:annotations-visibility-changed', { visible: false });

    expect(countEl.textContent).toBe('1');
  });

  it('dispose() unsubscribes — a later state:annotations-visibility-changed no longer updates the button', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true });
    const button = toolbar.el.querySelector('.wd-toolbar__annotations') as HTMLButtonElement;

    toolbar.dispose();
    bus.emit('state:annotations-visibility-changed', { visible: false });

    expect(button.textContent).toBe('Hide annotations'); // never updated post-dispose
  });
});
