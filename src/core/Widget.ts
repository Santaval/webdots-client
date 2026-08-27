import { EventBus } from './EventBus';
import type { PublicEvents } from './events';
import type { ResolvedWebdotsConfig } from './config';
import { Store, type AnnotationDiff } from './Store';
import { PinManager } from './PinManager';
import type { Annotation, AnnotationPriority, AnnotationStatus, WidgetHandle, WidgetMode } from './types';
import type { AnchorDescriptor, ResolveConfidence } from '../anchor/types';
import { createAnchor } from '../anchor/createAnchor';
import type { AnnotationAPI, UpdateAnnotationInput } from '../api/AnnotationAPI';
import type { AuthAPI, MagicLinkSession } from '../api/AuthAPI';
import { HttpAnnotationAPI } from '../api/HttpAnnotationAPI';
import { HttpAuthAPI } from '../api/HttpAuthAPI';
import { AuthError, ExpiredCodeError } from '../api/errors';
import { ShadowHost } from '../ui/ShadowHost';
import { Toolbar } from '../ui/Toolbar';
import { Overlay } from '../ui/Overlay';
import { Highlighter } from '../ui/Highlighter';
import { Popover } from '../ui/Popover';
import { AnnotationForm } from '../ui/AnnotationForm';
import { AnnotationCard } from '../ui/AnnotationCard';
import { Toast } from '../ui/Toast';
import { AuthPanel } from '../ui/AuthPanel';
import { Disposables } from '../utils/Disposables';
import { createLogger } from '../utils/log';
import { createId } from '../utils/id';
import { clearSession, loadSession, saveSession } from '../utils/sessionStore';

interface PendingCreate {
  anchor: AnchorDescriptor;
  pageX: number;
  pageY: number;
}

/** Viewport point a detail popover (card or edit form) is anchored to. */
interface DetailAnchor {
  clientX: number;
  clientY: number;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * The lifecycle orchestrator — the ONLY module that wires other modules
 * together. UI modules talk exclusively through the EventBus; Widget owns
 * that bus, subscribes to intents, and drives the Store AND the API in
 * response.
 *
 * M2 added click-to-annotate: a capture-phase `click` listener on the real
 * `document` is owned here (not by any UI module) because it needs to
 * reach into a non-UI module (`anchor/createAnchor`) AND then instantiate
 * UI (`Popover`/`AnnotationForm`) — exactly the kind of cross-cutting glue
 * the "Widget is the only wiring point" rule exists for.
 *
 * M3 adds persistence: an `AnnotationAPI` (the default `HttpAnnotationAPI`,
 * or `config.api` when supplied) is instantiated here — never anywhere in
 * ui/ — and every UI-triggered write goes optimistic-local-first, then
 * reconciles against (or rolls back from) the server response.
 *
 * M4 adds pin interactions (view/edit/resolve/delete). A SECOND popover
 * slot — `detailPopover`/`detailCard`/`detailForm` — exists alongside the
 * create-flow's `popover`/`form`, and the two are kept mutually exclusive
 * (`openComposer`/`openDetailView` each close the other) so a stray click
 * never stacks two popovers. Update/resolve/delete all follow the same
 * optimistic-then-reconcile shape `createAnnotation()` established: mutate
 * the Store immediately, call the API, and either confirm or roll back to
 * the captured previous value. A single `state:annotations-changed`
 * subscription (`reconcileDetailView`) keeps whichever detail popover is
 * open in sync with the Store — closing it if its annotation disappears
 * (resolved-and-hidden, deleted, or removed from elsewhere), refreshing its
 * content otherwise — rather than each mutation handler managing the
 * popover's lifecycle itself.
 */
export class Widget implements WidgetHandle {
  readonly version: string;

  private bus: EventBus;
  private abortController: AbortController;
  private disposables: Disposables;
  private shadowHost: ShadowHost;
  private toolbar: Toolbar;
  private store: Store;
  private overlay: Overlay;
  private pinManager: PinManager;
  private highlighter: Highlighter;
  private api: AnnotationAPI;
  private authApi: AuthAPI;
  private config: ResolvedWebdotsConfig;
  private visible = true;
  private log: ReturnType<typeof createLogger>;

  private popover: Popover | null = null;
  private form: AnnotationForm | null = null;
  private pendingCreate: PendingCreate | null = null;

  private detailPopover: Popover | null = null;
  private detailCard: AnnotationCard | null = null;
  private detailForm: AnnotationForm | null = null;
  private openAnnotationId: string | null = null;
  /**
   * The element that had focus when the detail surface opened (normally the
   * pin). WAI-ARIA requires focus to return to the invoking element when a
   * dialog closes — without this, Escape drops a keyboard user back onto
   * `<body>`, losing their place in the page entirely.
   */
  private detailReturnFocus: HTMLElement | null = null;
  private detailAnchor: DetailAnchor | null = null;
  /** The confidence the pin was rendering when its detail view was opened — see openDetailView. */
  private openAnnotationConfidence: ResolveConfidence = 'exact';

