import { describe, it, expect, vi } from 'vitest';
import { Disposables } from './Disposables';

describe('Disposables', () => {
  it('runs teardown functions in reverse registration order', () => {
    const order: number[] = [];
    const d = new Disposables();

    d.add(() => order.push(1));
    d.add(() => order.push(2));
    d.add(() => order.push(3));

    d.dispose();

    expect(order).toEqual([3, 2, 1]);
  });

  it('is idempotent — a second dispose() call runs nothing again', () => {
    const fn = vi.fn();
    const d = new Disposables();

    d.add(fn);
    d.dispose();
    d.dispose();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('one failing disposer does not stop the rest from running', () => {
    const order: string[] = [];
    const d = new Disposables();

    d.add(() => order.push('first'));
    d.add(() => {
      throw new Error('boom');
    });
    d.add(() => order.push('last'));

    expect(() => d.dispose()).not.toThrow();
    // registration order: first, throwing, last -> reverse: last, throwing, first
    expect(order).toEqual(['last', 'first']);
  });

  it('marks isDisposed after dispose() and runs late-added disposers immediately', () => {
    const d = new Disposables();
    d.dispose();
    expect(d.isDisposed).toBe(true);

    const late = vi.fn();
    d.add(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
