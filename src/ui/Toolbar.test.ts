import { describe, it, expect, afterEach, vi } from 'vitest';
import { Toolbar } from './Toolbar';
import { EventBus } from '../core/EventBus';
import type { ToolbarPosition } from '../core/types';

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function escape(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/**
 * jsdom lays nothing out — `getBoundingClientRect()` is all zeros — so
 * placement tests substitute a deterministic rect for the toolbar.
 */
function stubRect(el: HTMLElement, x: number, y: number, w = 320, h = 40): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON: () => ({}),
  } as DOMRect);
}

/**
 * Pointer events dispatched as MouseEvents: listeners key off the event
 * TYPE, not its interface, so a `MouseEvent('pointerdown')` exercises the
 * exact handler a real pointer would (and jsdom needs no PointerEvent
 * support to do it).
 */
function pointerDown(el: Element, x: number, y: number): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
}

function pointerMove(x: number, y: number): void {
  document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}

function pointerUp(x: number, y: number): void {
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
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

// Issue #21: the toolbar's position — corners as modifier classes, dragged
// points as inline left/top, drag/keyboard moves as intents Widget persists
// and echoes back as state.
describe('Toolbar position (issue #21)', () => {
  const active: Toolbar[] = [];

  afterEach(() => {
    // observeLayout registers window listeners per toolbar — dispose them
    // so a resize dispatched by one test can't leak into another.
    for (const toolbar of active.splice(0)) toolbar.dispose();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function makeToolbar(initialPosition?: ToolbarPosition) {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle', initialSignedIn: true, initialPosition });
    active.push(toolbar);
    return { bus, toolbar };
  }

  it('the grip is the first child, focusable, and never a .wd-toolbar__button (the mode toggle must stay the first button match)', () => {
    const { bus, toolbar } = makeToolbar();
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    expect(grip).not.toBeNull();
    expect(grip.getAttribute('tabindex')).toBe('0');
    expect(grip.getAttribute('aria-label')).toBe('Move toolbar');
    expect(grip.classList.contains('wd-toolbar__button')).toBe(false);
    // The mode toggle is still the first .wd-toolbar__button in document
    // order — proven by what clicking it does, not by its (state-dependent)
    // label.
    const handler = vi.fn();
    bus.on('intent:toggle-mode', handler);
    click(toolbar.el.querySelector('.wd-toolbar__button') as HTMLElement);
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it('defaults to the bottom-right corner class, with no inline position', () => {
    const { toolbar } = makeToolbar();

    expect(toolbar.el.classList.contains('wd-toolbar--bottom-right')).toBe(true);
    expect(toolbar.el.style.left).toBe('');
    expect(toolbar.el.style.top).toBe('');
  });

  it('an initial corner applies its modifier class and no inline position', () => {
    const { toolbar } = makeToolbar('top-left');

    expect(toolbar.el.classList.contains('wd-toolbar--top-left')).toBe(true);
    expect(toolbar.el.classList.contains('wd-toolbar--bottom-right')).toBe(false);
    expect(toolbar.el.style.left).toBe('');
  });

  it('an initial point renders inline left/top with right/bottom reset to auto, and no corner class', () => {
    const { toolbar } = makeToolbar({ x: 40, y: 90 });
    stubRect(toolbar.el, 40, 90);

    expect(toolbar.el.style.left).toBe('40px');
    expect(toolbar.el.style.top).toBe('90px');
    expect(toolbar.el.style.right).toBe('auto');
    expect(toolbar.el.style.bottom).toBe('auto');
    expect(toolbar.el.className).not.toMatch(/wd-toolbar--(top|bottom)-(left|right)/);
  });

  it('state:toolbar-position-changed with a corner clears a dragged inline position and re-classes', () => {
    const { bus, toolbar } = makeToolbar({ x: 40, y: 90 });
    stubRect(toolbar.el, 40, 90);

    bus.emit('state:toolbar-position-changed', { position: 'top-right' });

    expect(toolbar.el.style.left).toBe('');
    expect(toolbar.el.style.top).toBe('');
    expect(toolbar.el.classList.contains('wd-toolbar--top-right')).toBe(true);
  });

  it('state:toolbar-position-changed with a point clamps it fully on-screen before rendering', () => {
    const { bus, toolbar } = makeToolbar();
    stubRect(toolbar.el, 688, 712); // jsdom viewport is 1024x768; 320x40 toolbar

    bus.emit('state:toolbar-position-changed', { position: { x: 5000, y: -50 } });

    expect(toolbar.el.style.left).toBe('696px'); // 1024 - 320 - 8
    expect(toolbar.el.style.top).toBe('8px');
  });

  it('a full drag: pointerdown on the grip, travel, pointerup — emits one intent with the clamped end point', () => {
    const { bus, toolbar } = makeToolbar(); // bottom-right corner
    stubRect(toolbar.el, 688, 712);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    pointerDown(grip, 700, 720);
    pointerMove(300, 200); // dx=-400, dy=-520 -> (288, 192), in range
    pointerUp(300, 200);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ x: 288, y: 192 });
    expect(toolbar.el.style.left).toBe('288px');
    expect(toolbar.el.style.top).toBe('192px');
  });

  it('a drag that runs off-screen clamps the emitted point to the viewport bounds', () => {
    const { bus, toolbar } = makeToolbar();
    stubRect(toolbar.el, 688, 712);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    pointerDown(grip, 700, 720);
    pointerMove(-3000, -3000);
    pointerUp(-3000, -3000);

    expect(handler).toHaveBeenCalledWith({ x: 8, y: 8 });
  });

  it('a press-and-wiggle under the 4px threshold is a tap, not a drag — no intent, no move', () => {
    const { bus, toolbar } = makeToolbar();
    stubRect(toolbar.el, 688, 712);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    pointerDown(grip, 700, 720);
    pointerMove(701, 721); // 1.4px of travel
    pointerUp(701, 721);

    expect(handler).not.toHaveBeenCalled();
    expect(toolbar.el.style.left).toBe(''); // corner rendering untouched
  });

  it('pointercancel mid-drag restores the pre-drag rendering and emits nothing', () => {
    const { bus, toolbar } = makeToolbar(); // bottom-right corner
    stubRect(toolbar.el, 688, 712);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    pointerDown(grip, 700, 720);
    pointerMove(300, 200);
    expect(toolbar.el.style.left).toBe('288px'); // dragged mid-flight
    document.dispatchEvent(new MouseEvent('pointercancel'));

    expect(handler).not.toHaveBeenCalled();
    expect(toolbar.el.style.left).toBe('');
    expect(toolbar.el.classList.contains('wd-toolbar--bottom-right')).toBe(true);
  });

  it('Escape mid-drag cancels it (the grip keeps focus through the drag, so it sees the key)', () => {
    const { bus, toolbar } = makeToolbar({ x: 500, y: 400 });
    stubRect(toolbar.el, 500, 400);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    pointerDown(grip, 510, 410);
    pointerMove(200, 150);
    escape(grip);

    expect(handler).not.toHaveBeenCalled();
    expect(toolbar.el.style.left).toBe('500px'); // back to the pre-drag point
    expect(toolbar.el.style.top).toBe('400px');
  });

  it('arrow keys nudge 16px and emit the clamped result; the event is consumed (no page scroll)', () => {
    const { bus, toolbar } = makeToolbar({ x: 500, y: 400 });
    stubRect(toolbar.el, 500, 400);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    grip.dispatchEvent(event);

    expect(handler).toHaveBeenCalledWith({ x: 484, y: 400 });
    expect(event.defaultPrevented).toBe(true);
  });

  it('arrow keys clamp at the viewport edge instead of walking off-screen', () => {
    const { bus, toolbar } = makeToolbar({ x: 12, y: 400 });
    stubRect(toolbar.el, 12, 400);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

    expect(handler).toHaveBeenCalledWith({ x: 8, y: 400 });
  });

  it('the unplaced panel flips below when the toolbar rests near the top, and back', () => {
    const { bus, toolbar } = makeToolbar('bottom-right');
    expect(toolbar.el.classList.contains('wd-toolbar--panel-below')).toBe(false);

    bus.emit('state:toolbar-position-changed', { position: 'top-left' });
    expect(toolbar.el.classList.contains('wd-toolbar--panel-below')).toBe(true);

    bus.emit('state:toolbar-position-changed', { position: { x: 100, y: 500 } });
    stubRect(toolbar.el, 100, 500);
    expect(toolbar.el.classList.contains('wd-toolbar--panel-below')).toBe(false);

    bus.emit('state:toolbar-position-changed', { position: { x: 100, y: 100 } });
    expect(toolbar.el.classList.contains('wd-toolbar--panel-below')).toBe(true);
  });

  it('a viewport resize re-clamps a dragged point on the next layout tick', async () => {
    const { toolbar } = makeToolbar({ x: 1000, y: 700 });
    stubRect(toolbar.el, 1000, 700);
    // The constructor-time clamp ran against a zero-sized rect (the element
    // isn't in the DOM yet), so it only bounds the POINT — in a real browser
    // the ResizeObserver's initial tick re-clamps against the real size.
    expect(toolbar.el.style.left).toBe('1000px');

    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true }); // 500 - 320 - 8 = 172
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(toolbar.el.style.left).toBe('172px');
    // Restore jsdom's default viewport for the rest of the file.
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });

  it('dispose() mid-drag drops the document-level drag listeners', () => {
    const { bus, toolbar } = makeToolbar();
    stubRect(toolbar.el, 688, 712);
    const handler = vi.fn();
    bus.on('intent:set-toolbar-position', handler);
    const grip = toolbar.el.querySelector('.wd-toolbar__grip') as HTMLElement;

    pointerDown(grip, 700, 720);
    toolbar.dispose();
    active.splice(active.indexOf(toolbar), 1); // already disposed — don't double-dispose

    // Nothing left listening: a stray late move/up pair must not throw and
    // must not resurrect a drag.
    expect(() => {
      pointerMove(300, 200);
      pointerUp(300, 200);
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