  private toast: Toast;

  // ---- M3 reviewer auth ------------------------------------------------
  // The magic-link sign-in panel. Mounted only when `config.user` is absent
  // (an embedder who already knows the reviewer passes `user` and skips the
  // panel). Once `verifyMagicLink` succeeds, the session's `user` is written
  // back into `config.user`, the panel unmounts, and annotate mode is
  // un-gated. `lastAuthEmail` backs the "Resend" intent (re-request a link
  // for the email the reviewer already entered) without the panel having to
  // hold that state itself.
  //
  // #5 (JWT session): the live token lives in `sessionToken`, read by the
  // default `HttpAnnotationAPI`'s `getToken` so annotation requests carry
  // `Authorization: Bearer`. On reload a stored session is restored from
  // localStorage (no re-prompt) until the next request 401s, at which point
  // `expireSession()` clears the token + storage, revokes `config.user`, and
  // re-mounts the panel — the "expiry re-prompts without a page reload" path.
  // A token-present 401 is therefore distinct from a no-token 401 (the
  // latter is an x-api-key failure surfaced via the normal error channel).
  private authPanel: AuthPanel | null = null;
  private lastAuthEmail = '';
  private sessionToken: string | undefined;
  /**
   * Latches `true` the moment `expireSession()` runs, so a flurry of CONCURRENT
   * in-flight operations that all 401 (token expired → every pending request
   * gets the same 401) produces a SINGLE re-prompt transition and silent
   * rollbacks for the rest — not N panel re-mounts, and not a misleading
   * "API key invalid" Toast for the requests whose 401 arrived a microtask
   * after the first one already cleared `sessionToken`. Reset to `false` by
   * `finishAuth()` / session-restore when a fresh session is established.
   */
  private sessionExpired = false;

