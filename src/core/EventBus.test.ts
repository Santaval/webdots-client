import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('delivers emitted payloads to subscribed handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('state:mode-changed', handler);
    bus.emit('state:mode-changed', { mode: 'annotate' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ mode: 'annotate' });
  });

  it('supports multiple subscribers to the same event', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();

    bus.on('state:mode-changed', a);
    bus.on('state:mode-changed', b);
    bus.emit('state:mode-changed', { mode: 'idle' });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further delivery without affecting other handlers', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();

    const unsubA = bus.on('state:mode-changed', a);
    bus.on('state:mode-changed', b);

    unsubA();
    bus.emit('state:mode-changed', { mode: 'annotate' });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a throwing handler does not prevent other handlers from running', () => {
    const bus = new EventBus();
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });

    bus.on('state:mode-changed', bad);
    bus.on('state:mode-changed', good);

    expect(() => bus.emit('state:mode-changed', { mode: 'annotate' })).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('emitting an event with no subscribers is a no-op', () => {
    const bus = new EventBus();
    expect(() => bus.emit('state:mode-changed', { mode: 'idle' })).not.toThrow();
  });

  it('clear() removes all handlers so no further delivery occurs', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('state:mode-changed', handler);
    bus.clear();
    bus.emit('state:mode-changed', { mode: 'annotate' });

    expect(handler).not.toHaveBeenCalled();
  });
});
