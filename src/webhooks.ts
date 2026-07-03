/**
 * Webhook signature verification.
 *
 * Selectwin signs each delivery with `X-Selectwin-Signature: sha256=<hex>` — an
 * HMAC-SHA256 of the RAW request body using the endpoint secret (`whsec_...`).
 * An optional replay-proof scheme is sent in `X-Selectwin-Signature-v1:
 * t=<unix>,v1=<hex>` where the signed message is `<t>.<rawBody>`.
 *
 * You MUST pass the raw body (bytes/string exactly as received) — re-serialising
 * the JSON (key order / spacing) breaks verification.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError } from './errors';
import type { SelectwinEventBase, SelectwinEventUnion, WebhookEventType } from './webhook-events';

/**
 * A verified webhook event with a caller-supplied `payload.object` type.
 *
 * `constructEvent()` returns the strongly-typed {@link SelectwinEventUnion} by
 * default (so `switch (event.type)` narrows `payload.object`); use this generic
 * form — `constructEvent<MyType>(...)` — only when you want to assert the object
 * shape yourself. See the Event Catalog for the full list of `type` values.
 */
export interface SelectwinEvent<T = unknown> extends SelectwinEventBase {
  /** `resource.action` (autocompletes the known catalog; any string accepted). */
  type: WebhookEventType | (string & {});
  payload: { object: T };
}

export interface ConstructEventOptions {
  /** The `X-Selectwin-Signature-v1` header, to also verify the replay-proof scheme. */
  signatureV1?: string | null;
  /** Max allowed age (seconds) of the v1 timestamp. Requires `signatureV1`. */
  tolerance?: number;
  /** Clock source (ms); injectable for tests. */
  now?: () => number;
}

function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function parseV1(header: string): { t?: string; v1?: string } {
  const out: { t?: string; v1?: string } = {};
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const key = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      if (key === 't') out.t = value;
      else if (key === 'v1') out.v1 = value;
    }
  }
  return out;
}

/**
 * Verify the signature and return the parsed event as the strongly-typed
 * {@link SelectwinEventUnion} — `switch (event.type)` narrows `payload.object`
 * to the matching resource shape. Throws `SignatureVerificationError` if the
 * signature is missing or invalid.
 */
export function constructEvent(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  secret: string,
  options?: ConstructEventOptions,
): SelectwinEventUnion;
/**
 * Assert the `payload.object` shape yourself (escape hatch): returns
 * `SelectwinEvent<T>` with `payload.object` typed as `T`.
 */
export function constructEvent<T>(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  secret: string,
  options?: ConstructEventOptions,
): SelectwinEvent<T>;
export function constructEvent(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  secret: string,
  options: ConstructEventOptions = {},
): SelectwinEvent<unknown> {
  if (!secret) throw new SignatureVerificationError('Missing webhook secret');
  if (!signatureHeader) {
    throw new SignatureVerificationError('Missing X-Selectwin-Signature header');
  }

  const received = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  const expected = hmacHex(secret, rawBody);
  if (!timingSafeEqualHex(received, expected)) {
    throw new SignatureVerificationError('Webhook signature verification failed');
  }

  // Optional: replay-proof v1 scheme. Fail CLOSED — once a caller opts in (via
  // signatureV1 and/or tolerance), a missing/malformed header must throw, never
  // silently skip the check (a captured replay still carries a valid sha256, so
  // the primary check alone can't stop it).
  if (options.tolerance != null && !options.signatureV1) {
    throw new SignatureVerificationError(
      '`tolerance` requires the X-Selectwin-Signature-v1 header (pass it as signatureV1)',
    );
  }
  if (options.signatureV1) {
    const { t, v1 } = parseV1(options.signatureV1);
    if (!t || !v1) {
      throw new SignatureVerificationError(
        'Malformed X-Selectwin-Signature-v1 header (expected "t=<unix>,v1=<hex>")',
      );
    }
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expectedV1 = hmacHex(secret, `${t}.${body}`);
    if (!timingSafeEqualHex(v1, expectedV1)) {
      throw new SignatureVerificationError('Webhook v1 signature verification failed');
    }
    if (options.tolerance != null) {
      const ts = Number(t);
      if (!Number.isFinite(ts)) {
        throw new SignatureVerificationError('Webhook v1 timestamp is not a valid number');
      }
      const nowSecs = Math.floor((options.now ? options.now() : Date.now()) / 1000);
      if (Math.abs(nowSecs - ts) > options.tolerance) {
        throw new SignatureVerificationError('Webhook timestamp is outside the tolerance window');
      }
    }
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  try {
    return JSON.parse(body) as SelectwinEvent<unknown>;
  } catch {
    throw new SignatureVerificationError('Webhook payload is not valid JSON');
  }
}
