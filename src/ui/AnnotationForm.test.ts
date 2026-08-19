import { describe, it, expect, vi } from 'vitest';
import { AnnotationForm } from './AnnotationForm';
import { EventBus } from '../core/EventBus';

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('AnnotationForm', () => {
  it('defaults to create mode: emits intent:create-annotation on submit, "Add annotation" label', () => {
    const bus = new EventBus();
    const created = vi.fn();
    bus.on('intent:create-annotation', created);
    const form = new AnnotationForm({ bus });

    expect(form.el.querySelector('[type=submit]')?.textContent).toBe('Add annotation');

    (form.el.querySelector('[aria-label="Annotation title"]') as HTMLInputElement).value = 'New issue';
    submit(form.el);

    expect(created).toHaveBeenCalledWith({ title: 'New issue', description: undefined, priority: 'MEDIUM' });
  });

  it('create mode Cancel emits intent:cancel-annotation, not intent:close-detail', () => {
    const bus = new EventBus();
    const cancelAnnotation = vi.fn();
    const closeDetail = vi.fn();
    bus.on('intent:cancel-annotation', cancelAnnotation);
    bus.on('intent:close-detail', closeDetail);
    const form = new AnnotationForm({ bus });

    click(form.el.querySelector('.wd-form__button--secondary')!);

    expect(cancelAnnotation).toHaveBeenCalledTimes(1);
    expect(closeDetail).not.toHaveBeenCalled();
  });

  it('edit mode pre-fills inputs from initialValues and labels the submit button "Save changes"', () => {
    const bus = new EventBus();
    const form = new AnnotationForm({
      bus,
      mode: 'edit',
      initialValues: { title: 'Existing title', description: 'Existing description', priority: 'HIGH' },
    });

    expect((form.el.querySelector('[aria-label="Annotation title"]') as HTMLInputElement).value).toBe(
      'Existing title',
    );
    expect(
      (form.el.querySelector('[aria-label="Annotation description"]') as HTMLTextAreaElement).value,
    ).toBe('Existing description');
    expect((form.el.querySelector('[aria-label="Priority"]') as HTMLSelectElement).value).toBe('HIGH');
    expect(form.el.querySelector('[type=submit]')?.textContent).toBe('Save changes');
  });

  it('edit mode submit emits intent:update-annotation (not intent:create-annotation)', () => {
    const bus = new EventBus();
    const created = vi.fn();
    const updated = vi.fn();
    bus.on('intent:create-annotation', created);
    bus.on('intent:update-annotation', updated);
    const form = new AnnotationForm({
      bus,
      mode: 'edit',
      initialValues: { title: 'Existing title', priority: 'LOW' },
    });

    (form.el.querySelector('[aria-label="Annotation title"]') as HTMLInputElement).value = 'Edited title';
    submit(form.el);

    expect(created).not.toHaveBeenCalled();
    expect(updated).toHaveBeenCalledWith({ title: 'Edited title', description: undefined, priority: 'LOW' });
  });

  it('edit mode Cancel emits intent:close-detail, not intent:cancel-annotation', () => {
    const bus = new EventBus();
    const cancelAnnotation = vi.fn();
    const closeDetail = vi.fn();
    bus.on('intent:cancel-annotation', cancelAnnotation);
    bus.on('intent:close-detail', closeDetail);
    const form = new AnnotationForm({ bus, mode: 'edit', initialValues: { title: 'x', priority: 'LOW' } });

    click(form.el.querySelector('.wd-form__button--secondary')!);

    expect(closeDetail).toHaveBeenCalledTimes(1);
    expect(cancelAnnotation).not.toHaveBeenCalled();
  });
});
