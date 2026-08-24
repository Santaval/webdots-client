import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Highlighter } from './Highlighter';
import { EventBus } from '../core/EventBus';

let raf: ReturnType<typeof installControllableRaf>;

function installControllableRaf() {
  let queue: Array<FrameRequestCallback> = [];
  let nextId = 1;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.push(cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });

  return {
    flush(): void {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) cb(0);
    },
    pendingCount(): number {
      return queue.length;
    },
  };
}

function stubRect(el: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {},
    ...rect,
  });
}

function makeMousemove(target: Element): MouseEvent {
  const event = new MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(event, 'composedPath', {
    value: () => [target],
  });
  return event;
}

function makeMousemoveFromHost(target: Element, host: Element): MouseEvent {
  const event = new MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(event, 'composedPath', {
    value: () => [target, host],
  });
  return event;
}

describe('Highlighter', () => {
  beforeEach(() => {
    raf = installControllableRaf();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('construction (attach)', () => {
    it('creates el with wd-highlight and wd-highlight--hidden classes', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      const highlighter = new Highlighter({ bus, hostElement: host });
      expect(highlighter.el.classList.contains('wd-highlight')).toBe(true);
      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);
      highlighter.dispose();
    });

    it('el has aria-hidden="true"', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      const highlighter = new Highlighter({ bus, hostElement: host });
      expect(highlighter.el.getAttribute('aria-hidden')).toBe('true');
      highlighter.dispose();
    });
  });

  describe('mode gate', () => {
    it('in idle mode, mousemove does not show the highlight', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 10, top: 20, width: 100, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      highlighter.dispose();
      host.remove();
    });

    it('in composing mode, mousemove does not show the highlight', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'composing' });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 10, top: 20, width: 100, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      highlighter.dispose();
      host.remove();
    });
  });

  describe('hover (show)', () => {
    it('in annotate mode, mousemove shows the highlight with correct dimensions', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 10, top: 20, width: 100, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(false);
      expect(highlighter.el.style.transform).toContain('translate(10px, 20px)');
      expect(highlighter.el.style.width).toBe('100px');
      expect(highlighter.el.style.height).toBe('50px');

      highlighter.dispose();
      host.remove();
    });

    it('moving to a new target updates position', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const t1 = document.createElement('div');
      const t2 = document.createElement('div');
      document.body.appendChild(t1);
      document.body.appendChild(t2);
      stubRect(t1, { left: 0, top: 0, width: 10, height: 10 });
      stubRect(t2, { left: 50, top: 60, width: 200, height: 300 });

      t1.dispatchEvent(makeMousemove(t1));
      raf.flush();
      expect(highlighter.el.style.width).toBe('10px');

      t2.dispatchEvent(makeMousemove(t2));
      raf.flush();
      expect(highlighter.el.style.width).toBe('200px');
      expect(highlighter.el.style.transform).toContain('translate(50px, 60px)');

      highlighter.dispose();
      host.remove();
    });
  });

  describe('host element in composedPath', () => {
    it('mousemove whose path includes hostElement keeps highlight hidden', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      document.body.appendChild(target);

      target.dispatchEvent(makeMousemoveFromHost(target, host));
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      highlighter.dispose();
      host.remove();
    });
  });

  describe('ignoreSelector', () => {
    it('target matching ignoreSelector keeps highlight hidden', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host, ignoreSelector: '.wd-ignore' });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      target.className = 'wd-ignore';
      document.body.appendChild(target);
      stubRect(target, { left: 0, top: 0, width: 50, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      highlighter.dispose();
      host.remove();
    });

    it('target not matching ignoreSelector shows highlight', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host, ignoreSelector: '.wd-ignore' });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      target.className = 'other-class';
      document.body.appendChild(target);
      stubRect(target, { left: 0, top: 0, width: 50, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(false);

      highlighter.dispose();
      host.remove();
    });
  });

  describe('non-Element composedPath target', () => {
    it('composedPath()[0] that is not an Element clears the highlight', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 0, top: 0, width: 50, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();
      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(false);

      const textNode = document.createTextNode('text');
      target.appendChild(textNode);
      const event = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(event, 'composedPath', {
        value: () => [textNode, target],
      });

      target.dispatchEvent(event);
      raf.flush();

      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      highlighter.dispose();
      host.remove();
    });
  });

  describe('mode change to non-annotate clears highlight', () => {
    it('changing mode to idle while shown clears it immediately', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 0, top: 0, width: 50, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      raf.flush();
      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(false);

      bus.emit('state:mode-changed', { mode: 'idle' });
      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      highlighter.dispose();
      host.remove();
    });
  });

  describe('dispose (detach)', () => {
    it('removes the document mousemove listener', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 0, top: 0, width: 50, height: 50 });

      highlighter.dispose();

      target.dispatchEvent(makeMousemove(target));
      raf.flush();
      expect(highlighter.el.classList.contains('wd-highlight--hidden')).toBe(true);

      host.remove();
    });

    it('cancels the pending rAF', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });
      bus.emit('state:mode-changed', { mode: 'annotate' });

      const target = document.createElement('div');
      document.body.appendChild(target);
      stubRect(target, { left: 0, top: 0, width: 50, height: 50 });

      target.dispatchEvent(makeMousemove(target));
      expect(raf.pendingCount()).toBe(1);

      highlighter.dispose();
      expect(raf.pendingCount()).toBe(0);

      host.remove();
    });

    it('removes el from the DOM', () => {
      const bus = new EventBus();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const highlighter = new Highlighter({ bus, hostElement: host });

      document.body.appendChild(highlighter.el);
      expect(highlighter.el.parentNode).not.toBeNull();

      highlighter.dispose();
      expect(highlighter.el.parentNode).toBeNull();

      host.remove();
    });
  });
});
