let counter = 0;

/**
 * Generates a locally-unique id for annotations created before any server
 * round-trip exists — in M2 every annotation is local-only (Store never
 * talks to a network). Once M3 wires up `HttpAnnotationAPI`, these become
 * optimistic temp ids that get reconciled to the server-assigned id on
 * response.
 */
export function createId(prefix = 'wd'): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${random}`;
}
