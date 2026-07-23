# @selectwin/sdk

Official **Selectwin** Node.js / TypeScript SDK — payments (credit card, PIX, boleto),
subscriptions, wallets, webhooks and more.

> Status: **early / work in progress**. Foundation, DX shell and typed
> namespaces in place.

```bash
npm install @selectwin/sdk
```

## Quickstart

```ts
import { Selectwin, CardError } from '@selectwin/sdk';

const sw = new Selectwin(process.env.SELECTWIN_API_KEY!); // sk_test_… / sk_live_…

// Create a PIX transaction (amounts in cents). Concise alias — pass the body directly:
const tx = await sw.transactions.create({ amount: 9990, payment: { method: 'pix', currency: 'BRL' } });

// id + body / id-only aliases:
await sw.subscriptions.pause('subs_…');
await sw.subscriptions.cancel('subs_…', { /* … */ });
const one = await sw.transactions.retrieve('tra_…');

// Typed errors — branch on the class / error.code, never the message
try {
  await sw.transactions.create({ /* … */ });
} catch (err) {
  if (err instanceof CardError) {
    console.log(err.displayMessage, err.reversible); // buyer-facing + retryable
  }
}
```

Every resource is a namespace with **Concise aliases** (`create`, `retrieve`, `update`,
`list`, `delete`, plus resource verbs like `sw.subscriptions.pause('subs_…')`). The full generated
API (all `operationId` methods) is always reachable via `.raw`:

```ts
await sw.transactions.raw.createTransaction({ /* … */ });
```

### Pagination

Top-level `list()` methods auto-paginate. The returned value is both awaitable (first page)
and async-iterable (every item across pages):

```ts
// stream every transaction across all pages
for await (const tx of sw.transactions.list({ limit: 100 })) {
  // …
}

const firstPage = await sw.transactions.list({ limit: 20 }); // { data, hasMore, offset, … }
const all = await sw.customers.list().toArray();             // or .toArray(500) to cap
for await (const page of sw.transactions.list().pages()) { /* page.data */ }
```

For endpoints not wrapped as auto-pagers (e.g. sub-resource lists), the low-level `paginate`
helper works over any `list` function:

```ts
import { paginate } from '@selectwin/sdk';
for await (const item of paginate((p) => sw.subscriptions.raw.listSubscriptionItems({ subscriptionId: 'subs_…', ...p }), { limit: 100 })) { /* … */ }
```

### Webhooks

`constructEvent` verifies the signature and returns a **discriminated union** over the
whole Event Catalog — `switch (event.type)` narrows `event.payload.object` to the matching
resource shape:

```ts
// rawBody MUST be the exact bytes/string received (do not re-serialize)
const event = sw.webhooks.constructEvent(
  rawBody,
  req.headers['x-selectwin-signature'],
  process.env.SELECTWIN_WEBHOOK_SECRET!, // whsec_…
);

switch (event.type) {
  case 'transaction.approved':
    event.payload.object.id; // typed as the transaction read shape
    break;
  case 'subscription.paused':
    event.payload.object; // typed as the subscription read shape
    break;
}
```

`event.type` autocompletes every catalog value (`WebhookEventType`). The catalog itself is
exported for validation — `WEBHOOK_EVENT_TYPES` (readonly tuple) and `isWebhookEventType(x)` —
along with per-resource groups (`TransactionEventType`, `SubscriptionEventType`, …) and the
`WebhookEventObjectMap` `type → object` mapping. Need to assert the object shape yourself?
Pass a type argument: `constructEvent<MyType>(rawBody, sig, secret)`.

## What the SDK adds over the raw generated client

The package is a **generated core** (from the OpenAPI v2.0.0 spec) + a **hand-written DX shell**:

- **Typed client** — `new Selectwin(key)` → `sw.transactions`, `sw.subscriptions`, `sw.customers`, …
- **Concise aliases** per resource (`.create`/`.retrieve`/`.update`/`.list`/`.delete` + custom
  verbs), delegating to the generated methods with exact types. Standard CRUD is **flattened** —
  `create(body)`, `retrieve(id)`, `update(id, body)` — while complex methods (multi-id sub-resources,
  lists) keep the object form. `.raw` exposes the full generated surface.
