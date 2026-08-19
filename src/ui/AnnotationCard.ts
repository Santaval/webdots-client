import { h } from './dom';
import type { EventBus } from '../core/EventBus';
import type { Annotation, AnnotationPriority } from '../core/types';
import type { ResolveConfidence } from '../anchor/types';

export interface AnnotationCardOptions {
  bus: EventBus;
  annotation: Annotation;
  /** The pin's resolve confidence at the moment it was clicked — see the class doc's M5 note. */
  confidence?: ResolveConfidence;
}

/**
 * The view/detail popover for an existing annotation. Rendered inside a
 * `Popover` by Widget, the same way `AnnotationForm` is — reuses its
 * flip/shift + Escape-to-close machinery rather than any new positioning
 * logic.
 *
 * Per the "UI emits intents, never touches Store/API" rule, every action
 * here is an intent; Widget performs the optimistic-then-reconcile dance
 * and calls `update()` on this instance whenever the underlying
 * annotation's data changes (a successful edit, resolve/reopen, or a
 * refresh() picking up a change from elsewhere).
 *
 * Delete is a two-step in-popover confirm — `handleDeleteClick` only emits
 * `intent:delete-annotation` on the SECOND click; the first click just
 * flips the button into a "Confirm delete?" state. Never `window.confirm`.
 *
 * M5: `confidence` — the resolve confidence the clicked pin was rendering
 * AT THE MOMENT it was opened (forwarded by Overlay via
 * `intent:open-annotation`, plan §4) — drives a plain-language
 * `.wd-card__notice` warning for `degraded`/`orphaned` pins. `exact` (or no
 * confidence supplied) renders nothing extra. A possibly-wrong position is
 * never presented as certain.
 */
export class AnnotationCard {
  readonly el: HTMLDivElement;

  private bus: EventBus;
  private annotation: Annotation;
  private confidence: ResolveConfidence;
  private confirmingDelete = false;

  private titleEl: HTMLHeadingElement;
  private statusEl: HTMLSpanElement;
  private noticeEl: HTMLParagraphElement;
  private descriptionEl: HTMLParagraphElement;
  private metaEl: HTMLParagraphElement;
  private resolveButton: HTMLButtonElement;
  private deleteButton: HTMLButtonElement;
  private deleteCancelButton: HTMLButtonElement;
  private closeButton: HTMLButtonElement;

  /**
   * Static — only one `AnnotationCard` is ever mounted at a time (Widget
   * keeps the create-composer and detail-view popovers mutually exclusive),
   * so there's no risk of a duplicate-id collision. Widget uses this to set
   * `aria-labelledby` on the enclosing Popover so the dialog announces the
   * annotation's title as its accessible name.
   */
  static readonly TITLE_ID = 'wd-card-title';

