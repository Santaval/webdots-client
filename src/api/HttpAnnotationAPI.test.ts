import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpAnnotationAPI } from './HttpAnnotationAPI';
import { ApiError, AuthError, NetworkError, TimeoutError } from './errors';
import type { CreateAnnotationInput } from './AnnotationAPI';
import type { AnchorDescriptor } from '../anchor/types';

const anchor: AnchorDescriptor = {
  v: 1,
  strategy: 'testid',
  selector: '[data-testid="x"]',
  path: '[data-testid="x"]',
  ratio: { x: 0.5, y: 0.5 },
  viewportW: 1024,
  tag: 'BUTTON',
};

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

const wireAnnotation = {
  id: 'srv_1',
  pageUrl: 'https://example.com/page',
  selector: 'button',
  x: 1,
  y: 2,
  title: 'Broken button',
  status: 'OPEN',
  priority: 'MEDIUM',
  authorName: 'QA',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HttpAnnotationAPI', () => {
  it('sends x-api-key only when apiKey is configured', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
    vi.stubGlobal('fetch', fetchMock);

    const withKey = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', apiKey: 'secret', requestTimeoutMs: 5000 });
    await withKey.list({});
    const headersWithKey = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headersWithKey['x-api-key']).toBe('secret');
    // list() is a bodiless GET, so Content-Type is deliberately omitted —
    // setting it would force an avoidable CORS preflight. See the dedicated
    // 'request hygiene' cases below.
    expect(headersWithKey['Content-Type']).toBeUndefined();

    fetchMock.mockClear();
    const withoutKey = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await withoutKey.list({});
    const headersWithoutKey = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headersWithoutKey['x-api-key']).toBeUndefined();
  });

  it('composes query params for list() and hits the bare-array endpoint', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    const result = await api.list({ pageUrl: 'https://example.com/page', status: 'OPEN', limit: 10 });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/annotations?');
    expect(url).toContain('pageUrl=');
    expect(url).toContain('status=OPEN');
    expect(url).toContain('limit=10');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('srv_1');
  });

  it('falls back to a coords anchor when the wire row has none (live backend behavior today)', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    const [result] = await api.list({});

    expect(result!.anchor?.strategy).toBe('coords');
  });

  it('create() posts to /annotations and returns 201-mapped annotation', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(201, { ...wireAnnotation, id: 'srv_new' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    const input: CreateAnnotationInput = {
      pageUrl: 'https://example.com/page',
      selector: 'button',
      x: 1,
      y: 2,
      anchor,
      title: 'Title',
      authorName: 'QA',
    };
    const result = await api.create(input);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/annotations');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string).anchor).toEqual(anchor);
    expect(result.id).toBe('srv_new');
  });

  it('changeStatus() hits the separate /:id/status endpoint with exactly { status }', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(200, { ...wireAnnotation, status: 'RESOLVED' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await api.changeStatus('srv_1', 'RESOLVED');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/annotations/srv_1/status');
    expect(init!.method).toBe('PATCH');
    expect(JSON.parse(init!.body as string)).toEqual({ status: 'RESOLVED' });
  });

  it('remove() handles 204 No Content without attempting to parse a JSON body', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await expect(api.remove('srv_1')).resolves.toBeUndefined();
  });

  it('surfaces the server message verbatim for a 4xx response', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(400, { message: 'El título es requerido' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.list({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(400);
    expect((caught as ApiError).message).toBe('El título es requerido');
    expect((caught as ApiError).serverMessage).toBe('El título es requerido');
  });

  it('rejects with AuthError (a subclass of ApiError) on a 401, with fixed auth copy', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', apiKey: 'wrong', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.list({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    // Subclass relationship: still usable anywhere an ApiError is expected.
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as AuthError).status).toBe(401);
    expect((caught as AuthError).name).toBe('AuthError');
    // Fixed copy — not the generic "Request to … failed with status 401."
    // a bodyless 401 would otherwise produce.
    expect((caught as AuthError).message).toBe('Authentication failed — your API key is missing or invalid.');
  });

  it('rejects with AuthError on a 403 as well', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(403));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', apiKey: 'revoked', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.create({
        pageUrl: 'https://example.com/page',
        selector: 'button',
        x: 1,
        y: 2,
        anchor,
        title: 'Title',
        authorName: 'QA',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(403);
  });

  it('ignores the server body for 401/403 — auth copy is always the fixed message, not the server message', async () => {
    // The server may return its own {message} on an auth failure; the client
    // must surface the recognizable auth hint regardless, per errors.ts's
    // module doc (401/403 are the exception to the verbatim-4xx rule).
    const fetchMock = abortableFetchMock(() => mockResponse(401, { message: 'Invalid API key "wrong"' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', apiKey: 'wrong', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.list({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).message).toBe('Authentication failed — your API key is missing or invalid.');
    // The server's message must not leak through for auth failures.
    expect((caught as AuthError).message).not.toContain('Invalid API key');
    expect((caught as AuthError).serverMessage).toBeUndefined();
  });

  it('uses generic English copy for a 5xx response, ignoring any server body', async () => {
    const fetchMock = abortableFetchMock(() => mockResponse(500, { message: 'stack trace leaked here' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    let caught: unknown;
    try {
      await api.list({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).not.toContain('stack trace leaked here');
    expect((caught as ApiError).status).toBe(500);
  });

  it('rejects with a NetworkError when fetch itself throws (not an AbortError)', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    await expect(api.list({})).rejects.toBeInstanceOf(NetworkError);
  });

  it('aborts and rejects with TimeoutError once requestTimeoutMs elapses', async () => {
    // Never resolves on its own — only settles via the abort listener,
    // exactly like a real hung connection.
    const fetchMock = abortableFetchMock(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 10 });
    await expect(api.list({})).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates a caller-initiated abort as-is, not as a TimeoutError', async () => {
    const fetchMock = abortableFetchMock(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
    const controller = new AbortController();
    const promise = api.list({}, controller.signal);
    controller.abort();

    await expect(promise).rejects.not.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('request hygiene', () => {
    /**
     * Regression: the AbortSignal.any fallback attaches listeners to the
     * caller's signal, which Widget keeps alive for the whole session. Without
     * an explicit dispose they accumulate one per request forever.
     */
    it('detaches composed-signal listeners from the caller after each request', async () => {
      const nativeAny = AbortSignal.any;
      // Force the manual-listener fallback path.
      // @ts-expect-error deliberately removing the native helper for this test
      AbortSignal.any = undefined;
      try {
        const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/api/v1', requestTimeoutMs: 5000 });
        const controller = new AbortController();
        const addSpy = vi.spyOn(controller.signal, 'addEventListener');
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

        vi.stubGlobal(
          'fetch',
          vi.fn(async (_url: string, _init?: RequestInit) => {
            void _url;
            void _init;
            return mockResponse(200, []);
          }),
        );

        for (let i = 0; i < 5; i += 1) {
          await api.list({}, controller.signal);
        }

        expect(addSpy).toHaveBeenCalledTimes(5);
        // Every listener added must also be removed — no net accumulation.
        expect(removeSpy).toHaveBeenCalledTimes(5);
      } finally {
        AbortSignal.any = nativeAny;
      }
    });

    /**
     * Regression: sending Content-Type on a bodiless GET/DELETE upgrades an
     * otherwise-simple CORS request into a preflighted one for no benefit.
     */
    it('omits Content-Type on bodiless requests and sends it on bodied ones', async () => {
      const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/api/v1', requestTimeoutMs: 5000 });
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
        void _url;
        void _init;
        return mockResponse(200, []);
      });
      vi.stubGlobal('fetch', fetchMock);

      await api.list({});
      const listHeaders = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(listHeaders['Content-Type']).toBeUndefined();

      fetchMock.mockImplementation(async () => mockResponse(204));
      await api.remove('abc');
      const deleteHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
      expect(deleteHeaders['Content-Type']).toBeUndefined();

      fetchMock.mockImplementation(async () =>
        mockResponse(201, {
          id: '1',
          pageUrl: 'https://a.test/p',
          selector: 'body',
          x: 1,
          y: 2,
          title: 't',
          status: 'OPEN',
          priority: 'MEDIUM',
          authorName: 'QA',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      );
      const input: CreateAnnotationInput = {
        pageUrl: 'https://a.test/p',
        selector: 'body',
        x: 1,
        y: 2,
        anchor,
        title: 't',
        authorName: 'QA',
      };
      await api.create(input);
      const createHeaders = (fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<string, string>;
      expect(createHeaders['Content-Type']).toBe('application/json');
    });
  });

  describe('JWT session — Bearer header (#5)', () => {
    /**
     * The token is established at runtime (after sign-in), so the API is
     * constructed BEFORE a token exists and reads the live value per request
     * via a getter. A bare `Bearer undefined` would be worse than no header,
     * so it must be sent ONLY when the getter returns a value.
     */
    it('attaches Authorization: Bearer when getToken returns a token', async () => {
      const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
      vi.stubGlobal('fetch', fetchMock);

      const api = new HttpAnnotationAPI({
        apiUrl: 'https://api.test/v1',
        requestTimeoutMs: 5000,
        getToken: () => 'tok_123',
      });
      await api.list({});

      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok_123');
    });

    it('omits Authorization when getToken returns undefined (pre-session request)', async () => {
      const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
      vi.stubGlobal('fetch', fetchMock);

      const api = new HttpAnnotationAPI({
        apiUrl: 'https://api.test/v1',
        requestTimeoutMs: 5000,
        getToken: () => undefined,
      });
      await api.list({});

      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('omits Authorization entirely when no getToken is configured', async () => {
      const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
      vi.stubGlobal('fetch', fetchMock);

      const api = new HttpAnnotationAPI({ apiUrl: 'https://api.test/v1', requestTimeoutMs: 5000 });
      await api.list({});

      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    /**
     * Regression: the token is read fresh per request so a session established
     * AFTER construction (sign-in completing mid-session) is picked up without
     * rebuilding the API. A snapshot-at-construction would never see it.
     */
    it('reads the token fresh on each request (post-construction sign-in is picked up)', async () => {
      let currentToken: string | undefined;
      const fetchMock = abortableFetchMock(() => mockResponse(200, [wireAnnotation]));
      vi.stubGlobal('fetch', fetchMock);

      const api = new HttpAnnotationAPI({
        apiUrl: 'https://api.test/v1',
        requestTimeoutMs: 5000,
        getToken: () => currentToken,
      });

      // Pre-session: no Authorization.
      await api.list({});
      let headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();

      // Sign-in completes between requests — same API instance, now authed.
      currentToken = 'tok_late';
      await api.list({});
      headers = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok_late');

      // Session cleared again — header drops, never a stale `Bearer`.
      currentToken = undefined;
      await api.list({});
      headers = fetchMock.mock.calls[2]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('attaches Bearer on bodied requests too (create), alongside x-api-key', async () => {
      const fetchMock = abortableFetchMock(() =>
        mockResponse(201, { ...wireAnnotation, id: 'srv_new' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const api = new HttpAnnotationAPI({
        apiUrl: 'https://api.test/v1',
        apiKey: 'secret',
        requestTimeoutMs: 5000,
        getToken: () => 'tok_123',
      });
      const input: CreateAnnotationInput = {
        pageUrl: 'https://example.com/page',
        selector: 'button',
        x: 1,
        y: 2,
        anchor,
        title: 'Title',
        authorName: 'QA',
      };
      await api.create(input);

      const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok_123');
      expect(headers['x-api-key']).toBe('secret');
    });
  });
});
