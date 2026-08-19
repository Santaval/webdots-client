/**
 * Namespaced logger gated by `config.debug`. When debug is off, every method
 * is a no-op — callers never need to guard call sites themselves.
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const PREFIX = '[webdots]';

export function createLogger(namespace: string, enabled: boolean): Logger {
  const tag = `${PREFIX}[${namespace}]`;

  if (!enabled) {
    const noop = () => {};
    return { debug: noop, info: noop, warn: noop, error: noop };
  }

  return {
    debug: (...args: unknown[]) => console.debug(tag, ...args),
    info: (...args: unknown[]) => console.info(tag, ...args),
    warn: (...args: unknown[]) => console.warn(tag, ...args),
    error: (...args: unknown[]) => console.error(tag, ...args),
  };
}
