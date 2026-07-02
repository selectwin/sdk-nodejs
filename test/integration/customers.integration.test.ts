import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Selectwin, NotFoundError } from '../../src/index';
import { hasSandboxKey, makeClient, uniqueEmail, TEST_METADATA } from './helpers';

// Sandbox writes are safe (no real financial impact). Whole file gated on the key.
// The client is built in `beforeAll` so collection never runs makeClient() for a
// skipped suite.
describe.skipIf(!hasSandboxKey)('sandbox · customers write round-trip', () => {
  let sw: Selectwin;
  const created: string[] = [];

  beforeAll(() => {
    sw = makeClient();
  });

  afterAll(async () => {
    // Best-effort cleanup of everything this file created.
    for (const id of created) {
      try {
        await sw.customers.delete(id);
      } catch {
        /* already gone / not deletable — ignore */
      }
    }
  });

  it('creates, retrieves and deletes a customer', async () => {
    const email = uniqueEmail();
    const customer = await sw.customers.create({
      firstName: 'SDK',
      lastName: 'Integration',
      email,
      metadata: { ...TEST_METADATA },
    });
    expect(customer.id).toBeTruthy();
    expect(customer.email).toBe(email);
    created.push(customer.id);

    const fetched = await sw.customers.retrieve(customer.id);
    expect(fetched.id).toBe(customer.id);
    expect(fetched.email).toBe(email);

    await sw.customers.delete(customer.id);
    created.splice(created.indexOf(customer.id), 1);

    // A deleted customer must no longer be retrievable.
    await expect(sw.customers.retrieve(customer.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is idempotent when the same X-Idempotency-Key is reused', async () => {
    const email = uniqueEmail();
    const key = `it-${email}`;
    const body = {
      firstName: 'SDK',
      lastName: 'Idempotent',
      email,
      metadata: { ...TEST_METADATA },
    };
    const init = { headers: { 'X-Idempotency-Key': key } };

    const first = await sw.customers.create(body, init);
    created.push(first.id);
    const replay = await sw.customers.create(body, init);

    // Replaying the key returns the original resource — no duplicate.
    expect(replay.id).toBe(first.id);
  });
});