  constructor(config: ResolvedWebdotsConfig, version: string) {
    this.version = version;
    this.config = config;
    this.log = createLogger('Widget', config.debug);
    this.bus = new EventBus(config.debug);
    this.abortController = new AbortController();
    this.disposables = new Disposables();

    this.api =
      config.api ??
      new HttpAnnotationAPI({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        requestTimeoutMs: config.requestTimeoutMs,
        // Live token — read at request time so sign-in completing (or a
        // session restored from localStorage below) is picked up without
        // rebuilding the API. A custom `config.api` override handles its
        // own auth and never receives the token through this path.
        getToken: () => this.sessionToken,
      });

    // Auth API is instantiated unconditionally (it's a plain object — no
    // network until a method is called). When `config.user` is already
    // present the panel never mounts and this instance is simply unused.
    this.authApi =
      config.authApi ??
      new HttpAuthAPI({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        requestTimeoutMs: config.requestTimeoutMs,
      });

    this.shadowHost = new ShadowHost({
      container: config.container,
      zIndex: config.zIndex,
      theme: config.theme,
    });
    this.disposables.add(() => this.shadowHost.remove());

    this.store = new Store(this.bus);

    this.overlay = new Overlay({ bus: this.bus });
    this.shadowHost.shadowRoot.appendChild(this.overlay.el);
    this.disposables.add(() => this.overlay.dispose());

    this.pinManager = new PinManager({ bus: this.bus, store: this.store, overlay: this.overlay });
    this.disposables.add(() => this.pinManager.dispose());

    this.highlighter = new Highlighter({
      bus: this.bus,
      hostElement: this.shadowHost.host,
      ignoreSelector: config.ignoreSelector,
    });
    this.shadowHost.shadowRoot.appendChild(this.highlighter.el);
    this.disposables.add(() => this.highlighter.dispose());

    this.toolbar = new Toolbar({ bus: this.bus, initialMode: this.store.getMode() });
    this.shadowHost.shadowRoot.appendChild(this.toolbar.el);
    this.disposables.add(() => this.toolbar.dispose());

    // M5: transient error surfacing. Toast subscribes to `state:error` on
    // its own (same self-managing pattern as Toolbar's mode/count
    // subscriptions) — Widget only owns its lifecycle, not its rendering.
    this.toast = new Toast({ bus: this.bus });
    this.shadowHost.shadowRoot.appendChild(this.toast.el);
    this.disposables.add(() => this.toast.dispose());

    // M3: reviewer magic-link sign-in. The panel is the runtime path to
    // ESTABLISHING a reviewer identity when neither an embedder-supplied
    // `user` nor a stored session exists at init. An embedder who already
    // knows the reviewer passes `user` and skips the panel entirely.
    // #5: a session persisted from a PRIOR sign-in (namespaced by apiUrl +
    // pageKey) is restored on reload — the token survives and annotate stays
    // un-gated, no re-prompt. The stored token is trusted optimistically; if
    // it has since expired, the first annotation request 401s and
    // `expireSession()` re-opens the panel.
    // #6: a stored session is a VERIFIED identity and beats an unverified
    // client-supplied `config.user` — `config.user` is now an anonymous-mode
    // fallback only. So a stored session is restored EVEN when `config.user`
    // was supplied (the session user overwrites it, the token attaches), and
    // supplying `config.user` alongside an active session is deprecated: a
    // one-time warning fires here. With neither a stored session nor a
    // `user`, the AuthPanel mounts as before.
    const stored = loadSession(config.apiUrl, config.pageKey);
    if (stored) {
      if (config.user) {
        this.log.warn(
          'config.user is deprecated alongside an active session; using the server-derived session identity instead.',
        );
      }
      this.config.user = { name: stored.user.name, email: stored.user.email };
      this.sessionToken = stored.token;
      this.sessionExpired = false; // a live restored session resets the latch
    } else if (!config.user) {
      this.mountAuthPanel();
    }

    this.disposables.add(this.bus.on('intent:toggle-mode', () => this.handleToggleMode()));
    this.disposables.add(this.bus.on('intent:refresh', () => void this.refresh()));
    this.disposables.add(this.bus.on('intent:create-annotation', (payload) => this.handleCreateAnnotation(payload)));
    this.disposables.add(this.bus.on('intent:cancel-annotation', () => this.closeComposer()));

    this.disposables.add(this.bus.on('intent:open-annotation', (payload) => this.handleOpenAnnotation(payload)));
    this.disposables.add(this.bus.on('intent:close-detail', () => this.closeDetailUi({ restoreFocus: true })));
    this.disposables.add(this.bus.on('intent:edit-annotation', () => this.handleEditAnnotation()));
    this.disposables.add(this.bus.on('intent:update-annotation', (payload) => this.handleUpdateAnnotation(payload)));
    this.disposables.add(this.bus.on('intent:change-status', (payload) => this.handleChangeStatus(payload)));
    this.disposables.add(this.bus.on('intent:delete-annotation', () => this.handleDeleteAnnotation()));
    // Single point of truth for keeping an open detail popover in sync with
    // the Store — see the class doc for why this beats each mutation
    // handler managing the popover's lifecycle itself.
    this.disposables.add(this.bus.on('state:annotations-changed', (diff) => this.reconcileDetailView(diff)));

    // M3 reviewer-auth intents. The panel emits; Widget drives the AuthAPI
    // and replies with `state:auth-state-changed`. Auth failures are NOT
    // routed through the global `state:error` channel — the panel surfaces
    // them inline (incl. the dedicated expired-code surface), so a Toast
    // would just double-surface the same message.
    this.disposables.add(this.bus.on('intent:request-magic-link', (payload) => void this.handleRequestMagicLink(payload.email)));
    this.disposables.add(this.bus.on('intent:verify-magic-link', (payload) => void this.handleVerifyMagicLink(payload.code)));
    this.disposables.add(this.bus.on('intent:cancel-auth', () => this.handleCancelAuth()));
    this.disposables.add(this.bus.on('intent:resend-magic-link', () => void this.handleResendMagicLink()));

    // Capture-phase so annotate-mode clicks are intercepted BEFORE the host
    // page's own handlers run (required: clicking to annotate must not
    // trigger the host page's own click handling).
    const onClick = (event: MouseEvent) => this.handleDocumentClick(event);
    document.addEventListener('click', onClick, true);
    this.disposables.add(() => document.removeEventListener('click', onClick, true));

    if (config.onModeChange) {
      const handler = config.onModeChange;
      this.disposables.add(this.bus.on('state:mode-changed', ({ mode }) => handler(mode)));
    }
    if (config.onError) {
      const handler = config.onError;
      this.disposables.add(this.bus.on('state:error', ({ error }) => handler(error)));
    }
    // NOTE: `onAnnotationCreated` is called directly from `createAnnotation()`
    // below, with the server-CONFIRMED annotation only — not wired via the
    // generic `state:annotations-changed` bus event, which would also fire
    // for the transient optimistic `local_...` row and double-invoke it.

    // autoLoad is deferred until AFTER the reviewer signs in when no `user`
    // was supplied at init AND no session was restored from localStorage —
    // there's no attribution identity (and no session) to load against until
    // the magic-link flow completes. A restored session (#5) or an
    // embedder-supplied `user` loads immediately. The restore case trusts the
    // stored token optimistically; if it has expired, this first fetch 401s
    // and `expireSession()` re-opens the panel (no page reload).
    if (config.autoLoad && config.user) {
      void this.loadAnnotations();
    }

    this.log.debug('initialized');
  }

