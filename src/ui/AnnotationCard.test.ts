import { describe, it, expect, vi } from 'vitest';
import { AnnotationCard } from './AnnotationCard';
import { EventBus } from '../core/EventBus';
import type { Annotation } from '../core/types';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    pageUrl: 'https://example.com/',
    selector: 'button',
    x: 10,
    y: 20,
    anchor: null,
    title: 'Broken layout',
    description: 'The button overlaps the footer.',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA Tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('AnnotationCard', () => {
  it('renders title, description, status, and meta from the annotation', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });

    expect(card.el.querySelector('.wd-card__title')?.textContent).toBe('Broken layout');
    expect(card.el.querySelector('.wd-card__description')?.textContent).toBe(
      'The button overlaps the footer.',
    );
    expect(card.el.querySelector('.wd-card__status')?.textContent).toBe('Open');
    expect(card.el.querySelector('.wd-card__meta')?.textContent).toContain('QA Tester');
  });

  it('hides the description element when there is no description', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation({ description: undefined }) });
    const description = card.el.querySelector('.wd-card__description') as HTMLElement;
    expect(description.hidden).toBe(true);
  });

  it('close button emits intent:close-detail', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('intent:close-detail', handler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });

    click(card.el.querySelector('.wd-card__close')!);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('edit button emits intent:edit-annotation', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('intent:edit-annotation', handler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });

    click(card.el.querySelector('[data-wd-action="edit"]')!);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('resolve button on an OPEN annotation emits change-status RESOLVED, and reads "Resolve"', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('intent:change-status', handler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation({ status: 'OPEN' }) });

    const resolveButton = card.el.querySelector('[data-wd-action="resolve"]') as HTMLButtonElement;
    expect(resolveButton.textContent).toBe('Resolve');
    click(resolveButton);
    expect(handler).toHaveBeenCalledWith({ status: 'RESOLVED' });
  });

  it('resolve button on a RESOLVED annotation reads "Reopen" and emits change-status OPEN', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('intent:change-status', handler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation({ status: 'RESOLVED' }) });

    const resolveButton = card.el.querySelector('[data-wd-action="resolve"]') as HTMLButtonElement;
    expect(resolveButton.textContent).toBe('Reopen');
    click(resolveButton);
    expect(handler).toHaveBeenCalledWith({ status: 'OPEN' });
  });

  it('delete requires two clicks: the first only arms confirmation, the second emits the intent', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('intent:delete-annotation', handler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });

    const deleteButton = card.el.querySelector('.wd-form__button--danger') as HTMLButtonElement;
    expect(deleteButton.textContent).toBe('Delete');

    click(deleteButton);
    expect(handler).not.toHaveBeenCalled();
    expect(deleteButton.textContent).toBe('Confirm delete?');

    click(deleteButton);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('the delete confirmation Cancel button reverts to the unarmed state without emitting delete', () => {
    const bus = new EventBus();
    const deleteHandler = vi.fn();
    bus.on('intent:delete-annotation', deleteHandler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });

    const deleteButton = card.el.querySelector('.wd-form__button--danger') as HTMLButtonElement;
    click(deleteButton); // arm

    const cancelButton = card.el.querySelector('[data-wd-action="delete-cancel"]') as HTMLButtonElement;
    expect(cancelButton.hidden).toBe(false);
    click(cancelButton);

    expect(deleteButton.textContent).toBe('Delete');
    expect(deleteHandler).not.toHaveBeenCalled();
  });

  it('update() re-renders with the new annotation and disarms any pending delete confirmation', () => {
    const bus = new EventBus();
    const deleteHandler = vi.fn();
    bus.on('intent:delete-annotation', deleteHandler);
    const card = new AnnotationCard({ bus, annotation: makeAnnotation({ status: 'OPEN' }) });

    const deleteButton = card.el.querySelector('.wd-form__button--danger') as HTMLButtonElement;
    click(deleteButton); // arm delete confirmation
    expect(deleteButton.textContent).toBe('Confirm delete?');

    card.update(makeAnnotation({ status: 'RESOLVED', title: 'Fixed now' }));

    expect(card.el.querySelector('.wd-card__title')?.textContent).toBe('Fixed now');
    expect(card.el.querySelector('.wd-card__status')?.textContent).toBe('Resolved');
    // A stale confirmation state must not survive an external data change.
    expect(deleteButton.textContent).toBe('Delete');

    click(deleteButton);
    expect(deleteHandler).not.toHaveBeenCalled(); // this click only re-arms, doesn't confirm
  });
});

describe('AnnotationCard accessibility (M6)', () => {
  it('the title carries the static TITLE_ID used for the Popover\'s aria-labelledby', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });
    const title = card.el.querySelector('.wd-card__title') as HTMLElement;
    expect(title.id).toBe(AnnotationCard.TITLE_ID);
  });

  it('focus() moves focus to the close button', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });
    document.body.appendChild(card.el);

    card.focus();

    expect(document.activeElement).toBe(card.el.querySelector('.wd-card__close'));
    document.body.innerHTML = '';
  });

  it('the delete button announces its label changes via aria-live', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });
    const deleteButton = card.el.querySelector('.wd-form__button--danger') as HTMLButtonElement;
    expect(deleteButton.getAttribute('aria-live')).toBe('polite');
  });
});

describe('AnnotationCard resolve-confidence notice (M5)', () => {
  it('shows no notice for exact confidence (the default)', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation() });
    const notice = card.el.querySelector('.wd-card__notice') as HTMLElement;
    expect(notice.hidden).toBe(true);
    expect(notice.textContent).toBe('');
  });

  it('shows a "position may have shifted" style notice for degraded confidence', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation(), confidence: 'degraded' });
    const notice = card.el.querySelector('.wd-card__notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('position may have shifted');
  });

  it('shows a distinct notice for orphaned confidence', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation(), confidence: 'orphaned' });
    const notice = card.el.querySelector('.wd-card__notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('approximate last-known location');
  });

  it('update() with a new confidence swaps the notice; update() without one keeps the current confidence', () => {
    const bus = new EventBus();
    const card = new AnnotationCard({ bus, annotation: makeAnnotation(), confidence: 'degraded' });
    const notice = card.el.querySelector('.wd-card__notice') as HTMLElement;
    expect(notice.hidden).toBe(false);

    card.update(makeAnnotation({ title: 'Still degraded' })); // no confidence arg -> keeps 'degraded'
    expect(notice.hidden).toBe(false);
    expect(card.el.querySelector('.wd-card__title')?.textContent).toBe('Still degraded');

    card.update(makeAnnotation({ title: 'Now exact' }), 'exact');
    expect(notice.hidden).toBe(true);
  });
});
