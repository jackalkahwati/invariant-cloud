/**
 * Unit tests for the Invariant TypeScript SDK.
 *
 * Tests the request engine (_fetch / _request), retry logic,
 * error handling, header construction, and resource client method routing.
 * All HTTP calls are intercepted via vi.stubGlobal('fetch', ...).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoherenceEngineSDK, InvariantError } from '../src/index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    statusText: 'OK',
    body: null,
  } as unknown as Response;
}

function makeErrorResponse(status: number, body: unknown, requestId?: string) {
  return {
    ok: false,
    status,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'x-request-id') return requestId ?? null;
        return null;
      },
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    statusText: 'Error',
    body: null,
  } as unknown as Response;
}

function makeClient(overrides: Partial<ConstructorParameters<typeof CoherenceEngineSDK>[0]> = {}) {
  return new CoherenceEngineSDK({
    baseUrl: 'https://api.example.com',
    apiKey: 'test-api-key',
    retries: 2,
    retryBaseDelayMs: 1, // near-zero so tests don't slow down
    ...overrides,
  });
}

// ── InvariantError ────────────────────────────────────────────────────────────

describe('InvariantError', () => {
  it('stores status, body, and requestId', () => {
    const err = new InvariantError(404, 'Not found', { error: 'missing' }, 'req-123');
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'missing' });
    expect(err.requestId).toBe('req-123');
    expect(err.name).toBe('InvariantError');
    expect(err.message).toBe('Not found');
  });

  it('defaults requestId to null', () => {
    const err = new InvariantError(500, 'oops', null);
    expect(err.requestId).toBeNull();
  });
});

// ── CoherenceEngineSDK construction ──────────────────────────────────────────

describe('CoherenceEngineSDK construction', () => {
  it('strips trailing slash from baseUrl', () => {
    const sdk = makeClient({ baseUrl: 'https://api.example.com/' });
    // @ts-expect-error accessing protected for test
    expect(sdk.baseUrl).toBe('https://api.example.com');
  });

  it('sets X-API-Key header', () => {
    const sdk = makeClient({ apiKey: 'inv_abc' });
    // @ts-expect-error accessing protected for test
    expect(sdk.headers['X-API-Key']).toBe('inv_abc');
  });

  it('exposes all resource namespaces', () => {
    const sdk = makeClient();
    expect(sdk.entities).toBeDefined();
    expect(sdk.claims).toBeDefined();
    expect(sdk.observations).toBeDefined();
    expect(sdk.contradictions).toBeDefined();
    expect(sdk.branches).toBeDefined();
    expect(sdk.constraints).toBeDefined();
    expect(sdk.dependencies).toBeDefined();
    expect(sdk.actions).toBeDefined();
    expect(sdk.world).toBeDefined();
    expect(sdk.policy).toBeDefined();
    expect(sdk.trace).toBeDefined();
    expect(sdk.plans).toBeDefined();
    expect(sdk.workspace).toBeDefined();
    expect(sdk.auth).toBeDefined();
  });
});

// ── _fetch: basic request mechanics ──────────────────────────────────────────

describe('_fetch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the correct URL and method', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ id: '1' }));
    const sdk = makeClient();
    // @ts-expect-error testing internal
    await sdk._fetch('GET', '/entities');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/entities');
    expect(init.method).toBe('GET');
  });

  it('sends X-API-Key header', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({}));
    const sdk = makeClient({ apiKey: 'inv_mykey' });
    // @ts-expect-error testing internal
    await sdk._fetch('GET', '/entities');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('inv_mykey');
  });

  it('serializes body as JSON for POST', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ id: '1' }, 201));
    const sdk = makeClient();
    // @ts-expect-error testing internal
    await sdk._fetch('POST', '/entities', { name: 'Test', type: 'AGENT' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ name: 'Test', type: 'AGENT' }));
  });

  it('returns undefined for 204 No Content', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse(null, 204));
    const sdk = makeClient();
    // @ts-expect-error testing internal
    const result = await sdk._fetch('DELETE', '/entities/1');
    expect(result).toBeUndefined();
  });

  it('throws InvariantError with status and requestId on 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeErrorResponse(404, { error: 'Entity not found' }, 'req-xyz'),
    );
    const sdk = makeClient();
    // @ts-expect-error testing internal
    await expect(sdk._fetch('GET', '/entities/missing')).rejects.toMatchObject({
      status: 404,
      requestId: 'req-xyz',
    });
  });

  it('throws InvariantError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(makeErrorResponse(401, { error: 'Unauthorized' }));
    const sdk = makeClient();
    // @ts-expect-error testing internal
    await expect(sdk._fetch('GET', '/entities')).rejects.toBeInstanceOf(InvariantError);
  });

  it('throws InvariantError on 500', async () => {
    fetchSpy.mockResolvedValueOnce(makeErrorResponse(500, { error: 'Internal Server Error' }));
    const sdk = makeClient();
    // @ts-expect-error testing internal
    await expect(sdk._fetch('GET', '/entities')).rejects.toMatchObject({ status: 500 });
  });
});

// ── _request: retry logic ─────────────────────────────────────────────────────

describe('_request retry logic', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries GET on 5xx up to the configured limit', async () => {
    // First 2 calls fail with 500, third succeeds
    fetchSpy
      .mockResolvedValueOnce(makeErrorResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(makeErrorResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(makeOkResponse([{ id: '1' }]));

    const sdk = makeClient({ retries: 2, retryBaseDelayMs: 1 });
    // @ts-expect-error testing internal
    const result = await sdk._request<unknown[]>('GET', '/entities');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual([{ id: '1' }]);
  });

  it('does NOT retry GET on 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(makeErrorResponse(404, { error: 'not found' }));
    const sdk = makeClient({ retries: 3, retryBaseDelayMs: 1 });
    // @ts-expect-error testing internal
    await expect(sdk._request('GET', '/entities/x')).rejects.toMatchObject({ status: 404 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry POST requests on 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(makeErrorResponse(503, { error: 'unavailable' }));
    const sdk = makeClient({ retries: 3, retryBaseDelayMs: 1 });
    // @ts-expect-error testing internal
    await expect(sdk._request('POST', '/entities', { name: 'x' })).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws the last error', async () => {
    fetchSpy.mockResolvedValue(makeErrorResponse(500, { error: 'always fails' }));
    const sdk = makeClient({ retries: 2, retryBaseDelayMs: 1 });
    // @ts-expect-error testing internal
    await expect(sdk._request('GET', '/entities')).rejects.toMatchObject({ status: 500 });
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('succeeds immediately when first call succeeds', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ id: '1' }));
    const sdk = makeClient({ retries: 3, retryBaseDelayMs: 1 });
    // @ts-expect-error testing internal
    await sdk._request('GET', '/entities/1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Resource method routing ───────────────────────────────────────────────────

describe('Resource method routing', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let sdk: CoherenceEngineSDK;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(makeOkResponse({}));
    vi.stubGlobal('fetch', fetchSpy);
    sdk = makeClient({ retries: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('entities.list() calls GET /entities', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse([]));
    await sdk.entities.list();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/entities');
    expect(init.method).toBe('GET');
  });

  it('entities.fetch() calls GET /entities/:id', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ id: 'e1' }));
    await sdk.entities.fetch('e1');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/entities/e1');
  });

  it('entities.create() calls POST /entities', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ id: 'e1' }, 201));
    await sdk.entities.create({ name: 'Alpha', type: 'AGENT' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/entities');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('"name":"Alpha"');
  });

  it('world.getCoherence() calls GET /world/coherence', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ coherenceScore: 95, phi: 0.05 }));
    await sdk.world.getCoherence();
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/world/coherence');
  });

  it('actions.validate() calls POST /actions/validate', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ proposal: {}, validation: {} }));
    await sdk.actions.validate({ operation: 'update', impactedEntityIds: ['e1'] });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/actions/validate');
    expect(init.method).toBe('POST');
  });

  it('claims.create() sends correct body', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ id: 'c1' }, 201));
    await sdk.claims.create({
      entityId: 'e1',
      predicate: 'status',
      value: 'active',
      sourceName: 'test-agent',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/claims');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.entityId).toBe('e1');
    expect(body.predicate).toBe('status');
  });

  it('observations.create() calls POST /observations', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse({ observation: {}, claimsCreated: [] }));
    await sdk.observations.create({
      type: 'sensor_reading',
      content: { value: 42 },
      entityIds: ['e1'],
      sourceName: 'sensor',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/observations');
    expect(init.method).toBe('POST');
  });

  it('contradictions.list() calls GET /contradictions', async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse([]));
    await sdk.contradictions.list();
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/contradictions');
  });
});

// ── Timeout ───────────────────────────────────────────────────────────────────

describe('Request timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('aborts the request when timeout elapses', async () => {
    let aborted = false;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init.signal as AbortSignal;
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    vi.useFakeTimers();
    const sdk = makeClient({ timeout: 100, retries: 0 });

    // @ts-expect-error testing internal
    const promise = sdk._fetch('GET', '/entities');
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});
