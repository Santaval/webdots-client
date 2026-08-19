import { describe, it, expect } from 'vitest';
import { resolvePageKey, assertValidPageKey } from './pageKey';

describe('resolvePageKey', () => {
  it('defaults to origin + pathname, dropping query and hash', () => {
    const url = new URL('https://example.com/app/checkout?tab=2&x=1#section');
    expect(resolvePageKey(url)).toBe('https://example.com/app/checkout');
  });

  it('uses a fixed string override verbatim when pageKey is a string', () => {
    const url = new URL('https://example.com/app/checkout?tab=2');
    expect(resolvePageKey(url, 'my-fixed-key')).toBe('my-fixed-key');
  });

  it('calls a function override with the URL and uses its return value', () => {
    const url = new URL('https://example.com/app/checkout?tab=2');
    const resolver = (u: URL) => `${u.origin}${u.pathname}${u.searchParams.get('tab') ? `#tab-${u.searchParams.get('tab')}` : ''}`;
    expect(resolvePageKey(url, resolver)).toBe('https://example.com/app/checkout#tab-2');
  });

  it('preserves a non-root pathname exactly', () => {
    const url = new URL('https://example.com:8080/deeply/nested/route');
    expect(resolvePageKey(url)).toBe('https://example.com:8080/deeply/nested/route');
  });
});

describe('assertValidPageKey', () => {
  it('does not throw for a valid absolute URL', () => {
    expect(() => assertValidPageKey('https://example.com/app/checkout')).not.toThrow();
  });

  it('throws a clear error for a bare route name (not a parseable URL)', () => {
    expect(() => assertValidPageKey('checkout')).toThrow(/not a valid absolute URL/);
  });

  it('throws for an empty string', () => {
    expect(() => assertValidPageKey('')).toThrow(/not a valid absolute URL/);
  });
});
