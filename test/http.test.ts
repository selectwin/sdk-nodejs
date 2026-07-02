import { describe, it, expect, vi } from 'vitest';
import { buildMiddleware, createFetchApi } from '../src/http';
import { ApiConnectionError, CardError, ApiError } from '../src/errors';

// Minimal fake context factory for middleware tests.
function reqCtx(method: string, headers: Record<string, string> = {}) {
  return { fetch: fetch as never, url: 'https://api.test/v1/x', init: { method, headers } } as never;
}
function resCtx(response: Response) {
  return { fetch: fetch as never, url: 'https://api.test/v1/x', init: {}, response } as never;
}

describe('middleware.pre', () => {
  const mw = buildMiddleware('selectwin-node/test');

  it('adds User-Agent + idempotency key on POST', async () => {
    const out = (await mw.pre!(reqCtx('POST'))) as { init: { headers: HeadersInit } };
    const h = new Headers(out.init.headers);
    expect(h.get('user-agent')).toBe('selectwin-node/test');
    expect(h.get('x-idempotency-key')).toBeTruthy();
  });

  it('does NOT add an idempotency key on GET', async () => {
    const out = (await mw.pre!(reqCtx('GET'))) as { init: { headers: HeadersInit } };
    expect(new Headers(out.init.headers).get('x-idempotency-key')).toBeNull();
  });

  it('does not overwrite an existing idempotency key', async () => {
    const out = (await mw.pre!(reqCtx('POST', { 'X-Idempotency-Key': 'fixed' }))) as {
      init: { headers: HeadersInit };
    };
    expect(new Headers(out.init.headers).get('x-idempotency-key')).toBe('fixed');
  });
});

describe('middleware.post', () => {
  const mw = buildMiddleware('ua');

  it('throws a typed error on a non-2xx response', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'card_declined', displayMessage: 'x', reversible: true } }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
    await expect(mw.post!(resCtx(res))).rejects.toBeInstanceOf(CardError);
  });

  it('sets retryAfter on 429 from the header', async () => {
    const res = new Response('{}', { status: 429, headers: { 'retry-after': '7' } });
    await expect(mw.post!(resCtx(res))).rejects.toMatchObject({ retryAfter: 7 });
  });

  it('returns undefined (passes through) on 2xx', async () => {
    const res = new Response('{}', { status: 200 });
    await expect(mw.post!(resCtx(res))).resolves.toBeUndefined();
  });
});

describe('middleware.onError', () => {
  const mw = buildMiddleware('ua');

  it('wraps a network error as ApiConnectionError', async () => {
    await expect(
      mw.onError!({ fetch: fetch as never, url: 'u', init: {}, error: new Error('boom') } as never),
    ).rejects.toBeInstanceOf(ApiConnectionError);
  });
});

describe('createFetchApi', () => {
  it('retries on 500 then returns the success response', async () => {
    vi.useFakeTimers();
    let n = 0;
    const impl = vi.fn(async () => new Response('{}', { status: ++n < 3 ? 500 : 200 }));
    const f = createFetchApi({ maxRetries: 3, fetchImpl: impl as never });
    const p = f('https://api.test/v1/x', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await p;
    expect(res.status).toBe(200);
    expect(impl).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('throws ApiConnectionError after exhausting retries on network failure', async () => {
    vi.useFakeTimers();
    const impl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const f = createFetchApi({ maxRetries: 1, fetchImpl: impl as never });
    const captured = f('https://api.test/v1/x', {}).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await captured;
    expect(err).toBeInstanceOf(ApiConnectionError);
    expect(impl).toHaveBeenCalledTimes(2); // initial + 1 retry
    vi.useRealTimers();
  });

  it('does not retry a non-retryable status (e.g. 400)', async () => {
    const impl = vi.fn(async () => new Response('{}', { status: 400 }));
    const f = createFetchApi({ maxRetries: 3, fetchImpl: impl as never });
    const res = await f('https://api.test/v1/x', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
