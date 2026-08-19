import { describe, it, expect, vi } from 'vitest';
import { Store } from './Store';
import { EventBus } from './EventBus';
import type { Annotation } from './types';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    pageUrl: 'https://example.com/',
    selector: 'button',
    x: 10,
    y: 20,
    anchor: null,
    title: 'Broken layout',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Store', () => {
  it('upsert() of a new id emits a diff with it in `added`', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);
    const store = new Store(bus);

    const annotation = makeAnnotation();
    store.upsert(annotation);

    expect(handler).toHaveBeenCalledWith({ added: [annotation], updated: [], removed: [] });
    expect(store.getAll()).toEqual([annotation]);
  });

  it('upsert() of an existing id emits a diff with it in `updated`', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    const annotation = makeAnnotation();
    store.upsert(annotation);

    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);
    const changed = { ...annotation, title: 'Fixed title' };
    store.upsert(changed);

    expect(handler).toHaveBeenCalledWith({ added: [], updated: [changed], removed: [] });
    expect(store.get('a1')?.title).toBe('Fixed title');
  });

  it('remove() emits a diff with the id in `removed` and drops it from getAll()', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    store.upsert(makeAnnotation());

    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);
    store.remove('a1');

    expect(handler).toHaveBeenCalledWith({ added: [], updated: [], removed: ['a1'] });
    expect(store.getAll()).toEqual([]);
  });

  it('remove() of a nonexistent id is a silent no-op — no event emitted', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);
    const store = new Store(bus);

    store.remove('nope');

    expect(handler).not.toHaveBeenCalled();
  });

  it('replaceAll() diffs against the previous set: new ids added, existing ids updated, missing ids removed', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    store.upsert(makeAnnotation({ id: 'a1' }));
    store.upsert(makeAnnotation({ id: 'a2' }));

    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);

    const a2Updated = makeAnnotation({ id: 'a2', title: 'Updated' });
    const a3New = makeAnnotation({ id: 'a3' });
    store.replaceAll([a2Updated, a3New]);

    expect(handler).toHaveBeenCalledTimes(1);
    const diff = handler.mock.calls[0]![0];
    expect(diff.added).toEqual([a3New]);
    expect(diff.updated).toEqual([a2Updated]);
    expect(diff.removed).toEqual(['a1']);
    expect(store.getAll().map((a) => a.id).sort()).toEqual(['a2', 'a3']);
  });

  it('setMode() emits state:mode-changed only when the mode actually changes', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('state:mode-changed', handler);
    const store = new Store(bus);

    store.setMode('annotate');
    store.setMode('annotate'); // no-op, same mode
    store.setMode('idle');

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]![0]).toEqual({ mode: 'annotate' });
    expect(handler.mock.calls[1]![0]).toEqual({ mode: 'idle' });
    expect(store.getMode()).toBe('idle');
  });

  it('clear() removes everything and emits a single diff, or nothing if already empty', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    store.upsert(makeAnnotation({ id: 'a1' }));
    store.upsert(makeAnnotation({ id: 'a2' }));

    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);
    store.clear();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].removed.sort()).toEqual(['a1', 'a2']);
    expect(store.getAll()).toEqual([]);

    handler.mockClear();
    store.clear();
    expect(handler).not.toHaveBeenCalled();
  });

  it('replaceId() swaps a temp id for a server id, preserving position and firing one diff', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    store.upsert(makeAnnotation({ id: 'local_1', title: 'first' }));
    store.upsert(makeAnnotation({ id: 'local_2', title: 'second' }));
    store.upsert(makeAnnotation({ id: 'local_3', title: 'third' }));

    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);

    const reconciled = makeAnnotation({ id: 'srv_42', title: 'second' });
    store.replaceId('local_2', reconciled);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual({ added: [reconciled], updated: [], removed: ['local_2'] });

    // Position preserved: still the SECOND entry in iteration order, not
    // bumped to the end — this is what keeps pin numbering stable.
    const ids = store.getAll().map((a) => a.id);
    expect(ids).toEqual(['local_1', 'srv_42', 'local_3']);
    expect(store.get('local_2')).toBeUndefined();
    expect(store.get('srv_42')).toEqual(reconciled);
  });

  it('replaceId() falls back to a plain upsert when the old id is not present', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);

    const annotation = makeAnnotation({ id: 'srv_1' });
    store.replaceId('never_existed', annotation);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual({ added: [annotation], updated: [], removed: [] });
    expect(store.getAll()).toEqual([annotation]);
  });

  it('replaceId() with matching old/new id behaves like a plain upsert', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    store.upsert(makeAnnotation({ id: 'a1', title: 'first' }));

    const handler = vi.fn();
    bus.on('state:annotations-changed', handler);

    const updated = makeAnnotation({ id: 'a1', title: 'updated' });
    store.replaceId('a1', updated);

    expect(handler.mock.calls[0]![0]).toEqual({ added: [], updated: [updated], removed: [] });
  });

  it('getAll() returns a fresh array each call (no shared mutable reference)', () => {
    const bus = new EventBus();
    const store = new Store(bus);
    store.upsert(makeAnnotation());

    const first = store.getAll();
    first.push(makeAnnotation({ id: 'intruder' }));

    expect(store.getAll()).toHaveLength(1);
  });
});
