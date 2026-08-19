import { EventBus } from './EventBus';
import type { PublicEvents } from './events';
import type { ResolvedWebdotsConfig } from './config';
import { Store, type AnnotationDiff } from './Store';
import { PinManager } from './PinManager';
import type { Annotation, AnnotationPriority, AnnotationStatus, WidgetHandle, WidgetMode } from './types';
import type { AnchorDescriptor, ResolveConfidence } from '../anchor/types';
import { createAnchor } from '../anchor/createAnchor';
import type { AnnotationAPI, UpdateAnnotationInput } from '../api/AnnotationAPI';
import { HttpAnnotationAPI } from '../api/HttpAnnotationAPI';
import { ShadowHost } from '../ui/ShadowHost';
import { Toolbar } from '../ui/Toolbar';
import { Overlay } from '../ui/Overlay';
import { Highlighter } from '../ui/Highlighter';
import { Popover } from '../ui/Popover';
import { AnnotationForm } from '../ui/AnnotationForm';
import { AnnotationCard } from '../ui/AnnotationCard';
import { Toast } from '../ui/Toast';
import { Disposables } from '../utils/Disposables';
import { createLogger } from '../utils/log';
import { createId } from '../utils/id';

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

    if (config.autoLoad) {
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
      this.reportError(toError(err));
    }
  }

  private reportError(error: Error): void {
    this.log.error(error.message, error);
    this.bus.emit('state:error', { error });
  }

  private handleToggleMode(): void {
    this.setMode(this.getMode() === 'annotate' ? 'idle' : 'annotate');
  }

  private handleDocumentClick(event: MouseEvent): void {
    if (this.getMode() !== 'annotate') return;

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
      authorName: this.config.user.name,
      authorEmail: this.config.user.email,
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
          authorName: this.config.user.name,
          authorEmail: this.config.user.email,
        },
        this.abortController.signal,
      );
      if (this.abortController.signal.aborted) return; // destroyed mid-flight — nothing left to reconcile
      this.store.replaceId(tempId, created);
      this.config.onAnnotationCreated?.(created);
    } catch (err) {
      if (this.abortController.signal.aborted) return; // destroy() already tore everything down
      this.store.remove(tempId);
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
