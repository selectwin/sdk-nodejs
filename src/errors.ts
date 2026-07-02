/**
 * Typed error hierarchy. Branch on `error.code` (stable, machine-readable) — never
 * on `message` (human text, may be localized). See the API error-envelope docs.
 */

export interface ErrorParam {
  field?: string;
  message?: string;
  [k: string]: unknown;
}

/** The `error` object inside the API's `{ error: {...} }` envelope. */
export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: string;
  params?: ErrorParam[];
  /** 402 only: buyer-facing message for card declines. */
  displayMessage?: string;
  /** 402 only: whether the decline is retryable. */
  reversible?: boolean;
  [k: string]: unknown;
}

export interface ErrorEnvelope {
  error?: ApiErrorBody;
  [k: string]: unknown;
}

export interface SelectwinErrorOptions {
  code?: string;
  statusCode?: number;
  requestId?: string;
  raw?: unknown;
}

/** Base class for every error thrown by the SDK. */
export class SelectwinError extends Error {
  readonly code?: string;
  readonly statusCode?: number;
  readonly requestId?: string;
  readonly raw?: unknown;

  constructor(message: string, options: SelectwinErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.requestId = options.requestId;
    this.raw = options.raw;
    // Restore prototype chain for `instanceof` across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 — invalid/missing API key. */
export class AuthenticationError extends SelectwinError {}
/** 403 — authenticated but not allowed (scope / IP restriction). */
export class PermissionError extends SelectwinError {}
/** 404 — resource not found. */
export class NotFoundError extends SelectwinError {}
/** 409 — idempotency conflict (replay in progress or divergent body). */
export class ConflictError extends SelectwinError {}
/** 5xx / unclassified server error. */
export class ApiError extends SelectwinError {}
/** Network failure / timeout — the request never got a response. */
export class ApiConnectionError extends SelectwinError {}
/** Webhook signature verification failed. */
export class SignatureVerificationError extends SelectwinError {}

/** 400 / 422 — request validation or business-rule failure; see `params`. */
export class ValidationError extends SelectwinError {
  readonly params?: ErrorParam[];
  constructor(message: string, options: SelectwinErrorOptions & { params?: ErrorParam[] } = {}) {
    super(message, options);
    this.params = options.params;
  }
}

/** 402 — card declined by the issuer. `displayMessage` is buyer-facing. */
export class CardError extends SelectwinError {
  readonly displayMessage?: string;
  readonly reversible?: boolean;
  constructor(
    message: string,
    options: SelectwinErrorOptions & { displayMessage?: string; reversible?: boolean } = {},
  ) {
    super(message, options);
    this.displayMessage = options.displayMessage;
    this.reversible = options.reversible;
  }
}

/** 429 — rate limited. `retryAfter` is seconds (from the `Retry-After` header). */
export class RateLimitError extends SelectwinError {
  readonly retryAfter?: number;
  constructor(message: string, options: SelectwinErrorOptions & { retryAfter?: number } = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** Map an HTTP status + error envelope to a typed error. */
export function errorFromResponse(
  status: number,
  envelope: ErrorEnvelope | undefined,
  extra: { requestId?: string; retryAfter?: number } = {},
): SelectwinError {
  const body = envelope?.error ?? {};
  const code = body.code;
  const message = body.message || body.displayMessage || `Selectwin API error (HTTP ${status})`;
  const base: SelectwinErrorOptions = { code, statusCode: status, requestId: extra.requestId, raw: envelope };

  switch (status) {
    case 400:
    case 422:
      return new ValidationError(message, { ...base, params: body.params });
    case 401:
      return new AuthenticationError(message, base);
    case 402:
      return new CardError(message, {
        ...base,
        displayMessage: body.displayMessage,
        reversible: body.reversible,
      });
    case 403:
      return new PermissionError(message, base);
    case 404:
      return new NotFoundError(message, base);
    case 409:
      return new ConflictError(message, base);
    case 429:
      return new RateLimitError(message, { ...base, retryAfter: extra.retryAfter });
    default:
      return new ApiError(message, base);
  }
}
