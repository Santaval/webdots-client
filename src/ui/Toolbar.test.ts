import { describe, it, expect, afterEach } from 'vitest';
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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    expect(button.hidden).toBe(true);
  });

  it('state:unplaced-changed with a non-empty list reveals the button with the count', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });

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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });

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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;

    toolbar.dispose();
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    expect(button.hidden).toBe(true); // never updated post-dispose
  });
});

describe('Toolbar "N unplaced" panel keyboard/focus behavior (M6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opening the panel (click) moves focus into it', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
    document.body.appendChild(toolbar.el);
    bus.emit('state:unplaced-changed', { annotations: [{ id: 'a', title: 'X', authorName: 'Y' }] });

    const button = toolbar.el.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    click(button);

    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;
    expect(document.activeElement).toBe(panel);
  });

  it('Escape closes the panel and returns focus to the toggle button', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
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
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
    const panel = toolbar.el.querySelector('.wd-unplaced-panel') as HTMLElement;

    expect(panel.getAttribute('tabindex')).toBe('-1');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Unplaced annotations');
  });

  it('dispose() removes the panel keydown listener', () => {
    const bus = new EventBus();
    const toolbar = new Toolbar({ bus, initialMode: 'idle' });
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
