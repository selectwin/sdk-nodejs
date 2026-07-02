/**
 * @selectwin/sdk — the official Selectwin Node.js / TypeScript SDK.
 *
 * Generated core (from the OpenAPI v2.0.0 spec) + a hand-written DX shell:
 * typed client, typed errors, auto-retries, idempotency, pagination and webhook
 * signature verification.
 */
export { Selectwin, SDK_VERSION } from './client';
export type { SelectwinOptions, WebhooksResource } from './client';

// Stripe-style typed resource namespaces (e.g. TransactionsNamespace).
export * from './namespaces';

export {
  SelectwinError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ConflictError,
  ApiError,
  ApiConnectionError,
  SignatureVerificationError,
  ValidationError,
  CardError,
  RateLimitError,
  errorFromResponse,
} from './errors';
export type { ErrorEnvelope, ApiErrorBody, ErrorParam, SelectwinErrorOptions } from './errors';

export { constructEvent } from './webhooks';
export type { SelectwinEvent, ConstructEventOptions } from './webhooks';

// Typed webhook Event Catalog (generated from the spec's authoritative enum).
export { WEBHOOK_EVENT_TYPES, isWebhookEventType } from './webhook-events';
export type {
  WebhookEventType,
  WebhookEventObjectMap,
  SelectwinEventBase,
  SelectwinEventOf,
  SelectwinEventUnion,
  TransactionEventType,
  CustomerEventType,
  CardEventType,
  SubscriptionEventType,
  ReceivableEventType,
  WalletEventType,
  SellerEventType,
  WithdrawalEventType,
  WebhookEndpointEventType,
  CheckoutEventType,
} from './webhook-events';

export { paginate, AutoPager } from './pagination';
export type { PageResponse, PaginateParams } from './pagination';

// Generated request/response model types (e.g. Transaction, Subscription, …).
export * from './generated/models';
