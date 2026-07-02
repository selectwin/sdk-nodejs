import { describe, it, expect } from 'vitest';
import {
  errorFromResponse,
  SelectwinError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ConflictError,
  ApiError,
  ValidationError,
  CardError,
  RateLimitError,
} from '../src/errors';

describe('errorFromResponse', () => {
  it('402 → CardError with displayMessage/reversible', () => {
    const e = errorFromResponse(402, {
      error: { code: 'card_declined', message: 'Declined', displayMessage: 'Cartão recusado', reversible: false },
    });
    expect(e).toBeInstanceOf(CardError);
    expect(e).toBeInstanceOf(SelectwinError);
    expect((e as CardError).displayMessage).toBe('Cartão recusado');
    expect((e as CardError).reversible).toBe(false);
    expect(e.code).toBe('card_declined');
    expect(e.statusCode).toBe(402);
    expect(e.message).toBe('Declined');
  });

  it('400 and 422 → ValidationError with params', () => {
    for (const status of [400, 422]) {
      const e = errorFromResponse(status, { error: { code: 'invalid', params: [{ field: 'amount', message: 'too low' }] } });
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).params?.[0]?.field).toBe('amount');
    }
  });

  it('429 → RateLimitError carrying retryAfter', () => {
    const e = errorFromResponse(429, undefined, { retryAfter: 5 });
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfter).toBe(5);
  });

  it('maps the remaining statuses', () => {
    expect(errorFromResponse(401, undefined)).toBeInstanceOf(AuthenticationError);
    expect(errorFromResponse(403, undefined)).toBeInstanceOf(PermissionError);
    expect(errorFromResponse(404, undefined)).toBeInstanceOf(NotFoundError);
    expect(errorFromResponse(409, undefined)).toBeInstanceOf(ConflictError);
    expect(errorFromResponse(500, undefined)).toBeInstanceOf(ApiError);
    expect(errorFromResponse(503, undefined)).toBeInstanceOf(ApiError);
  });

  it('falls back to a generic message when the envelope is empty', () => {
    const e = errorFromResponse(500, undefined, { requestId: 'req_1' });
    expect(e.message).toContain('HTTP 500');
    expect(e.requestId).toBe('req_1');
  });

  it('carries a working name and instanceof for subclasses', () => {
    const e = errorFromResponse(404, { error: { code: 'not_found' } });
    expect(e.name).toBe('NotFoundError');
    expect(e instanceof Error).toBe(true);
    expect(e instanceof SelectwinError).toBe(true);
  });
});
