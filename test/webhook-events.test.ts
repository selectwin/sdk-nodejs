import { describe, it, expect, expectTypeOf } from 'vitest';
import { createHmac } from 'node:crypto';
import { constructEvent, type SelectwinEvent } from '../src/webhooks';
import {
  WEBHOOK_EVENT_TYPES,
  isWebhookEventType,
  type WebhookEventType,
  type SelectwinEventUnion,
} from '../src/webhook-events';
import type {
  GetTransaction200Response,
  CreateCheckoutSession201Response,
} from '../src/generated/models';

const secret = 'whsec_test_123';
const sign = (body: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('WEBHOOK_EVENT_TYPES (the authoritative catalog)', () => {
  it('exposes the full catalog with no duplicates', () => {
    // Tracks the spec's CreateWebhookEndpointRequestEventsEnum (regen on sync:core).
    expect(WEBHOOK_EVENT_TYPES.length).toBe(69);
    expect(new Set(WEBHOOK_EVENT_TYPES).size).toBe(WEBHOOK_EVENT_TYPES.length);
    expect(WEBHOOK_EVENT_TYPES).toContain('transaction.approved');
    expect(WEBHOOK_EVENT_TYPES).toContain('subscription.paused');
    expect(WEBHOOK_EVENT_TYPES).toContain('checkout.session.completed');
    expect(WEBHOOK_EVENT_TYPES).toContain('webhook.ping');
  });

  it('isWebhookEventType is a runtime guard over the catalog', () => {
    expect(isWebhookEventType('transaction.approved')).toBe(true);
    expect(isWebhookEventType('customer.address.deleted')).toBe(true);
    expect(isWebhookEventType('nope.nope')).toBe(false);
    expect(isWebhookEventType(123)).toBe(false);
    expect(isWebhookEventType(undefined)).toBe(false);
  });
});

describe('constructEvent typed union', () => {
  it('returns a discriminated union that narrows payload.object on `type`', () => {
    const body = JSON.stringify({
      id: 'wbh_1',
      type: 'transaction.approved',
      payload: { object: { id: 'tra_1', amount: 9990 } },
    });
    const ev = constructEvent(body, sign(body), secret);

    // Default return is the discriminated union.
    expectTypeOf(ev).toEqualTypeOf<SelectwinEventUnion>();
    expectTypeOf(ev.type).toEqualTypeOf<WebhookEventType>();

    if (ev.type === 'transaction.approved') {
      // Narrowed to the transaction read shape.
      expectTypeOf(ev.payload.object).toEqualTypeOf<GetTransaction200Response>();
      const obj: GetTransaction200Response = ev.payload.object; // compile-time narrowing check
      expect((obj as { id: string }).id).toBe('tra_1');
    } else {
      throw new Error('type guard did not narrow');
    }
  });

  it('narrows a different resource group', () => {
    const body = JSON.stringify({
      id: 'wbh_2',
      type: 'checkout.session.completed',
      payload: { object: { id: 'chk_1' } },
    });
    const ev = constructEvent(body, sign(body), secret);
    if (ev.type === 'checkout.session.completed') {
      expectTypeOf(ev.payload.object).toEqualTypeOf<CreateCheckoutSession201Response>();
    }
    expect(ev.id).toBe('wbh_2');
  });

  it('the generic overload still lets callers assert the object shape', () => {
    const body = JSON.stringify({
      id: 'wbh_3',
      type: 'transaction.approved',
      payload: { object: { amount: 500 } },
    });
    const ev = constructEvent<{ amount: number }>(body, sign(body), secret);
    expectTypeOf(ev).toEqualTypeOf<SelectwinEvent<{ amount: number }>>();
    expectTypeOf(ev.payload.object).toEqualTypeOf<{ amount: number }>();
    expect(ev.payload.object.amount).toBe(500);
  });
});
