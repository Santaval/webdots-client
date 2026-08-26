import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpAuthAPI } from './HttpAuthAPI';
import { ApiError, AuthError, ExpiredCodeError, NetworkError, TimeoutError } from './errors';

function mockResponse(status: number, body?: unknown): Response {
  const ok = status >= 200 && status < 300;
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok,
    text: async () => text,
  } as unknown as Response;
}

/** A fetch mock that honours the AbortSignal passed to it, like the real thing. */
function abortableFetchMock(respond: () => Response | Promise<Response>) {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      Promise.resolve(respond()).then(resolve, reject);
    });
  });
}

const session = { token: 'tok_123', user: { name: 'Ada', email: 'ada@example.com' } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HttpAuthAPI', () => {
  it('requestMagicLink posts { email } to /auth/magic-link and resolves void on 204', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await expect(api.requestMagicLink('ada@example.com')).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/auth/magic-link');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'ada@example.com' });
  });

  it('verifyMagicLink posts { code } to /auth/magic-link/verify and returns the session on 200', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(200, session));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await expect(api.verifyMagicLink('ABC123')).resolves.toEqual(session);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/auth/magic-link/verify');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ code: 'ABC123' });
  });

  it('strips trailing slashes from apiUrl before joining the path', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1///', requestTimeoutMs: 5000 });
    await api.requestMagicLink('ada@example.com');

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/v1/auth/magic-link');
  });

  // Issue #4 acceptance: the expired-code path.
  it('a 410 maps to ExpiredCodeError (a subclass of ApiError) with fixed copy', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(410, { message: 'code expired' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.verifyMagicLink('STALE');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExpiredCodeError);
    expect(caught).toBeInstanceOf(ApiError); // subclass — branchable anywhere ApiError is
    expect((caught as ExpiredCodeError).status).toBe(410);
    expect((caught as ExpiredCodeError).name).toBe('ExpiredCodeError');
    // Fixed copy, not the server's message — mirroring AuthError's contract.
    expect((caught as ExpiredCodeError).message).not.toContain('code expired');
    expect((caught as ExpiredCodeError).serverMessage).toBeUndefined();
  });

  it('a 401 still maps to AuthError (the x-api-key failure), not ExpiredCodeError', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', apiKey: 'wrong', requestTimeoutMs: 5000 });
    await expect(api.requestMagicLink('ada@example.com')).rejects.toBeInstanceOf(AuthError);
  });

  it('surfaces the server message verbatim for a 4xx other than 401/403/410', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(422, { message: 'Email is required' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await expect(api.requestMagicLink('')).rejects.toMatchObject({ message: 'Email is required' });
  });

  it('uses generic English copy for a 5xx response, ignoring any server body', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(500, { message: 'stack trace' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.verifyMagicLink('ABC123');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).not.toContain('stack trace');
    expect((caught as ApiError).status).toBe(500);
  });

  it('rejects with a NetworkError when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await expect(api.requestMagicLink('ada@example.com')).rejects.toBeInstanceOf(NetworkError);
  });

  it('aborts and rejects with TimeoutError once requestTimeoutMs elapses', async () => {
    const fetchMock = abortableFetchMock(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 10 });
    await expect(api.verifyMagicLink('ABC123')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates a caller-initiated abort as-is, not as a TimeoutError', async () => {
    const fetchMock = abortableFetchMock(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    const controller = new AbortController();
    const promise = api.verifyMagicLink('ABC123', controller.signal);
    controller.abort();

    await expect(promise).rejects.not.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('request hygiene', () => {
    it('sends x-api-key only when apiKey is configured', async () => {
      const fetchMock = abortableFetchMock(() => mockResponse(204));
      vi.stubGlobal('fetch', fetchMock);

      const withKey = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', apiKey: 'secret', requestTimeoutMs: 5000 });
      await withKey.requestMagicLink('ada@example.com');
      const headersWithKey = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headersWithKey['x-api-key']).toBe('secret');

      fetchMock.mockClear();
      const withoutKey = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
      await withoutKey.requestMagicLink('ada@example.com');
      const headersWithoutKey = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headersWithoutKey['x-api-key']).toBeUndefined();
    });

    it('sends Content-Type on the bodied POSTs', async () => {
      const fetchMock = abortableFetchMock(() => mockResponse(204));
      vi.stubGlobal('fetch', fetchMock);

      const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
      await api.requestMagicLink('ada@example.com');
      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('detaches composed-signal listeners from the caller after each request', async () => {
      const nativeAny = AbortSignal.any;
      // @ts-expect-error deliberately removing the native helper to force the fallback path
      AbortSignal.any = undefined;
      try {
        const api = new HttpAuthAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
        const controller = new AbortController();
        const addSpy = vi.spyOn(controller.signal, 'addEventListener');
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

        vi.stubGlobal('fetch', vi.fn(async () => mockResponse(204)));

        for (let i = 0; i < 5; i += 1) {
          await api.requestMagicLink('ada@example.com', controller.signal);
        }

        expect(addSpy).toHaveBeenCalledTimes(5);
        expect(removeSpy).toHaveBeenCalledTimes(5); // no net accumulation
      } finally {
        AbortSignal.any = nativeAny;
      }
    });
  });
});
