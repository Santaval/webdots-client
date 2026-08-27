import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AnchorUpgrader } from './AnchorUpgrader';
import type { Annotation } from './types';
import type { AnchorDescriptor } from '../anchor/types';

const upgraded: AnchorDescriptor = {
  v: 1,
  strategy: 'testid',
  selector: '[data-testid="cta"]',
  path: 'body > button',
  ratio: { x: 0.25, y: 0.5 },
  viewportW: 1024,
  tag: 'BUTTON',
};

function makeAnnotation(id: string, anchor: AnchorDescriptor | null): Annotation {
  return {
    id,
    pageUrl: 'https://example.com/',
    selector: anchor?.selector ?? 'button',
    x: 10,
    y: 20,
    anchor,
    title: 'T',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('AnchorUpgrader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeController() {
    const controller = new AbortController();
    return controller;
  }

  it('debounces: the LATEST anchor per id wins and a burst flushes once after flushMs', async () => {
    const patch = vi.fn(async (_id: string, anchor: AnchorDescriptor) => makeAnnotation('srv_1', anchor));
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({ patch, onApplied, signal: controller.signal, flushMs: 1000 });

    const first: AnchorDescriptor = { ...upgraded, selector: '[data-testid="v1"]' };
    const latest: AnchorDescriptor = { ...upgraded, selector: '[data-testid="v2"]' };
    upgrader.schedule('srv_1', first);
    upgrader.schedule('srv_1', latest);

    expect(patch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toBe('srv_1');
    expect(patch.mock.calls[0]![1]).toBe(latest);

    await vi.runAllTimersAsync();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied.mock.calls[0]![0].anchor).toBe(latest);
    upgrader.dispose();
  });

  it('flushes multiple distinct ids in one batch', async () => {
    const patch = vi.fn(async (id: string, anchor: AnchorDescriptor) => makeAnnotation(id, anchor));
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({ patch, onApplied, signal: controller.signal, flushMs: 500 });

    upgrader.schedule('srv_1', upgraded);
    upgrader.schedule('srv_2', { ...upgraded, selector: '[data-testid="other"]' });

    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    const ids = patch.mock.calls.map((c) => c[0]);
    expect(ids).toEqual(expect.arrayContaining(['srv_1', 'srv_2']));
    expect(patch).toHaveBeenCalledTimes(2);
    expect(onApplied).toHaveBeenCalledTimes(2);
    upgrader.dispose();
  });

  it('prevents the no-column loop: after a PATCH that returns a coords anchor again, a re-schedule does NOT re-PATCH', async () => {
    // A no-column server returns no anchor -> dto re-synthesizes coords, so
    // the "applied" annotation has a coords anchor. PinManager would re-emit
    // on a later cache-miss; the upgrader must NOT re-dispatch.
    const patch = vi.fn(async () => makeAnnotation('srv_1', { ...upgraded, strategy: 'coords' as const }));
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({ patch, onApplied, signal: controller.signal, flushMs: 100 });

    upgrader.schedule('srv_1', upgraded);
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(patch).toHaveBeenCalledTimes(1);

    // PinManager re-detects (simulated) and re-schedules — must be skipped.
    upgrader.schedule('srv_1', upgraded);
    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(patch).toHaveBeenCalledTimes(1);
    upgrader.dispose();
  });

  it('does not retry after a PATCH failure (silent + no loop)', async () => {
    const patch = vi.fn(async () => {
      throw new Error('network down');
    });
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({ patch, onApplied, signal: controller.signal, flushMs: 100 });

    upgrader.schedule('srv_1', upgraded);
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(patch).toHaveBeenCalledTimes(1);
    expect(onApplied).not.toHaveBeenCalled();

    upgrader.schedule('srv_1', upgraded);
    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(patch).toHaveBeenCalledTimes(1);
    upgrader.dispose();
  });

  it('dispose() cancels the pending flush — no PATCH fires', () => {
    const patch = vi.fn();
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({ patch, onApplied, signal: controller.signal, flushMs: 1000 });

    upgrader.schedule('srv_1', upgraded);
    upgrader.dispose();

    vi.advanceTimersByTime(2000);
    expect(patch).not.toHaveBeenCalled();
  });

  it('skips optimistic local_* ids (their create round-trip is still in flight)', () => {
    const patch = vi.fn(async (_id: string, anchor: AnchorDescriptor) => makeAnnotation('srv_1', anchor));
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({
      patch,
      onApplied,
      signal: controller.signal,
      flushMs: 100,
      isLiveId: (id) => !id.startsWith('local_'),
    });

    upgrader.schedule('local_abc', upgraded);
    vi.advanceTimersByTime(1000);

    expect(patch).not.toHaveBeenCalled();
    upgrader.dispose();
  });

  it('does not call onApplied when the session aborted mid-PATCH', async () => {
    let releasePatch: (() => void) | undefined;
    const patch = vi.fn(
      () =>
        new Promise<Annotation>((resolve) => {
          releasePatch = () => resolve(makeAnnotation('srv_1', upgraded));
        }),
    );
    const onApplied = vi.fn();
    const controller = makeController();
    const upgrader = new AnchorUpgrader({ patch, onApplied, signal: controller.signal, flushMs: 100 });

    upgrader.schedule('srv_1', upgraded);
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    // PATCH is in flight — abort the session, then let it resolve.
    controller.abort();
    releasePatch!();
    await vi.runAllTimersAsync();

    expect(onApplied).not.toHaveBeenCalled();
    upgrader.dispose();
  });
});