  /** Shared by the initial autoLoad fetch and `refresh()`. Never throws — failures route through onError/logging. */
  private async loadAnnotations(): Promise<void> {
    try {
      const list = await this.api.list(
        {
          pageUrl: this.config.pageKey,
          status: this.config.showResolved ? undefined : 'OPEN',
        },
        this.abortController.signal,
      );
      if (this.abortController.signal.aborted) return;
      this.store.replaceAll(list);
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      if (err instanceof AuthError && (this.sessionToken || this.sessionExpired)) {
        // The autoLoad/refresh fetch was carrying a JWT that the server just
        // rejected — a session expiry, not a config error. Re-prompt rather
        // than Toast (the panel IS the user-facing signal). The Store wasn't
        // mutated yet, so there's nothing to roll back here.
        this.expireSession();
        return;
      }
      this.reportError(toError(err));
    }
  }

  private reportError(error: Error): void {
    this.log.error(error.message, error);
    this.bus.emit('state:error', { error });
  }

  // ---- M3 reviewer auth ------------------------------------------------

  private hasUser(): boolean {
    return this.config.user !== undefined;
  }

  /**
   * Mounts a fresh AuthPanel into the shadow root at the `email` phase. Shared
   * by the constructor (no `user` and no stored session) and by
   * `expireSession()` (a previously-established session just lapsed). The
   * panel's own dispose is registered on `disposables`; re-mounting after
   * expiry is safe because `expireSession()` nulls `authPanel` (and its old
   * disposable has already run) before calling here.
   */
  private mountAuthPanel(): void {
    this.authPanel = new AuthPanel({ bus: this.bus });
    this.shadowHost.shadowRoot.appendChild(this.authPanel.el);
    this.disposables.add(() => this.authPanel?.dispose());
    this.bus.emit('state:auth-state-changed', { phase: 'email' });
    this.authPanel.focus();
  }

  private async handleRequestMagicLink(email: string): Promise<void> {
    this.lastAuthEmail = email;
    this.bus.emit('state:auth-state-changed', { phase: 'requesting' });
    try {
      await this.authApi.requestMagicLink(email, this.abortController.signal);
      if (this.abortController.signal.aborted) return;
      this.bus.emit('state:auth-state-changed', { phase: 'code-sent' });
    } catch (err) {
      if (this.abortController.signal.aborted) return; // destroy() tore down the flow
      this.bus.emit('state:auth-state-changed', { phase: 'email', error: toError(err) });
    }
  }

  private async handleVerifyMagicLink(code: string): Promise<void> {
    this.bus.emit('state:auth-state-changed', { phase: 'verifying' });
    try {
      const session = await this.authApi.verifyMagicLink(code, this.abortController.signal);
      if (this.abortController.signal.aborted) return;
      this.bus.emit('state:auth-state-changed', { phase: 'verified', session });
      this.finishAuth(session);
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      const expired = err instanceof ExpiredCodeError;
      this.bus.emit('state:auth-state-changed', { phase: 'code-sent', error: toError(err), expired });
    }
  }

  private handleCancelAuth(): void {
    // Reset to the email surface. A request in flight is NOT aborted (the
    // session-level controller would cancel everything else too); its late
    // resolution may emit a follow-up state that overrides this reset,
    // which is acceptable for v1.
    this.bus.emit('state:auth-state-changed', { phase: 'email' });
  }

  private async handleResendMagicLink(): Promise<void> {
    if (!this.lastAuthEmail) {
      this.bus.emit('state:auth-state-changed', { phase: 'email' });
      return;
    }
    await this.handleRequestMagicLink(this.lastAuthEmail);
  }

  /**
   * Writes the server-confirmed identity back into `config.user`, unmounts
   * the AuthPanel, un-gates annotate mode, and — when `autoLoad` was on —
   * performs the deferred initial annotation fetch now that attribution is
   * possible. #5 also holds the session token live in `sessionToken` (read
   * by the annotations transport's `getToken`) and persists it to
   * localStorage so the session survives a reload.
   */
  private finishAuth(session: MagicLinkSession): void {
    this.config.user = { name: session.user.name, email: session.user.email };
    this.sessionToken = session.token;
    this.sessionExpired = false; // a fresh session supersedes any prior expiry latch
    saveSession(this.config.apiUrl, this.config.pageKey, session);
    this.authPanel?.dispose();
    this.authPanel = null;
    if (this.config.autoLoad) {
      void this.loadAnnotations();
    }
    this.log.debug('reviewer authenticated');
  }

