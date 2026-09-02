import { describe, it, expect, vi, afterEach } from 'vitest';
import { init, destroy, AuthError, type ScreenshotContext } from '../index';
import { ExpiredCodeError } from '../api/errors';
import type { AnnotationAPI, UpdateAnnotationInput } from '../api/AnnotationAPI';
import type { AuthAPI, MagicLinkSession } from '../api/AuthAPI';
import type { Annotation, AnnotationStatus, WidgetMode } from './types';
import type { AnchorDescriptor } from '../anchor/types';
import type { WebdotsConfig } from './config';
import { loadSession, saveSession } from '../utils/sessionStore';

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
    uploadScreenshot: vi.fn(async (id: string, data: string): Promise<Annotation> => ({
      ...makeAnnotation({ id }),
      screenshot: data,
    })),
  } satisfies AnnotationAPI;
}

/** AuthAPI stub. Each method is a vi.fn() so a test can configure resolve/reject per path. */
function makeStubAuthApi(session: MagicLinkSession = { token: 'tok_1', user: { name: 'Ada', email: 'ada@example.com' } }) {
  return {
    requestMagicLink: vi.fn(async (): Promise<void> => {}),
    verifyMagicLink: vi.fn(async (): Promise<MagicLinkSession> => session),
  } satisfies AuthAPI;
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

/**
 * Clicks the toolbar's mode-toggle button — the first `.wd-toolbar__button`
 * in document order (the refresh button shares the class but comes after
 * it). Issue #19: while signed out this is what OPENS the AuthPanel (it no
 * longer mounts at init), so most auth tests now drive this before touching
 * the panel's own form controls.
 */
function toggleAnnotateMode(root: ShadowRoot): void {
  const button = root.querySelector('.wd-toolbar__button');
  if (!button) throw new Error('toolbar toggle button not found');
  click(button);
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

  // Issue #3: once the server enforces API keys, a 401/403 must not fail
  // silently inside the optimistic-update flow — the pin rolls back, onError
  // fires with an AuthError the host app can branch on, and a toast makes
  // the failure visible in the shadow DOM. HttpAnnotationAPI.test.ts owns
  // the 401 -> AuthError mapping; this pins AuthError -> rollback + onError
  // + toast end-to-end through the Widget.
  it('an AuthError from create() rolls back the optimistic pin, fires onError with the AuthError, and shows a toast', async () => {
    const api = makeStubApi([]);
    api.create.mockRejectedValueOnce(new AuthError(401, 'https://api.example.com/api/v1/annotations'));
    const onError = vi.fn();
    const { handle, root } = await mount(api, { onError });

    handle.setMode('annotate');
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));

    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await flush();

    // Acceptance criterion: no orphaned optimistic pins.
    expect(handle.getAnnotations()).toHaveLength(0);
    // onError fired exactly once, with the AuthError instance — so the host
    // app can `instanceof AuthError` to prompt for a fresh key.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(AuthError);
    // Visible error in the shadow DOM, with the fixed auth copy.
    const toastMessage = root.querySelector('.wd-toast__message');
    expect(toastMessage).not.toBeNull();
    expect(toastMessage?.textContent).toBe('Authentication failed — your API key is missing or invalid.');
    target.remove();
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

describe('Widget reviewer auth — magic link (M3, issue #4)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    localStorage.clear(); // #5: finishAuth now persists the session; keep tests isolated
    vi.restoreAllMocks();
  });

  function visibleAuthTitle(root: ShadowRoot): string | null {
    const title = Array.from(root.querySelectorAll('.wd-auth__title')).find((t) => !(t as HTMLElement).hidden);
    return title?.textContent ?? null;
  }

  function fillAuthEmail(root: ShadowRoot, email: string): void {
    (root.querySelector('[aria-label="Email address"]') as HTMLInputElement).value = email;
  }

  function submitAuthEmail(root: ShadowRoot): void {
    (root.querySelector('.wd-auth__form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  function fillAuthCode(root: ShadowRoot, code: string): void {
    (root.querySelector('[aria-label="Sign-in code"]') as HTMLInputElement).value = code;
  }

  function submitAuthCode(root: ShadowRoot): void {
    // The code form is the second .wd-auth__form in the panel.
    const forms = root.querySelectorAll('.wd-auth__form');
    (forms[forms.length - 1] as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  // Issue #19: the widget no longer enforces login by mounting the panel at
  // init — it mounts only once the reviewer asks to annotate.
  it('mounts no AuthPanel at init with no user supplied; toggling annotate mode opens it', async () => {
    const api = makeStubApi();
    const authApi = makeStubAuthApi();
    const { handle, root } = await mount(api, { user: undefined, authApi });

    expect(root.querySelector('.wd-auth')).toBeNull();
    expect(handle.getMode()).toBe('idle');

    // The toolbar's "Sign in to annotate" toggle is what opens the panel.
    toggleAnnotateMode(root);
    expect(root.querySelector('.wd-auth')).not.toBeNull();

    // Mode itself stays idle — a reviewer must still complete sign-in
    // before annotate mode is actually entered.
    expect(handle.getMode()).toBe('idle');
  });

  it('an embedder who supplies user skips the AuthPanel entirely', async () => {
    const api = makeStubApi();
    const { root } = await mount(api); // default mount passes user: { name: 'QA Tester' }

    expect(root.querySelector('.wd-auth')).toBeNull();
  });

  // Issue #4 acceptance: the happy path.
  it('happy path: email -> code -> verified unmounts the panel, resumes annotate mode, and runs the deferred autoLoad', async () => {
    const api = makeStubApi([makeAnnotation()]);
    const authApi = makeStubAuthApi();
    const { handle, root } = await mount(api, { user: undefined, authApi });

    // autoLoad was deferred (no user at init), so list() has NOT been called yet.
    expect(api.list).not.toHaveBeenCalled();
    expect(root.querySelector('.wd-auth')).toBeNull(); // #19: no panel at init

    // The reviewer asks to annotate — this is what opens the panel now.
    toggleAnnotateMode(root);
    expect(root.querySelector('.wd-auth')).not.toBeNull();

    // Email entry.
    fillAuthEmail(root, 'ada@example.com');
    submitAuthEmail(root);
    await flush();
    expect(authApi.requestMagicLink).toHaveBeenCalledWith('ada@example.com', expect.anything());
    expect(visibleAuthTitle(root)).toBe('Enter your code');

    // Code entry.
    fillAuthCode(root, 'ABC123');
    submitAuthCode(root);
    await flush();
    expect(authApi.verifyMagicLink).toHaveBeenCalledWith('ABC123', expect.anything());

    // The panel unmounts on success.
    expect(root.querySelector('.wd-auth')).toBeNull();

    // #19: the toggle click that opened the panel is resumed automatically
    // once sign-in completes — annotate mode is entered without a second
    // setMode('annotate') call, so the original click isn't lost.
    expect(handle.getMode()).toBe('annotate');

    // The deferred autoLoad now runs (attribution identity is established).
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  // Issue #4 acceptance: the expired-code path.
  it('expired path: a 410 leaves the panel open on the expired-code surface and keeps annotate gated', async () => {
    const api = makeStubApi();
    const authApi = makeStubAuthApi();
    authApi.verifyMagicLink.mockRejectedValueOnce(new ExpiredCodeError(410, 'https://api.example.com/api/v1/auth/magic-link/verify'));

    const { handle, root } = await mount(api, { user: undefined, authApi });
    toggleAnnotateMode(root); // #19: open the panel — it's no longer mounted at init

    fillAuthEmail(root, 'ada@example.com');
    submitAuthEmail(root);
    await flush();

    fillAuthCode(root, 'STALE');
    submitAuthCode(root);
    await flush();

    // The panel stays open on the code surface, showing the expired surface.
    expect(root.querySelector('.wd-auth')).not.toBeNull();
    expect((root.querySelector('.wd-auth__expired') as HTMLElement).hidden).toBe(false);

    // Annotate remains gated (no user was established).
    handle.setMode('annotate');
    expect(handle.getMode()).toBe('idle');
  });
});

// Issue #19: "Only show login modal when user ask for add annotation, not
// show it blocking the page by default." Covers the behavior change itself
// (nothing above already nails down): mount-on-demand, the resumed
// annotate intent, dismissal, and the disposables-growth fix that
// mount-on-demand made possible to hit (mounting repeatedly, where M3-era
// code only ever mounted once per page).
describe('Widget reviewer auth — issue #19 (prompt only on demand)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function fillAuthEmail(root: ShadowRoot, email: string): void {
    (root.querySelector('[aria-label="Email address"]') as HTMLInputElement).value = email;
  }
  function submitAuthEmail(root: ShadowRoot): void {
    (root.querySelector('.wd-auth__form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }
  function fillAuthCode(root: ShadowRoot, code: string): void {
    (root.querySelector('[aria-label="Sign-in code"]') as HTMLInputElement).value = code;
  }
  function submitAuthCode(root: ShadowRoot): void {
    const forms = root.querySelectorAll('.wd-auth__form');
    (forms[forms.length - 1] as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  it('init() with no user and no session mounts no panel and leaves the page unblocked', async () => {
    const api = makeStubApi();
    const { handle, root } = await mount(api, { user: undefined });

    expect(root.querySelector('.wd-auth')).toBeNull();
    expect(handle.getMode()).toBe('idle');

    // Nothing in the shadow root claims the viewport the way the old
    // always-mounted backdrop did — a click on the host page reaches the
    // host page's own listener rather than being swallowed.
    const hostButton = document.createElement('button');
    document.body.appendChild(hostButton);
    const hostClick = vi.fn();
    hostButton.addEventListener('click', hostClick);
    hostButton.click();
    expect(hostClick).toHaveBeenCalledTimes(1);
    hostButton.remove();
  });

  it('emitting intent:toggle-mode while signed out mounts the panel; mode stays idle', async () => {
    const api = makeStubApi();
    const { handle, root } = await mount(api, { user: undefined });

    toggleAnnotateMode(root);

    expect(root.querySelector('.wd-auth')).not.toBeNull();
    expect(handle.getMode()).toBe('idle'); // signing in is still required to actually enter annotate
  });

  it('signing in after a toggle-triggered prompt lands in annotate mode (the resumed intent)', async () => {
    const api = makeStubApi();
    const authApi = makeStubAuthApi();
    const { handle, root } = await mount(api, { user: undefined, authApi });

    toggleAnnotateMode(root);
    fillAuthEmail(root, 'ada@example.com');
    submitAuthEmail(root);
    await flush();
    fillAuthCode(root, 'ABC123');
    submitAuthCode(root);
    await flush();

    // The click that opened the panel wasn't lost — it resumes into
    // annotate mode automatically, with no further setMode call.
    expect(handle.getMode()).toBe('annotate');
  });

  it('intent:close-auth dismisses the panel, mode stays idle, and a later toggle re-opens it', async () => {
    const api = makeStubApi();
    const { handle, root } = await mount(api, { user: undefined });

    toggleAnnotateMode(root);
    expect(root.querySelector('.wd-auth')).not.toBeNull();

    click(root.querySelector('.wd-auth__close')!);

    expect(root.querySelector('.wd-auth')).toBeNull();
    expect(handle.getMode()).toBe('idle');

    // A reviewer who backed out and changes their mind can still get back in.
    toggleAnnotateMode(root);
    expect(root.querySelector('.wd-auth')).not.toBeNull();
  });

  it('repeated open/close does not accumulate .wd-auth nodes (guards the disposables fix)', async () => {
    const api = makeStubApi();
    const { root } = await mount(api, { user: undefined });

    for (let i = 0; i < 5; i++) {
      toggleAnnotateMode(root);
      expect(root.querySelectorAll('.wd-auth')).toHaveLength(1);
      click(root.querySelector('.wd-auth__close')!);
      expect(root.querySelectorAll('.wd-auth')).toHaveLength(0);
    }
  });
});

describe('Widget JWT session (M3, issue #5)', () => {
  const API_URL = 'https://api.example.com/api/v1';

  const storedSession: MagicLinkSession = {
    token: 'tok_live',
    user: { name: 'Ada', email: 'ada@example.com' },
  };

  function fillAuthEmail(root: ShadowRoot, email: string): void {
    (root.querySelector('[aria-label="Email address"]') as HTMLInputElement).value = email;
  }
  function submitAuthEmail(root: ShadowRoot): void {
    (root.querySelector('.wd-auth__form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }
  function fillAuthCode(root: ShadowRoot, code: string): void {
    (root.querySelector('[aria-label="Sign-in code"]') as HTMLInputElement).value = code;
  }
  function submitAuthCode(root: ShadowRoot): void {
    const forms = root.querySelectorAll('.wd-auth__form');
    (forms[forms.length - 1] as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // Acceptance: "Token survives reload."
  it('a stored session restores without re-prompting, enables annotate, and runs autoLoad', async () => {
    saveSession(API_URL, storedSession);
    const api = makeStubApi([makeAnnotation()]);
    const { handle, root } = await mount(api, { user: undefined });

    // No AuthPanel — the restored session re-established the reviewer.
    expect(root.querySelector('.wd-auth')).toBeNull();
    // Annotate is un-gated (attribution identity restored).
    handle.setMode('annotate');
    expect(handle.getMode()).toBe('annotate');
    // The restored session's first request is the deferred autoLoad.
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('finishAuth persists the session to localStorage so it survives a reload', async () => {
    const api = makeStubApi();
    const authApi = makeStubAuthApi(storedSession);
    const { root } = await mount(api, { user: undefined, authApi });
    toggleAnnotateMode(root); // #19: open the panel — it's no longer mounted at init

    expect(loadSession(API_URL)).toBeNull(); // nothing persisted yet

    fillAuthEmail(root, 'ada@example.com');
    submitAuthEmail(root);
    await flush();
    fillAuthCode(root, 'ABC123');
    submitAuthCode(root);
    await flush();

    // The session is now persisted under the apiUrl namespace.
    expect(loadSession(API_URL)).toEqual(storedSession);
  });

  // Acceptance: "expiry re-prompts without a page reload."
  it('a token-present 401 on autoLoad clears the session, re-opens the AuthPanel, and re-gates annotate (no toast)', async () => {
    saveSession(API_URL, storedSession);
    const api = makeStubApi();
    api.list.mockRejectedValue(new AuthError(401, `${API_URL}/annotations`)); // every list 401s
    const onError = vi.fn();
    const { handle, root } = await mount(api, { user: undefined, onError });

    // The panel re-mounted — autoLoad's 401 expired the restored session.
    expect(root.querySelector('.wd-auth')).not.toBeNull();
    // Annotate re-gated (config.user revoked).
    handle.setMode('annotate');
    expect(handle.getMode()).toBe('idle');
    // The persisted session was cleared.
    expect(loadSession(API_URL)).toBeNull();
    // No error toast / onError — the re-opened panel IS the user-facing signal.
    expect(root.querySelector('.wd-toast__message')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('a token-present 401 on a create rolls back the optimistic pin and re-opens the panel (drop + rollback, no toast)', async () => {
    saveSession(API_URL, storedSession);
    const api = makeStubApi([]); // list resolves [] so autoLoad succeeds
    api.create.mockRejectedValueOnce(new AuthError(401, `${API_URL}/annotations`));
    const onError = vi.fn();
    const { handle, root } = await mount(api, { user: undefined, onError });

    // Restored session is live: autoLoad ran and the panel never mounted.
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.wd-auth')).toBeNull();

    handle.setMode('annotate');
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));

    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    // The optimistic pin was dropped (drop + rollback).
    expect(handle.getAnnotations()).toHaveLength(0);
    // The panel re-opened — the session expired.
    expect(root.querySelector('.wd-auth')).not.toBeNull();
    // Annotate re-gated.
    expect(handle.getMode()).toBe('idle');
    // Persisted session cleared.
    expect(loadSession(API_URL)).toBeNull();
    // No toast, no onError — the panel is the signal, not a generic error.
    expect(root.querySelector('.wd-toast__message')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    target.remove();
  });

  it('idempotency: a second 401 after expiry does not re-mount the panel or surface a misleading toast', async () => {
    saveSession(API_URL, storedSession);
    const api = makeStubApi();
    api.list.mockRejectedValue(new AuthError(401, `${API_URL}/annotations`)); // every list 401s
    const onError = vi.fn();
    const { handle, root } = await mount(api, { user: undefined, onError });

    // The first 401 (autoLoad) expired the session and re-mounted the panel.
    expect(root.querySelector('.wd-auth')).not.toBeNull();

    // A later 401 (refresh) lands AFTER expiry — must collapse to a silent no-op.
    await handle.refresh();
    await flush();

    // Still exactly ONE panel — no duplicate re-mount.
    expect(root.querySelectorAll('.wd-auth')).toHaveLength(1);
    // No misleading "API key invalid" toast for the concurrent post-expiry 401.
    expect(root.querySelector('.wd-toast__message')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  /**
   * Guard: the new token-present 401 branch must NOT change the no-token path.
   * An embedder-supplied reviewer (skips the panel, no session) whose apiKey
   * is rejected gets the existing AuthError -> onError + toast behavior, not a
   * phantom re-prompt.
   */
  it('a no-token 401 (x-api-key failure, never authed) still surfaces via onError + toast, not the panel', async () => {
    const api = makeStubApi();
    api.list.mockRejectedValueOnce(new AuthError(401, `${API_URL}/annotations`));
    const onError = vi.fn();
    const { root } = await mount(api, { onError }); // default mount supplies user — skips the panel

    expect(root.querySelector('.wd-auth')).toBeNull(); // never mounted
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(AuthError);
    expect(root.querySelector('.wd-toast__message')).not.toBeNull();
  });

  // ---- #6: derive identity from session; deprecate config.user -----------

  it('with an active session, create() omits authorName/authorEmail so the server derives them from the JWT (#6)', async () => {
    saveSession(API_URL, storedSession);
    const api = makeStubApi([]); // list resolves [] so autoLoad succeeds
    api.create.mockResolvedValueOnce({ ...makeAnnotation({ id: 'srv_new' }), authorName: 'Ada', authorEmail: 'ada@example.com' });
    const { handle, root } = await mount(api, { user: undefined });

    // Restored session is live: autoLoad ran, panel never mounted.
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.wd-auth')).toBeNull();

    handle.setMode('annotate');
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));

    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    // The create input must NOT carry author fields — the server derives
    // authorship from the session token, not the client. (create is called
    // as create(input, signal), so the AbortSignal is matched too — otherwise
    // a single-matcher toHaveBeenCalledWith arity-mismatches and the negation
    // would pass vacuously.)
    expect(api.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ authorName: expect.anything() }),
      expect.anything(),
    );
    expect(api.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ authorEmail: expect.anything() }),
      expect.anything(),
    );
    target.remove();
  });

  it('without a session (embedder-supplied user), create() still sends authorName as the anonymous fallback (#6)', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const { handle, root } = await mount(api); // default mount supplies user — no session, no panel

    expect(root.querySelector('.wd-auth')).toBeNull(); // never authed

    handle.setMode('annotate');
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));

    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ authorName: 'QA Tester' }), expect.anything());
    target.remove();
  });

  it('a supplied config.user alongside a stored session is deprecated: the session identity wins and a warning is logged (#6)', async () => {
    saveSession(API_URL, storedSession);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = makeStubApi([]); // list resolves [] so autoLoad succeeds
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const { handle, root } = await mount(api, { user: { name: 'Embedder' }, debug: true });

    // The verified session beats the unverified client identity: the panel
    // never mounts, annotate is un-gated, and autoLoad ran against the
    // restored session.
    expect(root.querySelector('.wd-auth')).toBeNull();
    handle.setMode('annotate');
    expect(handle.getMode()).toBe('annotate');
    expect(api.list).toHaveBeenCalledTimes(1);

    // A one-time deprecation warning was logged at init.
    const warned = warnSpy.mock.calls.find((c) => /deprecated/.test(String(c[1])));
    expect(warned).toBeTruthy();

    // The session identity (not the supplied 'Embedder') backs the
    // optimistic pin: the stored session's user is 'Ada', so the local
    // row is stamped with that name before the server confirms.
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));
    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    const form = root.querySelector('.wd-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const optimistic = handle.getAnnotations().find((a) => a.id.startsWith('local_'));
    expect(optimistic?.authorName).toBe('Ada'); // session user, not 'Embedder'

    await flush();
    // The session is active, so the create input also omits author fields.
    expect(api.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ authorName: expect.anything() }),
      expect.anything(),
    );
    target.remove();
    warnSpy.mockRestore();
  });

  // Issue #18 regression guard: a session is identity, not per-page state — it
  // must restore on ANY page of the site, not just the one it was saved on.
  // `sessionKey` is namespaced by `apiUrl` alone (localStorage is already
  // origin-scoped, so the host site is implicit); it deliberately does NOT
  // fold in `pageKey` the way annotation grouping does.
  it('restores a session saved on a different page (issue #18)', async () => {
    saveSession(API_URL, storedSession);
    const api = makeStubApi([makeAnnotation()]);
    const { handle, root } = await mount(api, {
      user: undefined,
      pageKey: 'https://host.example/some/other/page',
    });

    // No AuthPanel — the session restores regardless of the current pageKey.
    expect(root.querySelector('.wd-auth')).toBeNull();
    // Annotate is un-gated (attribution identity restored).
    handle.setMode('annotate');
    expect(handle.getMode()).toBe('annotate');
    // The restored session's first request is the deferred autoLoad.
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

describe('Widget anchor self-healing (issue #7)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /**
   * The debounce window (AnchorUpgrader defaults to 1500ms). The self-heal
   * PATCH fires after this elapses; tests await past it before asserting.
   */
  const DEBOUNCE = 1700;

  /** Mirrors `api/dto.ts`'s coords fallback for a legacy row with no anchor column data. */
  function coordsFallback(selector: string): AnchorDescriptor {
    return {
      v: 1,
      strategy: 'coords',
      selector,
      path: selector,
      ratio: { x: 0.5, y: 0.5 },
      viewportW: 0,
      tag: '',
    };
  }

  it('round-trip: a coords-fallback annotation that re-resolves gets PATCHed with an upgraded testid anchor, and the Store adopts it', async () => {
    const cta = document.createElement('button');
    cta.setAttribute('data-testid', 'cta');
    document.body.appendChild(cta);

    const api = makeStubApi([makeAnnotation({ id: 'srv_1', anchor: coordsFallback('[data-testid="cta"]') })]);
    const { handle } = await mount(api);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE));

    // Acceptance: after the debounce, exactly one PATCH carrying the upgraded
    // selector-strategy anchor.
    expect(api.update).toHaveBeenCalledTimes(1);
    const [id, patch] = api.update.mock.calls[0]!;
    expect(id).toBe('srv_1');
    expect(patch.anchor?.strategy).toBe('testid');
    expect(patch.anchor?.selector).toBe('[data-testid="cta"]');

    // The server-confirmed upgraded anchor is now the source of truth in the Store.
    expect(handle.getAnnotations()[0]!.anchor?.strategy).toBe('testid');
  });

  it('no-column fallback: a server that drops the anchor field does not loop — one PATCH, coords preserved', async () => {
    const cta = document.createElement('button');
    cta.setAttribute('data-testid', 'cta');
    document.body.appendChild(cta);

    const coords = coordsFallback('[data-testid="cta"]');
    const api = makeStubApi([makeAnnotation({ id: 'srv_1', anchor: coords })]);
    // Simulate a server WITHOUT the `anchor` column: the PATCH is accepted
    // but the row comes back with no anchor -> dto re-synthesizes `coords`.
    api.update.mockResolvedValue(makeAnnotation({ id: 'srv_1', anchor: coords }));

    await mount(api);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE));

    // Loop prevention: exactly one PATCH, despite the Store still holding a
    // coords anchor that PinManager would otherwise re-detect.
    expect(api.update).toHaveBeenCalledTimes(1);
    // The fallback behavior is preserved: the pin stays on its coords anchor.
    expect(api.update.mock.calls[0]![1].anchor?.strategy).toBe('testid');
  });

  it('a freshly-created annotation (non-coords anchor) does NOT trigger a self-heal PATCH', async () => {
    const api = makeStubApi([]);
    const { handle, root } = await mount(api);

    handle.setMode('annotate');
    const target = document.createElement('button');
    target.setAttribute('data-testid', 'new-btn');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));

    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = 'New issue';
    (root.querySelector('.wd-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // createAnchor produced a testid anchor, so computeAnchorUpgrade bails —
    // no self-heal PATCH, only the create.
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    target.remove();
  });
});

describe('Widget screenshot capture & upload (issue #8)', () => {
  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const pngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0x8AAAAASUVORK5CYII=';

  /** Drives a full click → compose → submit create and returns the click target. */
  async function driveCreate(
    handle: { setMode: (m: WidgetMode) => void },
    root: ShadowRoot,
    title = 'New issue',
  ): Promise<HTMLButtonElement> {
    handle.setMode('annotate');
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 6 }));
    const titleInput = root.querySelector('[aria-label="Annotation title"]') as HTMLInputElement;
    titleInput.value = title;
    (root.querySelector('.wd-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    return target;
  }

  it('invokes captureScreenshot with the clicked target, viewport, and in-flight fields', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const capture = vi.fn<(ctx: ScreenshotContext) => Promise<string>>(async () => pngDataUrl);
    const { handle, root } = await mount(api, { captureScreenshot: capture });

    const target = await driveCreate(handle, root, 'Broken CTA');
    await flush();

    expect(capture).toHaveBeenCalledTimes(1);
    const ctx = capture.mock.calls[0]![0]!;
    expect(ctx.target).toBe(target);
    expect(ctx.title).toBe('Broken CTA');
    expect(ctx.priority).toBe('MEDIUM');
    // jsdom defaults: 1024 x 768 — the point is a real viewport size is passed.
    expect(ctx.viewportW).toBeGreaterThan(0);
    expect(ctx.viewportH).toBeGreaterThan(0);
  });

  it('on a successful capture + upload, updates the annotation screenshot in the store', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const capture = vi.fn(async () => pngDataUrl);
    const { handle, root } = await mount(api, { captureScreenshot: capture });

    await driveCreate(handle, root);
    await flush();

    // The upload is keyed on the server-assigned id (not the local_ temp id).
    await vi.waitFor(() => {
      expect(api.uploadScreenshot).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadScreenshot.mock.calls[0]![0]).toBe('srv_new');
    expect(api.uploadScreenshot.mock.calls[0]![1]).toBe(pngDataUrl);

    await vi.waitFor(() => {
      expect(handle.getAnnotations().find((a) => a.id === 'srv_new')?.screenshot).toBe(pngDataUrl);
    });
  });

  it('a null capture skips the upload entirely (embedder opted out)', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const capture = vi.fn(async () => null);
    const { handle, root } = await mount(api, { captureScreenshot: capture });

    await driveCreate(handle, root);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.uploadScreenshot).not.toHaveBeenCalled();
    // The annotation itself is intact.
    expect(handle.getAnnotations()).toHaveLength(1);
  });

  it('an undefined capture also skips the upload', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const capture = vi.fn(async () => undefined);
    const { handle, root } = await mount(api, { captureScreenshot: capture });

    await driveCreate(handle, root);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.uploadScreenshot).not.toHaveBeenCalled();
    expect(handle.getAnnotations()).toHaveLength(1);
  });

  it('a rejecting capture surfaces via onError + toast but leaves the annotation intact', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const capture = vi.fn(async () => {
      throw new Error('rasterizer failed');
    });
    const onError = vi.fn();
    const { handle, root } = await mount(api, { captureScreenshot: capture, onError });

    await driveCreate(handle, root);
    await flush();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'rasterizer failed' }));
    });
    // Non-fatal acceptance criterion: the annotation survives, no upload attempted.
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
    expect(handle.getAnnotations()).toHaveLength(1);
    // And the failure is visible in the shadow DOM.
    await vi.waitFor(() => {
      expect(root.querySelector('.wd-toast__message')?.textContent).toBe('rasterizer failed');
    });
  });

  it('a synchronous throw from the capture callback is normalized to a rejection and surfaced the same way', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const capture = vi.fn(() => {
      throw new Error('sync boom');
    });
    const onError = vi.fn();
    const { handle, root } = await mount(api, { captureScreenshot: capture, onError });

    await driveCreate(handle, root);
    await flush();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync boom' }));
    });
    expect(handle.getAnnotations()).toHaveLength(1);
  });

  it('a failed upload surfaces via onError + toast but NEVER rolls back the annotation', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    api.uploadScreenshot.mockRejectedValueOnce(new Error('upload 500'));
    const capture = vi.fn(async () => pngDataUrl);
    const onError = vi.fn();
    const { handle, root } = await mount(api, { captureScreenshot: capture, onError });

    await driveCreate(handle, root);
    await flush();

    await vi.waitFor(() => {
      expect(api.uploadScreenshot).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'upload 500' }));
    });
    // Acceptance criterion (#8): upload failure is non-fatal — the annotation
    // is NOT lost or rolled back.
    expect(handle.getAnnotations()).toHaveLength(1);
    expect(handle.getAnnotations()[0]!.id).toBe('srv_new');
    // The toast surfaces the upload error to the reviewer.
    await vi.waitFor(() => {
      expect(root.querySelector('.wd-toast__message')?.textContent).toBe('upload 500');
    });
  });

  it('without captureScreenshot configured, no capture runs and no upload is attempted (bundle-safe default)', async () => {
    const api = makeStubApi([]);
    api.create.mockResolvedValueOnce(makeAnnotation({ id: 'srv_new' }));
    const { handle, root } = await mount(api); // no captureScreenshot

    await driveCreate(handle, root);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.uploadScreenshot).not.toHaveBeenCalled();
    expect(handle.getAnnotations()).toHaveLength(1);
    expect(handle.getAnnotations()[0]!.id).toBe('srv_new');
  });

  it('capture starts in parallel with create — the callback is invoked before create resolves', async () => {
    // Make create resolve slowly; capture should already have been called by
    // the time create settles (the two run concurrently, not serially).
    const api = makeStubApi([]);
    let createResolved = false;
    api.create.mockImplementationOnce(
      () =>
        new Promise<Annotation>((resolve) =>
          setTimeout(() => {
            createResolved = true;
            resolve(makeAnnotation({ id: 'srv_new' }));
          }, 20),
        ),
    );
    const capture = vi.fn(async () => pngDataUrl);
    const { handle, root } = await mount(api, { captureScreenshot: capture });

    await driveCreate(handle, root);
    // Drain the 20ms create timer.
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(createResolved).toBe(true);
    // Capture was invoked while create was still in flight (it was called
    // synchronously at createAnnotation start, before the first await).
    expect(capture).toHaveBeenCalledTimes(1);
  });
});