  constructor(options: AnnotationCardOptions) {
    this.bus = options.bus;
    this.annotation = options.annotation;
    this.confidence = options.confidence ?? 'exact';

    this.titleEl = h('h3', { className: 'wd-card__title', id: AnnotationCard.TITLE_ID });
    this.statusEl = h('span', { className: 'wd-card__status' });
    this.noticeEl = h('p', { className: 'wd-card__notice', role: 'note' });
    this.descriptionEl = h('p', { className: 'wd-card__description' });
    this.metaEl = h('p', { className: 'wd-card__meta' });

    this.closeButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-card__close',
        'aria-label': 'Close',
        'data-wd-action': 'close',
        onclick: () => this.bus.emit('intent:close-detail', undefined),
      },
      '×',
    );
    const closeButton = this.closeButton;

    const editButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-form__button wd-form__button--secondary',
        'data-wd-action': 'edit',
        onclick: () => this.bus.emit('intent:edit-annotation', undefined),
      },
      'Edit',
    );

    this.resolveButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-form__button wd-form__button--secondary',
        'data-wd-action': 'resolve',
        onclick: () => this.handleToggleStatus(),
      },
      '',
    );

    this.deleteButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-form__button wd-form__button--danger',
        'data-wd-action': 'delete',
        // The two-step confirm changes this button's own label in place
        // ("Delete" -> "Confirm delete?") rather than opening a separate
        // dialog — aria-live announces that swap to assistive tech even
        // though the element that changed already has focus.
        'aria-live': 'polite',
        onclick: () => this.handleDeleteClick(),
      },
      'Delete',
    );

    this.deleteCancelButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-form__button wd-form__button--secondary',
        'data-wd-action': 'delete-cancel',
        hidden: true,
        onclick: () => this.cancelDeleteConfirm(),
      },
      'Cancel',
    );

    this.el = h(
      'div',
      { className: 'wd-card' },
      h('div', { className: 'wd-card__header' }, this.titleEl, this.statusEl, closeButton),
      this.noticeEl,
      this.descriptionEl,
      this.metaEl,
      h(
        'div',
        { className: 'wd-form__actions wd-card__actions' },
        editButton,
        this.resolveButton,
        this.deleteCancelButton,
        this.deleteButton,
      ),
    );

    this.render();
  }

  /**
   * Called by Widget right after the card is placed, mirroring
   * `AnnotationForm.focus()` — moves keyboard focus onto the card the
   * moment it opens (a pin click/Enter, or Escape returning from edit mode)
   * instead of leaving it stranded on whatever element was focused before.
   * The close button is the first logical stop in the dialog's tab order.
   */
  focus(): void {
    this.closeButton.focus();
  }

  /**
   * Widget calls this whenever the underlying annotation changes underneath
   * an open card. `confidence` is optional — omitted, it keeps whatever
   * confidence the card is currently showing (a plain Store edit doesn't by
   * itself tell us anything new about the pin's resolve confidence).
   */
  update(annotation: Annotation, confidence?: ResolveConfidence): void {
    this.annotation = annotation;
    if (confidence !== undefined) this.confidence = confidence;
    // An external change (edit landed, status flipped elsewhere) invalidates
    // any in-flight delete confirmation rather than silently keeping it armed.
    this.confirmingDelete = false;
    this.render();
  }

  private handleToggleStatus(): void {
    const next = this.annotation.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
    this.bus.emit('intent:change-status', { status: next });
  }

  private handleDeleteClick(): void {
    if (!this.confirmingDelete) {
      this.confirmingDelete = true;
      this.render();
      return;
    }
    this.bus.emit('intent:delete-annotation', undefined);
  }

  private cancelDeleteConfirm(): void {
    this.confirmingDelete = false;
    this.render();
  }

  private render(): void {
    const a = this.annotation;
    this.titleEl.textContent = a.title;

    this.statusEl.textContent = a.status === 'RESOLVED' ? 'Resolved' : 'Open';
    this.statusEl.setAttribute('data-status', a.status);

    this.noticeEl.textContent = confidenceNotice(this.confidence) ?? '';
    this.noticeEl.hidden = this.confidence !== 'degraded' && this.confidence !== 'orphaned';

    this.descriptionEl.textContent = a.description ?? '';
    this.descriptionEl.hidden = !a.description;

    this.metaEl.textContent = `${priorityLabel(a.priority)} · ${a.authorName} · ${formatDate(a.createdAt)}`;

    this.resolveButton.textContent = a.status === 'RESOLVED' ? 'Reopen' : 'Resolve';

    this.deleteButton.textContent = this.confirmingDelete ? 'Confirm delete?' : 'Delete';
    this.deleteButton.classList.toggle('wd-form__button--confirm', this.confirmingDelete);
    this.deleteCancelButton.hidden = !this.confirmingDelete;
  }
}

/**
 * Plain-language copy for the non-`exact` confidences, per the plan §4
 * requirement: "never present a possibly-wrong position as certain."
 * `exact`/`lost` return `undefined` — `lost` never reaches this card at all
 * (its pin isn't rendered, so it can't be clicked open), and `exact` needs
 * no caveat.
 */
function confidenceNotice(confidence: ResolveConfidence): string | undefined {
  switch (confidence) {
    case 'degraded':
      return "This annotation's original element couldn't be found — it was relocated using a fallback match. Its position may have shifted.";
    case 'orphaned':
      return "This annotation's original element could not be found on the page. Its position is an approximate last-known location.";
    default:
      return undefined;
  }
}

function priorityLabel(priority: AnnotationPriority): string {
  return priority.charAt(0) + priority.slice(1).toLowerCase();
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
