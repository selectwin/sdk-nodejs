import { describe, it, expect, vi } from 'vitest';
import { Selectwin, CardError } from '../src';

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
