import { h } from './dom';
import type { EventBus } from '../core/EventBus';
import type { AnnotationPriority } from '../core/types';

export interface AnnotationFormInitialValues {
  title: string;
  description?: string;
  priority: AnnotationPriority;
}

export interface AnnotationFormOptions {
  bus: EventBus;
  /** Default 'create'. 'edit' pre-fills from `initialValues` and emits `intent:update-annotation` on submit instead. */
  mode?: 'create' | 'edit';
  initialValues?: AnnotationFormInitialValues;
}

/**
 * Title/description/priority form content, shared by the create flow (M2)
 * and the edit flow (M4) — reused rather than duplicated per the plan.
 * Rendered inside a Popover by Widget. Per the "UI emits intents and never
 * calls the API/Store" rule, this only ever emits one of
 * `intent:create-annotation` / `intent:update-annotation` (on submit,
 * depending on `mode`) or `intent:cancel-annotation` / `intent:close-detail`
 * (on Cancel/Escape, likewise by mode) — it has no idea what an anchor, a
 * Store, or an annotation id is. Widget combines the submitted payload with
 * whatever context (a captured anchor, or the currently-open annotation id)
 * belongs to the active flow.
 */
export class AnnotationForm {
  readonly el: HTMLFormElement;

  private bus: EventBus;
  private mode: 'create' | 'edit';
  private titleInput: HTMLInputElement;
  private descriptionInput: HTMLTextAreaElement;
  private prioritySelect: HTMLSelectElement;
  private errorEl: HTMLParagraphElement;

  constructor(options: AnnotationFormOptions) {
    this.bus = options.bus;
    this.mode = options.mode ?? 'create';
    const initial = options.initialValues;

    this.titleInput = h('input', {
      className: 'wd-form__input',
      type: 'text',
      placeholder: 'What needs attention?',
      required: true,
      'aria-label': 'Annotation title',
    });
    if (initial) this.titleInput.value = initial.title;

    this.descriptionInput = h('textarea', {
      className: 'wd-form__textarea',
      placeholder: 'Optional details…',
      'aria-label': 'Annotation description',
    });
    if (initial?.description) this.descriptionInput.value = initial.description;

    this.prioritySelect = h(
      'select',
      { className: 'wd-form__select', 'aria-label': 'Priority' },
      h('option', { value: 'LOW' }, 'Low'),
      h('option', { value: 'MEDIUM' }, 'Medium'),
      h('option', { value: 'HIGH' }, 'High'),
    );
    this.prioritySelect.value = initial?.priority ?? 'MEDIUM';

    this.errorEl = h('p', { className: 'wd-form__error', role: 'alert', hidden: true });

    const cancelButton = h(
      'button',
      {
        type: 'button',
        className: 'wd-form__button wd-form__button--secondary',
        onclick: () => this.bus.emit(this.mode === 'edit' ? 'intent:close-detail' : 'intent:cancel-annotation', undefined),
      },
      'Cancel',
    );

    const submitButton = h(
      'button',
      { type: 'submit', className: 'wd-form__button wd-form__button--primary' },
      this.mode === 'edit' ? 'Save changes' : 'Add annotation',
    );

    this.el = h(
      'form',
      {
        className: 'wd-form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          this.handleSubmit();
        },
      },
      field('Title', this.titleInput),
      field('Description', this.descriptionInput),
      field('Priority', this.prioritySelect),
      this.errorEl,
      h('div', { className: 'wd-form__actions' }, cancelButton, submitButton),
    );
  }

  focus(): void {
    this.titleInput.focus();
  }

  private handleSubmit(): void {
    const title = this.titleInput.value.trim();
    if (!title) {
      this.errorEl.textContent = 'Title is required.';
      this.errorEl.hidden = false;
      this.titleInput.focus();
      return;
    }

    this.errorEl.hidden = true;
    const description = this.descriptionInput.value.trim();
    const priority = this.prioritySelect.value as AnnotationPriority;

    const payload = {
      title,
      description: description || undefined,
      priority,
    };

    this.bus.emit(this.mode === 'edit' ? 'intent:update-annotation' : 'intent:create-annotation', payload);
  }
}

function field(label: string, control: HTMLElement): HTMLDivElement {
  return h('div', { className: 'wd-form__field' }, h('label', { className: 'wd-form__label' }, label), control);
}
