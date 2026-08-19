import { describe, it, expect, vi, afterEach } from 'vitest';
import { init, destroy } from '../index';
import type { AnnotationAPI, UpdateAnnotationInput } from '../api/AnnotationAPI';
import type { Annotation, AnnotationStatus } from './types';
import type { AnchorDescriptor } from '../anchor/types';
import type { WebdotsConfig } from './config';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'srv_1',
    pageUrl: location.href.split('?')[0]!.split('#')[0]!,
    selector: 'body',
    x: 10,
    y: 20,
    anchor: null, // keeps PinManager's positioning a no-op — irrelevant to click-dispatch tests
    title: 'Broken layout',
    description: 'Overlaps the footer',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA Tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** All 6 AnnotationAPI methods as vi.fn()s so each test can assert calls/configure behavior. */
function makeStubApi(initialList: Annotation[] = []) {
  return {
    list: vi.fn(async (): Promise<Annotation[]> => initialList),
    get: vi.fn(async (): Promise<Annotation> => {
      throw new Error('not used in these tests');
    }),
    create: vi.fn(async (): Promise<Annotation> => {
      throw new Error('not used in these tests');
    }),
    update: vi.fn(async (id: string, patch: UpdateAnnotationInput): Promise<Annotation> => ({
      ...makeAnnotation({ id }),
      ...patch,
    })),
    changeStatus: vi.fn(async (id: string, status: AnnotationStatus): Promise<Annotation> => ({
      ...makeAnnotation({ id }),
      status,
      resolvedAt: status === 'RESOLVED' ? '2026-01-02T00:00:00.000Z' : null,
    })),
    remove: vi.fn(async (): Promise<void> => {}),
  } satisfies AnnotationAPI;
}

async function flush(): Promise<void> {
  // Two macrotask turns is enough to drain the autoLoad chain
  // (api.list() -> store.replaceAll()), which is fire-and-forget from the
  // constructor's point of view.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getRoot(): ShadowRoot {
  const host = document.querySelector('[data-webdots-root]') as HTMLElement;
  return host.shadowRoot!;
}

async function mount(api: ReturnType<typeof makeStubApi>, overrides: Partial<WebdotsConfig> = {}) {
  const handle = init({
    apiUrl: 'https://api.example.com/api/v1',
    user: { name: 'QA Tester' },
    api,
    ...overrides,
  });
  await flush();
  return { handle, root: getRoot() };
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 50, clientY: 60 }));
}

function clickPin(root: ShadowRoot, id: string): void {
  const pin = root.querySelector(`[data-webdots-pin-id="${id}"]`);
  if (!pin) throw new Error(`pin ${id} not found`);
  click(pin);
}