  /**
   * Tears down an established session after a token-present 401 (the JWT has
   * expired server-side). Clears the live token + the persisted session,
   * revokes `config.user` so annotate mode re-gates, closes any open
   * composer/detail surface, snaps mode back to `idle`, and re-opens the
   * AuthPanel — the "expiry re-prompts without a page reload" path.
   *
   * IDEMPOTENT: the `if (this.sessionExpired) return` guard means N concurrent
   * in-flight operations that all 401 produce a SINGLE transition — the first
   * flips the session off and re-mounts the panel; the rest short-circuit
   * here. Each caller still rolls its own optimistic mutation back BEFORE
   * calling this (see the per-op catch blocks), so pending writes resolve
   * deterministically (drop + rollback, per #5's chosen strategy) rather than
   * half-applying. The latch is reset only when a NEW session is established
   * (`finishAuth()` / reload-restore).
   */
  private expireSession(): void {
    if (this.sessionExpired) return; // concurrent 401s collapse to one transition
    this.sessionExpired = true;
    this.sessionToken = undefined;
    clearSession(this.config.apiUrl, this.config.pageKey);
    this.config.user = undefined;
    // Close any surfaces that presume an authed reviewer, then re-gate mode.
    this.closeComposerUi();
    this.closeDetailUi();
    this.setMode('idle');
    this.mountAuthPanel();
    this.log.info('session expired; re-opening sign-in');
  }

  private handleToggleMode(): void {
    // Gated until a reviewer signs in — the AuthPanel's modal backdrop
    // already blocks toolbar clicks while it's up, but this also covers a
    // programmatic `setMode('annotate')` that bypasses the panel.
    if (!this.hasUser()) {
      this.log.warn('annotate mode is unavailable until the reviewer signs in.');
      return;
    }
    this.setMode(this.getMode() === 'annotate' ? 'idle' : 'annotate');
  }

  private handleDocumentClick(event: MouseEvent): void {
    if (this.getMode() !== 'annotate') return;
    // Defensive: annotate mode is gated on sign-in, so this should never
    // fire without a user — but a programmatic setMode could slip past the
    // gate. Bail rather than create an annotation with no attribution.
    if (!this.hasUser()) return;

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const target = path[0];
    if (!(target instanceof Element)) return;

    // Never treat a click on our own UI (toolbar, popover, pins…) as a
    // click-to-annotate target. `path.includes(...)`, not `.contains()`,
    // because `.contains()` does not pierce the shadow boundary.
    if (path.includes(this.shadowHost.host)) return;
    if (this.config.ignoreSelector && target.closest(this.config.ignoreSelector)) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    const { anchor, pageX, pageY } = createAnchor(target, event, {
      testIdAttributes: this.config.testIdAttributes,
    });

    this.pendingCreate = { anchor, pageX, pageY };
    this.openComposer(event.clientX, event.clientY);
  }

  private openComposer(clientX: number, clientY: number): void {
    this.closeComposerUi();
    this.closeDetailUi(); // never stack a create-composer on top of an open card/edit-form

    this.popover = new Popover({ className: 'wd-popover--form' });
    this.popover.el.setAttribute('aria-label', 'New annotation');
    this.form = new AnnotationForm({ bus: this.bus });
    this.popover.el.appendChild(this.form.el);
    this.popover.setOnEscape(() => this.bus.emit('intent:cancel-annotation', undefined));

    this.shadowHost.shadowRoot.appendChild(this.popover.el);
    this.popover.placeAt(clientX, clientY);
    this.form.focus();

    this.setMode('composing');
  }

  /** Removes the popover/form DOM without touching mode — used both by cancel and before opening a new one. */
  private closeComposerUi(): void {
    this.popover?.dispose();
    this.popover = null;
    this.form = null;
  }

  private closeComposer(): void {
    this.closeComposerUi();
    this.pendingCreate = null;
    if (this.getMode() === 'composing') this.setMode('idle');
  }

  private handleCreateAnnotation(payload: {
    title: string;
    description?: string;
    priority: AnnotationPriority;
  }): void {
    if (!this.pendingCreate) return;
    const { anchor, pageX, pageY } = this.pendingCreate;

    // Fire-and-forget from the bus handler's point of view — createAnnotation()
    // catches everything internally, so this never produces an unhandled
    // rejection. The composer closes immediately; the pin appears
    // immediately too (optimistic), well before the network round-trip.
    void this.createAnnotation(anchor, pageX, pageY, payload);
    this.closeComposer();
  }

