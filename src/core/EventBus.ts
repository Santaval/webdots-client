import type { WebdotsEvents } from './events';
import { createLogger } from '../utils/log';

type Handler<T> = (payload: T) => void;

/**
 * Typed pub/sub — the sole cross-module communication channel. UI modules
 * never import each other; they emit/subscribe through a shared bus
 * instance instead. A throwing handler is caught and logged so one bad
 * subscriber can never break delivery to the others.
 */
export class EventBus {
  private handlers = new Map<keyof WebdotsEvents, Set<Handler<unknown>>>();
  private log: ReturnType<typeof createLogger>;

  constructor(debug = false) {
    this.log = createLogger('EventBus', debug);
  }

  on<K extends keyof WebdotsEvents>(event: K, handler: Handler<WebdotsEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);

    return () => {
      set?.delete(handler as Handler<unknown>);
    };
  }

  emit<K extends keyof WebdotsEvents>(event: K, payload: WebdotsEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    // Snapshot so a handler unsubscribing/subscribing mid-emit doesn't
    // mutate the set we're iterating.
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (err) {
        this.log.error(`handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