describe('Widget pin interactions (M4)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('clicking a pin opens a card showing that annotation', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');

    expect(root.querySelector('.wd-card__title')?.textContent).toBe('Broken layout');
  });

  it('clicking a pin while in annotate mode opens the card and does NOT start a new annotation', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { handle, root } = await mount(api);

    handle.setMode('annotate');
    clickPin(root, 'srv_1');

    expect(root.querySelector('.wd-card__title')).not.toBeNull();
    // The create-composer form must never have opened.
    expect(root.querySelector('.wd-form')).toBeNull();
    expect(handle.getMode()).not.toBe('composing');
  });

  it('Escape closes the open card', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');
    expect(root.querySelector('.wd-card__title')).not.toBeNull();

    const popover = root.querySelector('.wd-popover--card')!;
    popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(root.querySelector('.wd-card__title')).toBeNull();
  });

  it('the close (×) button closes the open card', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');
    click(root.querySelector('[data-wd-action="close"]')!);

    expect(root.querySelector('.wd-card__title')).toBeNull();
  });

  it('editing and submitting calls api.update() with ONLY the changed fields', async () => {
    const api = makeStubApi([makeAnnotation({ title: 'Original', description: 'Original desc', priority: 'MEDIUM' })]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');
    click(root.querySelector('[data-wd-action="edit"]')!);

    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'Edited title';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await flush();

    expect(api.update).toHaveBeenCalledTimes(1);
    const [id, patch] = api.update.mock.calls[0]!;
    expect(id).toBe('srv_1');
    // Only `title` changed — description and priority must be absent, not
    // just unchanged-but-present.
    expect(patch).toEqual({ title: 'Edited title' });
  });

  it('an optimistic update rolls back to the EXACT previous annotation on API failure', async () => {
    const original = makeAnnotation({ title: 'Original', description: 'Original desc', priority: 'MEDIUM' });
    const api = makeStubApi([original]);
    api.update.mockRejectedValueOnce(new Error('server exploded'));
    const onError = vi.fn();
    const { handle, root } = await mount(api, { onError });

    clickPin(root, 'srv_1');
    click(root.querySelector('[data-wd-action="edit"]')!);
    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'Doomed edit';
    (root.querySelector('.wd-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    // Optimistic value is visible immediately.
    expect(handle.getAnnotations().find((a) => a.id === 'srv_1')?.title).toBe('Doomed edit');

    await flush();

    // Rolled back to the exact original object's values, not just "some" revert.
    expect(handle.getAnnotations().find((a) => a.id === 'srv_1')).toEqual(original);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('resolving removes the annotation from the visible set when showResolved is false (default)', async () => {
    const api = makeStubApi([makeAnnotation({ status: 'OPEN' })]);
    const { handle, root } = await mount(api);

    clickPin(root, 'srv_1');
    click(root.querySelector('[data-wd-action="resolve"]')!);
    await flush();

    expect(handle.getAnnotations()).toHaveLength(0);
    expect(api.changeStatus).toHaveBeenCalledWith('srv_1', 'RESOLVED', expect.anything());
  });

  it('resolving KEEPS the annotation in the visible set when showResolved is true', async () => {
    const api = makeStubApi([makeAnnotation({ status: 'OPEN' })]);
    const { handle, root } = await mount(api, { showResolved: true });

    clickPin(root, 'srv_1');
    click(root.querySelector('[data-wd-action="resolve"]')!);
    await flush();

    const annotations = handle.getAnnotations();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.status).toBe('RESOLVED');
  });

  it('the card closes cleanly when its annotation disappears from the store (resolve + showResolved: false)', async () => {
    const api = makeStubApi([makeAnnotation({ status: 'OPEN' })]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');
    expect(root.querySelector('.wd-card__title')).not.toBeNull();

    click(root.querySelector('[data-wd-action="resolve"]')!);
    // Removal from the Store is synchronous (optimistic) — the card should
    // vanish immediately, before the network round-trip even resolves.
    expect(root.querySelector('.wd-card__title')).toBeNull();

    await flush();
  });

  it('delete requires two clicks in the card before api.remove() is called; the first click alone must not delete', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { handle, root } = await mount(api);

    clickPin(root, 'srv_1');
    const deleteButton = root.querySelector('[data-wd-action="delete"]') as HTMLButtonElement;

    click(deleteButton);
    expect(api.remove).not.toHaveBeenCalled();
    expect(handle.getAnnotations()).toHaveLength(1); // still present after just one click

    click(deleteButton);
    expect(handle.getAnnotations()).toHaveLength(0); // optimistic removal after the confirming click

    await flush();
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledWith('srv_1', expect.anything());
  });

  it('a failed delete restores the annotation and reports onError', async () => {
    const original = makeAnnotation();
    const api = makeStubApi([original]);
    api.remove.mockRejectedValueOnce(new Error('network down'));
    const onError = vi.fn();
    const { handle, root } = await mount(api, { onError });

    clickPin(root, 'srv_1');
    const deleteButton = root.querySelector('[data-wd-action="delete"]') as HTMLButtonElement;
    click(deleteButton);
    click(deleteButton);

    expect(handle.getAnnotations()).toHaveLength(0);
    await flush();

    expect(handle.getAnnotations()).toEqual([original]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('Widget M5 robustness', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('onError fires when the initial autoLoad list() fails', async () => {
    const api = makeStubApi();
    api.list.mockRejectedValueOnce(new Error('network down'));
    const onError = vi.fn();

    await mount(api, { onError });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('onError fires when create() fails, and the optimistic pin is rolled back', async () => {
    const api = makeStubApi([]);
    api.create.mockRejectedValueOnce(new Error('create failed'));
    const onError = vi.fn();
    const { handle } = await mount(api, { onError });

    handle.setMode('annotate');
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));

    const root = getRoot();
    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle.getAnnotations()).toHaveLength(0); // optimistic pin rolled back
    target.remove();
  });

  it('a failed operation surfaces a Toast in the shadow root, not just onError', async () => {
    const api = makeStubApi([makeAnnotation()]);
    api.remove.mockRejectedValueOnce(new Error('network down'));
    const { root } = await mount(api);

    clickPin(root, 'srv_1');
    const deleteButton = root.querySelector('[data-wd-action="delete"]') as HTMLButtonElement;
    click(deleteButton);
    click(deleteButton);
    await flush();

    expect(root.querySelector('.wd-toast__message')).not.toBeNull();
  });

  it('a pin resolved at orphaned confidence shows the "position may have shifted" style notice when its card is opened', async () => {
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="missing"]',
      path: '[data-testid="missing"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };
    const api = makeStubApi([makeAnnotation({ anchor, x: 0, y: 0 })]);
    const { root } = await mount(api);

    const pin = root.querySelector('[data-webdots-pin-id="srv_1"]') as HTMLElement;
    expect(pin.classList.contains('wd-pin--degraded')).toBe(true);
    expect(pin.classList.contains('wd-pin--hidden')).toBe(false);

    clickPin(root, 'srv_1');

    const notice = root.querySelector('.wd-card__notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('approximate last-known location');
  });

  it('a lost-confidence annotation is not rendered as a pin and appears in the Toolbar\'s "N unplaced" tray instead', async () => {
    const anchor: AnchorDescriptor = {
      v: 1,
      strategy: 'testid',
      selector: '[data-testid="missing"]',
      path: '[data-testid="missing"]',
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 1024,
      tag: 'BUTTON',
    };
    const api = makeStubApi([
      makeAnnotation({ id: 'lost1', anchor, x: 0, y: 100_000, title: 'Far below', authorName: 'QA X' }),
    ]);
    const { root } = await mount(api);

    const pin = root.querySelector('[data-webdots-pin-id="lost1"]') as HTMLElement;
    expect(pin.classList.contains('wd-pin--hidden')).toBe(true);

    const unplacedButton = root.querySelector('.wd-toolbar__unplaced') as HTMLButtonElement;
    expect(unplacedButton.hidden).toBe(false);
    expect(unplacedButton.textContent).toBe('1 unplaced');
  });
});

describe('Widget focus restoration (M6)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /**
   * WAI-ARIA: closing a dialog returns focus to the element that invoked it.
   * Without this, Escape drops a keyboard user onto <body>, losing their place
   * in the host page entirely.
   */
  it('returns focus to the pin when the card is closed', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    const pin = root.querySelector('[data-webdots-pin-id="srv_1"]') as HTMLElement;
    pin.focus();
    clickPin(root, 'srv_1');
    expect(root.activeElement).toBe(root.querySelector('[data-wd-action="close"]'));

    click(root.querySelector('[data-wd-action="close"]')!);
    await flush();

    expect(root.querySelector('.wd-popover--card')).toBeNull();
    expect(root.activeElement).toBe(pin);
  });

  it('falls back to the toolbar when the invoking pin no longer exists', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    (root.querySelector('[data-webdots-pin-id="srv_1"]') as HTMLElement).focus();
    clickPin(root, 'srv_1');

    // Two-step delete: arm, then confirm.
    click(root.querySelector('[data-wd-action="delete"]')!);
    click(root.querySelector('[data-wd-action="delete"]')!);
    await flush();

    expect(root.querySelector('[data-webdots-pin-id="srv_1"]')).toBeNull();
    // Focus must land somewhere inside the widget, never collapse to <body>.
    expect(root.activeElement).not.toBeNull();
    expect(root.querySelector('.wd-toolbar')!.contains(root.activeElement)).toBe(true);
  });
});

describe('Widget popover accessibility wiring (M6)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('the create-composer popover is labeled "New annotation" and focus lands in the title field', async () => {
    const api = makeStubApi([]);
    const { handle, root } = await mount(api);

    const target = document.createElement('button');
    document.body.appendChild(target);

    // Enter annotate mode, then click a real page element to open the composer.
    handle.setMode('annotate');
    click(target);

    const popover = root.querySelector('.wd-popover--form') as HTMLElement;
    expect(popover.getAttribute('aria-label')).toBe('New annotation');
    // Focus inside a shadow root surfaces as `shadowRoot.activeElement`, not
    // `document.activeElement` (which instead reports the shadow HOST) —
    // see MDN's ShadowRoot.activeElement / the "retargeting" spec behavior.
    expect(root.activeElement).toBe(root.querySelector('[aria-label="Annotation title"]'));
  });

  it('the detail-card popover is aria-labelledby the card title, and focus lands on the close button', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');

    const popover = root.querySelector('.wd-popover--card') as HTMLElement;
    const title = root.querySelector('.wd-card__title') as HTMLElement;
    expect(popover.getAttribute('aria-labelledby')).toBe(title.id);
    expect(root.activeElement).toBe(root.querySelector('[data-wd-action="close"]'));
  });

  it('the edit-form popover (opened from a card) is labeled "Edit annotation"', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const { root } = await mount(api);

    clickPin(root, 'srv_1');
    click(root.querySelector('[data-wd-action="edit"]')!);

    const popover = root.querySelector('.wd-popover--form') as HTMLElement;
    expect(popover.getAttribute('aria-label')).toBe('Edit annotation');
  });
});