  /**
   * Optimistic create: an immediate local pin renders under a `local_...`
   * temp id, then is reconciled to the server-assigned id on success
   * (`Store.replaceId` — atomic, single diff, no renumbering flash), or
   * removed with an `onError` report on failure.
   */
  private async createAnnotation(
    anchor: AnchorDescriptor,
    pageX: number,
    pageY: number,
    payload: { title: string; description?: string; priority: AnnotationPriority },
  ): Promise<void> {
    // Defensive: annotate mode is gated on sign-in, so `config.user` should
    // always be present here. If a race (e.g. sign-in completing mid-click)
    // leaves it absent, bail with an onError rather than throwing on
    // `undefined.name` deep in the optimistic-build below.
    if (!this.config.user) {
      this.reportError(new Error('[webdots] cannot create an annotation before the reviewer signs in.'));
      return;
    }
    // Captured into a local so TS keeps the narrowed (non-undefined) type
    // across the `this.store.upsert(...)` and `this.api.create(...)` calls
    // below — narrowing on `this.config.user` (a property) is invalidated
    // by any method call that TS must assume could reassign it. These still
    // back the OPTIMISTIC row's display attribution regardless of session;
    // the wire decision (send vs. omit) is `hasSession` below.
    const authorName = this.config.user.name;
    const authorEmail = this.config.user.email;
    // #6: with an active JWT the server derives authorship from the session
    // and ignores client-supplied author fields, so they're NOT sent. They
    // remain the anonymous-mode fallback (embedder-supplied `config.user`,
    // no session) — the only path that still populates them on the wire.
    const hasSession = this.sessionToken !== undefined;
    const tempId = createId('local');
    const now = new Date().toISOString();
    const optimistic: Annotation = {
      id: tempId,
      pageUrl: this.config.pageKey,
      selector: anchor.selector,
      x: pageX,
      y: pageY,
      anchor,
      title: payload.title,
      description: payload.description,
      status: 'OPEN',
      priority: payload.priority,
      authorName,
      authorEmail,
      screenshot: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.upsert(optimistic);

    try {
      const created = await this.api.create(
        {
          pageUrl: this.config.pageKey,
          selector: anchor.selector,
          x: pageX,
          y: pageY,
          anchor,
          title: payload.title,
          description: payload.description,
          priority: payload.priority,
          // Author fields are spread in ONLY for the anonymous-mode fallback
          // (no session). When `hasSession`, omit them so the server derives
          // authorship from the JWT — sending them alongside a token is
          // deprecated and ignored by the server anyway.
          ...(hasSession ? {} : { authorName, authorEmail }),
        },
        this.abortController.signal,
      );
      if (this.abortController.signal.aborted) return; // destroyed mid-flight — nothing left to reconcile
      this.store.replaceId(tempId, created);
      this.config.onAnnotationCreated?.(created);
    } catch (err) {
      if (this.abortController.signal.aborted) return; // destroy() already tore everything down
      this.store.remove(tempId);
      if (err instanceof AuthError && (this.sessionToken || this.sessionExpired)) {
        this.expireSession(); // JWT expired — drop the optimistic pin and re-prompt
        return;
      }
      this.reportError(toError(err));
    }
  }

  // ---- pin interactions: view / edit / resolve / delete ----------------

  private handleOpenAnnotation(payload: { id: string; clientX: number; clientY: number; confidence?: ResolveConfidence }): void {
    const annotation = this.store.get(payload.id);
    if (!annotation) return; // stale pin (e.g. a slow double-click after it was already removed)

    this.closeComposerUi(); // never stack a card on top of an open create-composer
    this.pendingCreate = null;
    if (this.getMode() === 'composing') this.setMode('idle');

    this.openDetailView(annotation, { clientX: payload.clientX, clientY: payload.clientY }, payload.confidence);
  }

  /**
   * Renders the read-only card. Shared by the initial pin-open and by
   * returning to view mode after an edit submits. `confidence` defaults to
   * `this.openAnnotationConfidence` (rather than a hardcoded 'exact') so
   * re-entering view mode after an edit doesn't silently drop the
   * "position may have shifted" notice a degraded/orphaned pin was showing.
   */
  private openDetailView(annotation: Annotation, anchor: DetailAnchor, confidence?: ResolveConfidence): void {
    const resolvedConfidence = confidence ?? this.openAnnotationConfidence;
    // Captured BEFORE the teardown below, which clears `detailReturnFocus`.
    // On a fresh open this is the pin; on an edit -> view transition focus is
    // already inside our own surface, so the original pin is carried over.
    const returnTarget = this.captureReturnFocusTarget();
    this.closeDetailUi();
    this.detailReturnFocus = returnTarget;
    this.openAnnotationId = annotation.id;
    this.detailAnchor = anchor;
    this.openAnnotationConfidence = resolvedConfidence;

    this.detailPopover = new Popover({ className: 'wd-popover--card' });
    // References the card's title element by id rather than a static
    // aria-label so the dialog's accessible name always matches whichever
    // annotation is currently showing, including across `update()` re-renders.
    this.detailPopover.el.setAttribute('aria-labelledby', AnnotationCard.TITLE_ID);
    this.detailPopover.setOnEscape(() => this.bus.emit('intent:close-detail', undefined));
    this.detailCard = new AnnotationCard({ bus: this.bus, annotation, confidence: resolvedConfidence });
    this.detailPopover.el.appendChild(this.detailCard.el);

    this.shadowHost.shadowRoot.appendChild(this.detailPopover.el);
    this.detailPopover.placeAt(anchor.clientX, anchor.clientY);
    this.detailCard.focus();
  }

  private handleEditAnnotation(): void {
    if (!this.openAnnotationId || !this.detailAnchor) return;
    const annotation = this.store.get(this.openAnnotationId);
    if (!annotation) return; // reconcileDetailView will have already closed us if this happened

    const anchor = this.detailAnchor;

    // Dispose only the popover DOM — `openAnnotationId`/`detailAnchor` stay
    // put, since we're swapping content in place, not closing the flow.
    this.detailPopover?.dispose();
    this.detailCard = null;

    this.detailPopover = new Popover({ className: 'wd-popover--form' });
    this.detailPopover.el.setAttribute('aria-label', 'Edit annotation');
    this.detailPopover.setOnEscape(() => this.bus.emit('intent:close-detail', undefined));
    this.detailForm = new AnnotationForm({
      bus: this.bus,
      mode: 'edit',
      initialValues: { title: annotation.title, description: annotation.description, priority: annotation.priority },
    });
    this.detailPopover.el.appendChild(this.detailForm.el);

    this.shadowHost.shadowRoot.appendChild(this.detailPopover.el);
    this.detailPopover.placeAt(anchor.clientX, anchor.clientY);
    this.detailForm.focus();
  }

  private handleUpdateAnnotation(payload: { title: string; description?: string; priority: AnnotationPriority }): void {
    if (!this.openAnnotationId) return;
    const id = this.openAnnotationId;
    const anchor = this.detailAnchor;
    const previous = this.store.get(id);
    if (!previous || !anchor) {
      this.closeDetailUi();
      return;
    }

    // Diff against the CURRENT store value (not the snapshot the form was
    // opened with) so `api.update()` is called with only what actually
    // changed, matching `description`'s undefined/empty-string normalization.
    const patch: UpdateAnnotationInput = {};
    if (payload.title !== previous.title) patch.title = payload.title;
    if ((payload.description ?? undefined) !== (previous.description ?? undefined)) patch.description = payload.description;
    if (payload.priority !== previous.priority) patch.priority = payload.priority;

    // Swap back to the view card immediately — matches the create flow's
    // "close the popover instantly, the network round-trip happens in the
    // background" UX. `reconcileDetailView` will refresh its content the
    // instant the optimistic upsert below fires.
    this.openDetailView(previous, anchor);

    if (Object.keys(patch).length === 0) return; // nothing actually changed — no network call needed

    void this.updateAnnotation(id, previous, patch);
  }

  private async updateAnnotation(id: string, previous: Annotation, patch: UpdateAnnotationInput): Promise<void> {
    const optimistic: Annotation = { ...previous, ...patch, updatedAt: new Date().toISOString() };
    this.store.upsert(optimistic);

    try {
      const updated = await this.api.update(id, patch, this.abortController.signal);
      if (this.abortController.signal.aborted) return;
      this.store.upsert(updated);
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      this.store.upsert(previous); // roll back to the EXACT previous annotation, not a partial revert
      if (err instanceof AuthError && (this.sessionToken || this.sessionExpired)) {
        this.expireSession(); // JWT expired — roll the edit back and re-prompt
        return;
      }
      this.reportError(toError(err));
    }
  }

  private handleChangeStatus(payload: { status: AnnotationStatus }): void {
    if (!this.openAnnotationId) return;
    const id = this.openAnnotationId;
    const previous = this.store.get(id);
    if (!previous) {
      this.closeDetailUi();
      return;
    }
    void this.changeStatus(id, previous, payload.status);
  }

  /**
   * `config.showResolved` defaults to false, so resolving must drop the
   * annotation out of the visible set (and the toolbar count) rather than
   * just flip its status in place — the Store IS the visible set, there's
   * no separate filter layer, so "hidden" means "removed from the Store".
   * `reconcileDetailView` (subscribed to the same Store diff this produces)
   * is what closes an open card when its annotation vanishes this way, so
   * this method doesn't need to know or care whether a card is open.
   */
  private async changeStatus(id: string, previous: Annotation, status: AnnotationStatus): Promise<void> {
    const optimistic: Annotation = {
      ...previous,
      status,
      resolvedAt: status === 'RESOLVED' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    if (status === 'RESOLVED' && !this.config.showResolved) this.store.remove(id);
    else this.store.upsert(optimistic);

    try {
      const updated = await this.api.changeStatus(id, status, this.abortController.signal);
      if (this.abortController.signal.aborted) return;
      if (updated.status === 'RESOLVED' && !this.config.showResolved) this.store.remove(id);
      else this.store.upsert(updated);
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      this.store.upsert(previous); // restores it — including re-showing it if it had been optimistically hidden
      if (err instanceof AuthError && (this.sessionToken || this.sessionExpired)) {
        this.expireSession(); // JWT expired — roll the status change back and re-prompt
        return;
      }
      this.reportError(toError(err));
    }
  }

  private handleDeleteAnnotation(): void {
    if (!this.openAnnotationId) return;
    const id = this.openAnnotationId;
    const previous = this.store.get(id);
    if (!previous) {
      this.closeDetailUi();
      return;
    }
    void this.deleteAnnotation(id, previous);
  }

  private async deleteAnnotation(id: string, previous: Annotation): Promise<void> {
    // Optimistic removal — `reconcileDetailView` closes the open card the
    // instant this diff fires, since `id` lands in its `removed` list.
    this.store.remove(id);

    try {
      await this.api.remove(id, this.abortController.signal);
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      this.store.upsert(previous); // restore on failure — card stays closed; the pin simply reappears
      if (err instanceof AuthError && (this.sessionToken || this.sessionExpired)) {
        this.expireSession(); // JWT expired — undo the delete and re-prompt
        return;
      }
      this.reportError(toError(err));
    }
  }

  /** Keeps whichever detail popover (card or edit form) is open in sync with the Store — see the class doc. */
  private reconcileDetailView(diff: AnnotationDiff): void {
    if (!this.openAnnotationId) return;

    if (diff.removed.includes(this.openAnnotationId)) {
      // Delete, or resolve-while-hidden. The pin is gone, so closeDetailUi's
      // toolbar fallback catches focus rather than dropping it to <body>.
      this.closeDetailUi({ restoreFocus: true });
      return;
    }

    const changed = [...diff.added, ...diff.updated].find((a) => a.id === this.openAnnotationId);
    if (changed && this.detailCard) {
      this.detailCard.update(changed);
    }
  }

  /**
   * `restoreFocus` is opt-in because this also runs as internal churn when
   * swapping view <-> edit surfaces, where stealing focus back to the pin
   * mid-transition would be wrong. Real closes (Escape, the close button,
   * delete, resolve-and-hide) pass `true`.
   */
  /**
   * The element focus should return to when the detail surface closes. Focus
   * already inside our own popover means this is a view <-> edit swap, not a
   * fresh open, so the originally-captured pin is preserved.
   */
  private captureReturnFocusTarget(): HTMLElement | null {
    const active = this.shadowHost.shadowRoot.activeElement;
    if (active instanceof HTMLElement && !this.detailPopover?.el.contains(active)) {
      return active;
    }
    return this.detailReturnFocus;
  }

  private closeDetailUi(options: { restoreFocus?: boolean } = {}): void {
    const returnTarget = this.detailReturnFocus;

    this.detailPopover?.dispose();
    this.detailPopover = null;
    this.detailCard = null;
    this.detailForm = null;
    this.openAnnotationId = null;
    this.detailAnchor = null;
    this.detailReturnFocus = null;
    this.openAnnotationConfidence = 'exact';

    if (!options.restoreFocus) return;

    // The pin may be gone (deleted, or resolved while hidden). Falling back to
    // the toolbar keeps focus somewhere useful inside the widget instead of
    // collapsing to <body>, which would strand a keyboard user at the top of
    // the host page.
    const fallback = this.shadowHost.shadowRoot.querySelector<HTMLElement>('.wd-toolbar button');
    const target = returnTarget?.isConnected ? returnTarget : fallback;
    target?.focus();
  }

  setMode(mode: WidgetMode): void {
    // Entering annotate/composing requires a signed-in reviewer for
    // attribution. `handleToggleMode` already guards the toolbar path; this
    // guards programmatic callers (e.g. `handle.setMode('annotate')`).
    if ((mode === 'annotate' || mode === 'composing') && !this.hasUser()) {
      this.log.warn('setMode: annotate/composing unavailable until the reviewer signs in.');
      return;
    }
    this.store.setMode(mode);
  }

  getMode(): WidgetMode {
    return this.store.getMode();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.bus.emit('state:visibility-changed', { visible: true });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.bus.emit('state:visibility-changed', { visible: false });
  }

  /** Defensive copy — Store already returns a fresh array, but keep the contract explicit. */
  getAnnotations(): readonly Annotation[] {
    return this.store.getAll();
  }

  /**
   * Re-fetches the list for the current pageKey and replaces the Store's
   * contents. Never rejects — failures are reported via `onError`/logging
   * (the same channel the initial autoLoad fetch uses), consistent with
   * this being a "keep going" background refresh rather than a one-shot
   * operation a caller needs to wrap in try/catch.
   */
  async refresh(): Promise<void> {
    await this.loadAnnotations();
  }

  on<K extends keyof PublicEvents>(event: K, handler: (payload: PublicEvents[K]) => void): () => void {
    return this.bus.on(event, handler);
  }

  destroy(): void {
    this.closeComposerUi();
    this.closeDetailUi();
    this.abortController.abort();
    this.disposables.dispose();
    this.bus.clear();
    this.log.debug('destroyed');
  }
}
