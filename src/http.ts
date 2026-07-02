/**
 * Cross-cutting HTTP concerns, injected once into the generated `Configuration`
 * so every generated endpoint inherits them with no per-endpoint code:
 *  - a custom `fetchApi` that adds a timeout and retries (429/5xx/network) with
 *    exponential backoff (honouring `Retry-After`);
 *  - a `Middleware` that stamps `User-Agent` + an idempotency key on mutations,
 *    maps error responses to typed errors, and normalises network failures.
 */
import { randomUUID } from 'node:crypto';
import type {
  ErrorContext,
  FetchAPI,
  FetchParams,
  Middleware,
  RequestContext,
  ResponseContext,
} from './generated/runtime';
import {
  ApiConnectionError,
  errorFromResponse,
  RateLimitError,
  SelectwinError,
  type ErrorEnvelope,
} from './errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Retry only where a retry can plausibly help. NOT 409 (idempotency conflict).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface RetryOptions {
  maxRetries: number;
  timeoutMs?: number;
  fetchImpl?: FetchAPI;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number, res?: Response): number {
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 20_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.floor(Math.random() * 250); // jitter
}

/** A `fetch`-compatible function with timeout + retry, for `Configuration.fetchApi`. */
export function createFetchApi(options: RetryOptions): FetchAPI {
  const doFetch = options.fetchImpl ?? fetch;
  const maxRetries = Math.max(0, options.maxRetries);

  const fetchApi: FetchAPI = async (input, init) => {
    let attempt = 0;
    for (;;) {
      const controller = options.timeoutMs ? new AbortController() : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (controller && options.timeoutMs) {
        timer = setTimeout(() => controller.abort(), options.timeoutMs);
      }
      const attemptInit: RequestInit = controller ? { ...init, signal: controller.signal } : { ...init };
      try {
        const res = await doFetch(input, attemptInit);
        if (timer) clearTimeout(timer);
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          await sleep(backoffMs(attempt, res));
          attempt++;
          continue;
        }
        return res;
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt));
          attempt++;
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new ApiConnectionError(`Request to Selectwin failed: ${reason}`, { raw: err });
      }
    }
  };

  return fetchApi;
}

/** Pre/post/onError middleware wiring the DX concerns onto every generated call. */
export function buildMiddleware(userAgent: string): Middleware {
  return {
    async pre(context: RequestContext): Promise<FetchParams | void> {
      const method = (context.init.method ?? 'GET').toUpperCase();
      const headers = new Headers(context.init.headers);
      if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent);
      if (MUTATING.has(method) && !headers.has('X-Idempotency-Key')) {
        headers.set('X-Idempotency-Key', randomUUID());
      }
      context.init.headers = headers;
      return { url: context.url, init: context.init };
    },

    async post(context: ResponseContext): Promise<Response | void> {
      const res = context.response;
      if (res.status >= 200 && res.status < 300) return; // success — leave untouched

      let envelope: ErrorEnvelope | undefined;
      try {
        envelope = (await res.clone().json()) as ErrorEnvelope;
      } catch {
        envelope = undefined;
      }
      const requestId = res.headers.get('x-request-id') ?? undefined;
      const retryAfterRaw = res.headers.get('retry-after');
      const retryAfter =
        retryAfterRaw && !Number.isNaN(Number(retryAfterRaw)) ? Number(retryAfterRaw) : undefined;
      throw errorFromResponse(res.status, envelope, { requestId, retryAfter });
    },

    async onError(context: ErrorContext): Promise<Response | void> {
      // Our fetchApi already throws ApiConnectionError; keep typed errors intact
      // (otherwise the generated runtime would wrap them in a FetchError).
      if (context.error instanceof SelectwinError) throw context.error;
      const reason = context.error instanceof Error ? context.error.message : String(context.error);
      throw new ApiConnectionError(`Request to Selectwin failed: ${reason}`, { raw: context.error });
    },
  };
}

// re-export so callers can special-case rate limiting without deep imports
export { RateLimitError };
