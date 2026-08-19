import { describe, it, expect } from 'vitest';
import { resolveConfig } from './config';
import type { WebdotsConfig } from './config';

const baseConfig: WebdotsConfig = {
  apiUrl: 'https://api.example.com/api/v1',
  user: { name: 'QA Tester' },
};

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    const resolved = resolveConfig(baseConfig);

    expect(resolved.autoLoad).toBe(true);
    expect(resolved.showResolved).toBe(false);
    expect(resolved.container).toBe(document.body);
    expect(resolved.zIndex).toBe(2147483000);
    expect(resolved.theme).toBe('auto');
    expect(resolved.testIdAttributes).toEqual(['data-testid', 'data-test', 'data-qa', 'data-cy']);
    expect(resolved.requestTimeoutMs).toBe(10000);
    expect(resolved.debug).toBe(false);
    // Default resolver: current location's origin + pathname (query/hash dropped).
    expect(resolved.pageKey).toBe(`${location.origin}${location.pathname}`);
  });

  it('resolves pageKey via a string override', () => {
    const resolved = resolveConfig({ ...baseConfig, pageKey: 'https://example.com/fixed-key' });
    expect(resolved.pageKey).toBe('https://example.com/fixed-key');
  });

  it('resolves pageKey via a function override', () => {
    const resolved = resolveConfig({ ...baseConfig, pageKey: (url) => `${url.origin}/custom` });
    expect(resolved.pageKey).toBe(`${location.origin}/custom`);
  });

  it('fails fast when the resolved pageKey is not a valid absolute URL', () => {
    expect(() => resolveConfig({ ...baseConfig, pageKey: 'not-a-url' })).toThrow(/not a valid absolute URL/);
  });

  it('accepts a supplied AnnotationAPI as the DI escape hatch', () => {
    const stubApi = {
      list: async () => [],
      get: async () => {
        throw new Error('unused');
      },
      create: async () => {
        throw new Error('unused');
      },
      update: async () => {
        throw new Error('unused');
      },
      changeStatus: async () => {
        throw new Error('unused');
      },
      remove: async () => {},
    };
    const resolved = resolveConfig({ ...baseConfig, api: stubApi });
    expect(resolved.api).toBe(stubApi);
  });

  it('preserves explicitly provided values over defaults', () => {
    const container = document.createElement('div');
    const resolved = resolveConfig({
      ...baseConfig,
      autoLoad: false,
      showResolved: true,
      container,
      zIndex: 100,
      theme: 'dark',
      debug: true,
      requestTimeoutMs: 5000,
      testIdAttributes: ['data-qa-id'],
    });

    expect(resolved.autoLoad).toBe(false);
    expect(resolved.showResolved).toBe(true);
    expect(resolved.container).toBe(container);
    expect(resolved.zIndex).toBe(100);
    expect(resolved.theme).toBe('dark');
    expect(resolved.debug).toBe(true);
    expect(resolved.requestTimeoutMs).toBe(5000);
    expect(resolved.testIdAttributes).toEqual(['data-qa-id']);
  });

  it('carries user attribution through', () => {
    const resolved = resolveConfig({
      apiUrl: 'https://api.example.com/api/v1',
      user: { name: 'Ada', email: 'ada@example.com' },
    });

    expect(resolved.user).toEqual({ name: 'Ada', email: 'ada@example.com' });
  });

  it('fails fast when apiUrl is missing', () => {
    expect(() =>
      resolveConfig({ ...baseConfig, apiUrl: undefined as unknown as string }),
    ).toThrow(/apiUrl/);
  });

  it('fails fast when apiUrl is not a parseable URL', () => {
    expect(() => resolveConfig({ ...baseConfig, apiUrl: 'not-a-url' })).toThrow(/valid absolute URL/);
  });

  it('fails fast when user.name is missing', () => {
    expect(() =>
      resolveConfig({ ...baseConfig, user: {} as unknown as WebdotsConfig['user'] }),
    ).toThrow(/user\.name/);
  });

  it('fails fast when user is missing entirely', () => {
    expect(() =>
      resolveConfig({ apiUrl: baseConfig.apiUrl } as unknown as WebdotsConfig),
    ).toThrow(/config\.user/);
  });

  it('fails fast when container is not an HTMLElement', () => {
    expect(() =>
      resolveConfig({ ...baseConfig, container: {} as unknown as HTMLElement }),
    ).toThrow(/container/);
  });

  it('fails fast when theme is invalid', () => {
    expect(() =>
      resolveConfig({ ...baseConfig, theme: 'neon' as unknown as WebdotsConfig['theme'] }),
    ).toThrow(/theme/);
  });

  it('fails fast when requestTimeoutMs is not positive', () => {
    expect(() => resolveConfig({ ...baseConfig, requestTimeoutMs: 0 })).toThrow(/requestTimeoutMs/);
  });

  it('fails fast when testIdAttributes is not an array', () => {
    expect(() =>
      resolveConfig({
        ...baseConfig,
        testIdAttributes: 'data-testid' as unknown as string[],
      }),
    ).toThrow(/testIdAttributes/);
  });
});