- **Typed errors** by HTTP status / `error.code`: `CardError` (402, `displayMessage`/`reversible`),
  `ValidationError` (`params`), `RateLimitError` (`retryAfter`), `AuthenticationError`,
  `PermissionError`, `NotFoundError`, `ConflictError`, `ApiError`, `ApiConnectionError`.
- **Auto-retries** (429/5xx/network) with exponential backoff, honouring `Retry-After`.
- **Idempotency** — an `X-Idempotency-Key` is added to every mutation (override via headers).
- **Timeouts** (`AbortController`).
- **Auto-pagination** — top-level `list()` returns an `AutoPager` (await = first page, `for await`
  = all items, `.toArray()`, `.pages()`); plus a low-level `paginate(listFn, params)` helper.
- **Webhook verification + typed events** — `constructEvent` (HMAC-SHA256 of the raw body,
  constant-time) returns a discriminated union over the Event Catalog, so `switch (event.type)`
  narrows `event.payload.object`. The catalog is generated from the spec, so it never drifts.

Auth is the `SelectKey` header; the environment (sandbox/production) is resolved from the key
prefix (`sk_test_` / `sk_live_`).

## Architecture

```
src/
  generated/        # openapi-generator typescript-fetch output — DO NOT edit; synced from selectwin-sdks
  namespaces.ts     # GENERATED Typed wrappers (gen-namespaces.mjs) — DO NOT edit
  webhook-events.ts # GENERATED typed Event Catalog + discriminated event union — DO NOT edit
  http.ts           # custom fetch (retries/timeout) + middleware (idempotency, error mapping)
  errors.ts         # typed error hierarchy
  webhooks.ts       # constructEvent (signature verification)
  pagination.ts     # paginate() + AutoPager
  client.ts         # Selectwin — wires one Configuration into all namespaces
  index.ts          # public exports
```

Cross-cutting concerns are injected **once** into the generated `Configuration` (`fetchApi` +
`middleware`), so every endpoint inherits them and new endpoints work automatically when the core
is regenerated.

## Development

```bash
npm run sync:core         # copy the generated core from selectwin-sdks + regen namespaces + events
npm run gen:namespaces    # regenerate src/namespaces.ts from the generated core
npm run gen:webhook-events # regenerate src/webhook-events.ts (typed Event Catalog)
npm run typecheck         # tsc --noEmit (src + test — also verifies the type-level assertions)
npm test                  # vitest (errors, webhooks, webhook-events, pagination, http, client)
npm run test:integration  # sandbox integration suite — see below
npm run build             # tsup → dual ESM/CJS + d.ts in dist/
```

`sync:core` runs `gen:namespaces` and `gen:webhook-events` automatically. The core is regenerated
from the OpenAPI spec in `selectwin-sdks`; the DX shell in `src/` (except the generated
`namespaces.ts` and `webhook-events.ts`) is hand-maintained.

### Integration tests (sandbox)

`test/integration/**` runs against the **real sandbox API** and is **self-gated**: every suite is
skipped (so `npm test` never touches the network) unless a sandbox key is present. Provide one and
run the separate suite:

```bash
SELECTWIN_SANDBOX_KEY=sk_test_... npm run test:integration
# SELECTWIN_API_KEY is also honoured, but only if it starts with sk_test_ (never a live key).
# SELECTWIN_BASE_URL optionally overrides the host (sandbox/prod is resolved from the key prefix).
```

Coverage: read-only smoke (auth + list envelope + auto-pagination across resources), typed-error
mapping (bogus key → `AuthenticationError`), and a customer create → retrieve → delete round-trip
plus an idempotency replay. Writes are sandbox-only and cleaned up in `afterAll`.

## Documentation

Full guides and the API reference live at [selectwin.io/docs](https://selectwin.io/docs/sdk/nodejs/overview).
