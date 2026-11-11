import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { Selectwin, CardError, SDK_VERSION, ValidationError } from '../src';

describe('SDK_VERSION', () => {
  it('matches package.json (single source of truth — guards against drift)', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(SDK_VERSION).toBe(version);
  });
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Selectwin client (integration via injected fetch)', () => {
  it('requires an API key', () => {
    expect(() => new Selectwin('')).toThrow();
  });

  it('sends the SelectKey header, an idempotency key and a JSON body on create', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(201, { id: 'tra_1', amount: 9990 });
    });
    const sw = new Selectwin('sk_test_abc', { fetch: fetchImpl as never, maxRetries: 0, timeoutMs: 0 });

    // We assert the REQUEST the DX shell builds. Deserializing the success body is
    // the generated model's job (and it requires a full object), so swallow it.
    await sw.transactions
      .create({ amount: 9990, payment: { method: 'pix', currency: 'BRL' } } as never)
      .catch(() => undefined);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = calls[0];
    expect(url).toContain('/v1/transactions');
    expect(init.method).toBe('POST');
    const h = new Headers(init.headers);
    expect(h.get('selectkey')).toBe('sk_test_abc');
    expect(h.get('x-idempotency-key')).toBeTruthy();
    expect(JSON.parse(String(init.body)).amount).toBe(9990);
  });

  it('throws a typed CardError on a 402', async () => {
    const fetchImpl = async () =>
      jsonResponse(402, { error: { code: 'card_declined', displayMessage: 'Recusado', reversible: false } });
    const sw = new Selectwin('sk_test_abc', { fetch: fetchImpl as never, maxRetries: 0, timeoutMs: 0 });

    const err = await sw.transactions.retrieve('tra_x').catch((e) => e);
    expect(err).toBeInstanceOf(CardError);
    expect(err.displayMessage).toBe('Recusado');
    expect(err.reversible).toBe(false);
  });

  it('refuses a "." or ".." path parameter before sending (security sweep 31, S-1)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(204, {}));
    const sw = new Selectwin('sk_test_abc', { fetch: fetchImpl as never, maxRetries: 0, timeoutMs: 0 });
    // Without the guard, '..' leaves as DELETE /v1/products/prd_1 — the whole product, not the variant.
    for (const id of ['..', '.']) {
      await expect(sw.variants.delete({ productId: 'prd_1', variantId: id })).rejects.toBeInstanceOf(ValidationError);
      await expect(sw.customers.retrieve(id)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never follows a redirect (the selectkey header would go along)', async () => {
    const inits: RequestInit[] = [];
    const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
      inits.push(init ?? {});
      return jsonResponse(200, { id: 'cus_1' });
    };
    const sw = new Selectwin('sk_test_abc', { fetch: fetchImpl as never, maxRetries: 0, timeoutMs: 0 });
    await sw.customers.retrieve('cus_1').catch(() => undefined);
    expect(inits[0]?.redirect).toBe('error');
  });

  it('reuses one idempotency key across retries', async () => {
    vi.useFakeTimers();
    const keys: (string | null)[] = [];
    let n = 0;
    const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('x-idempotency-key'));
      return jsonResponse(++n < 2 ? 500 : 201, { id: 'tra_1' });
    };
    const sw = new Selectwin('sk_test_abc', { fetch: fetchImpl as never, maxRetries: 2, timeoutMs: 0 });

    const p = sw.transactions.create({ amount: 100 } as never).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;

    expect(keys.length).toBe(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
    vi.useRealTimers();
  });
});
