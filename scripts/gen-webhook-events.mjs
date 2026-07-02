// Generate the typed webhook Event Catalog from the generated core.
//
// The OpenAPI spec already carries the AUTHORITATIVE list of webhook event
// types as an enum on the create-endpoint request
// (`CreateWebhookEndpointRequestEventsEnum`). We parse it and emit
// src/webhook-events.ts with:
//   - WEBHOOK_EVENT_TYPES  — the canonical readonly tuple (+ isWebhookEventType)
//   - WebhookEventType      — union of every `resource.action` string
//   - <Resource>EventType   — per-resource groups (handy for coarse narrowing)
//   - WebhookEventObjectMap — maps each `type` to the shape of `payload.object`
//                             (the resource's READ shape; `unknown` when there
//                             is no dedicated resource model)
//   - SelectwinEventOf<T> / SelectwinEventUnion — the discriminated event union
//     so `switch (event.type)` narrows `event.payload.object`.
//
// Because the source is the generated enum, the catalog auto-syncs with the
// spec (which auto-syncs with node-api) on every `npm run sync:core`.
//
// Run: npm run gen:webhook-events   (after `npm run sync:core`)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const enumFile = path.join(repoRoot, 'src', 'generated', 'models', 'CreateWebhookEndpointRequest.ts');

// Resource prefix -> the generated model that describes `payload.object`
// (verified against each resource's single-read return type; the docs state
// `payload.object` has "the same shape as reading the resource"). `null` =
// no dedicated model in the spec → `unknown`. Longest prefix wins, so
// `customer.address`, `checkout.session` and the `webhook.ping` test event are
// matched before the shorter `customer` / `webhook` prefixes.
const RESOURCE_OBJECT = [
  ['checkout.session', 'CreateCheckoutSession201Response'],
  ['customer.address', 'GetCustomer200ResponseAddressesInner'],
  ['webhook.ping', null], // synthetic test ping — arbitrary object
  ['transaction', 'GetTransaction200Response'],
  ['customer', 'GetCustomer200Response'],
  ['card', 'GetCustomer200ResponseCardsInner'],
  ['subscription', 'ListSubscriptions200ResponseDataInner'],
  ['receivable', 'ListReceivables200ResponseDataInner'],
  ['wallet', 'ListWallets200ResponseDataInner'],
  ['seller', null], // sellers are not a public read resource
  ['withdrawal', 'ListWithdrawals200ResponseDataInner'],
  ['webhook', 'ListWebhookEndpoints200ResponseDataInner'],
].sort((a, b) => b[0].length - a[0].length);

/** Longest-prefix match: exact type or `<prefix>.`-prefixed. */
function objectTypeFor(eventType) {
  for (const [prefix, typeName] of RESOURCE_OBJECT) {
    if (eventType === prefix || eventType.startsWith(prefix + '.')) return typeName;
  }
  return null;
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const quote = (s) => `'${s}'`;

// Per-group type-name overrides where the derived `<Cap>EventType` would clash
// with a reserved name (the master `WebhookEventType` union).
const GROUP_TYPE_NAME = { webhook: 'WebhookEndpointEventType' };
const groupTypeName = (group) => GROUP_TYPE_NAME[group] ?? `${cap(group)}EventType`;

// --- Parse the authoritative event enum out of the generated model. ---------
const src = readFileSync(enumFile, 'utf8');
const start = src.indexOf('CreateWebhookEndpointRequestEventsEnum = {');
if (start === -1) throw new Error('Could not find CreateWebhookEndpointRequestEventsEnum in the generated core');
const end = src.indexOf('} as const;', start);
const block = src.slice(start, end);
const eventTypes = [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
if (eventTypes.length === 0) throw new Error('Parsed zero event types from the enum');

// --- Build the per-resource groups and the object map. ----------------------
const groups = new Map(); // first segment -> [eventType, ...]
const objectMap = []; // [eventType, typeName|null]
const usedTypes = new Set();
let mapped = 0;
for (const t of eventTypes) {
  const group = t.split('.')[0];
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(t);
  const typeName = objectTypeFor(t);
  if (typeName) {
    usedTypes.add(typeName);
    mapped++;
  } else {
    console.warn(`  ! no resource model for "${t}" — payload.object typed as \`unknown\``);
  }
  objectMap.push([t, typeName]);
}

// --- Emit. ------------------------------------------------------------------
const importBlock = usedTypes.size
  ? `import type {\n${[...usedTypes].sort().map((n) => `  ${n},`).join('\n')}\n} from './generated/models';\n\n`
  : '';

const groupTypes = [...groups.entries()]
  .map(([group, types]) => {
    const name = groupTypeName(group);
    const union = types.map(quote).join(' | ');
    return `/** \`${group}.*\` event types. */\nexport type ${name} = ${union};`;
  })
  .join('\n\n');

const objectMapEntries = objectMap
  .map(([t, typeName]) => `  ${quote(t)}: ${typeName ?? 'unknown'};`)
  .join('\n');

const out = `/* eslint-disable */
// GENERATED by scripts/gen-webhook-events.mjs — DO NOT EDIT.
// Typed webhook Event Catalog derived from the spec's authoritative event enum
// (\`CreateWebhookEndpointRequestEventsEnum\`). Regenerate after \`npm run sync:core\`
// with \`npm run gen:webhook-events\`.

${importBlock}/**
 * Every webhook event type Selectwin can deliver — the authoritative catalog,
 * exactly the values a webhook endpoint's \`events[]\` accepts.
 */
export const WEBHOOK_EVENT_TYPES = [
${eventTypes.map((t) => `  ${quote(t)},`).join('\n')}
] as const;

/** Union of every \`resource.action\` webhook event type. */
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Runtime guard: is \`value\` one of the known webhook event types? */
export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

${groupTypes}

/**
 * Maps each event \`type\` to the shape of \`payload.object\` (the resource's read
 * shape). Types without a dedicated resource model resolve to \`unknown\`.
 */
export interface WebhookEventObjectMap {
${objectMapEntries}
}

/** Common envelope fields shared by every delivered webhook event. */
export interface SelectwinEventBase {
  /** Public event id (\`wbh_...\`). Deduplicate on this. */
  id: string;
  /** Event origin (\`automatic\` for platform events; \`api\` for the test ping). */
  source?: string;
  /** Correlation id of the originating request, when available. */
  correlationId?: string | null;
  /** Present only on marketplace fan-out to a parent: the sub-account publicId. */
  account?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/** A single, fully-typed webhook event for one specific \`type\`. */
export interface SelectwinEventOf<T extends WebhookEventType> extends SelectwinEventBase {
  type: T;
  payload: { object: WebhookEventObjectMap[T] };
}

/**
 * Discriminated union over every event type. \`switch (event.type)\` (or
 * \`if (event.type === 'transaction.approved')\`) narrows \`event.payload.object\`
 * to the matching resource shape.
 */
export type SelectwinEventUnion = { [K in WebhookEventType]: SelectwinEventOf<K> }[WebhookEventType];
`;

writeFileSync(path.join(repoRoot, 'src', 'webhook-events.ts'), out, 'utf8');
console.log(
  `Wrote src/webhook-events.ts — ${eventTypes.length} event types, ${groups.size} groups, ${mapped} mapped to a resource model (${eventTypes.length - mapped} → unknown).`,
);
