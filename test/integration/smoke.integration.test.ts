import { describe, it, expect, beforeAll } from 'vitest';
import { Selectwin, AuthenticationError, SelectwinError } from '../../src/index';
import { hasSandboxKey, makeClient, sandboxBaseUrl } from './helpers';

// Whole file is skipped unless a sandbox key is present. The client is built in
// `beforeAll` (not the describe body) so collection never runs makeClient() for
// a skipped suite.
describe.skipIf(!hasSandboxKey)('sandbox · read-only smoke', () => {
  let sw: Selectwin;
  beforeAll(() => {
    sw = makeClient();
  });

  it('authenticates and returns a paginated list envelope', async () => {
    const page = await sw.customers.list({ limit: 2 });
    expect(Array.isArray(page.data)).toBe(true);
    expect(typeof page.hasMore).toBe('boolean');
    expect(page.data.length).toBeLessThanOrEqual(2);
  });

  it('auto-paginates with a hard cap via .toArray(max)', async () => {
    const some = await sw.customers.list({ limit: 1 }).toArray(3);
    expect(Array.isArray(some)).toBe(true);
    expect(some.length).toBeLessThanOrEqual(3);
  });

  it('reaches a second resource (transactions) with the same client', async () => {
    const page = await sw.transactions.list({ limit: 1 });
    expect(Array.isArray(page.data)).toBe(true);
    expect(typeof page.hasMore).toBe('boolean');
  });
});

describe.skipIf(!hasSandboxKey)('sandbox · typed errors', () => {
  it('maps an invalid key to AuthenticationError (401)', async () => {
    // A syntactically-plausible but bogus test key — never the configured one.
    const client = new Selectwin('sk_test_this_key_is_not_valid_000', {
      baseUrl: sandboxBaseUrl,
      maxRetries: 0,
    });
    const err = await client.customers.list({ limit: 1 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SelectwinError);
    expect(err).toBeInstanceOf(AuthenticationError);
  });
});
