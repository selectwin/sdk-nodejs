/**
 * Shared setup for the SANDBOX integration suite.
 *
 * These tests hit the real Selectwin sandbox API and only run when a sandbox
 * key is present in the environment — otherwise every `describe` is skipped, so
 * `npm test` (the unit suite) never makes a network call.
 *
 * Provide a **sandbox** key (prefix `sk_test_`) via either:
 *   SELECTWIN_SANDBOX_KEY=sk_test_...      (preferred, unambiguous)
 *   SELECTWIN_API_KEY=sk_test_...          (used only if it is a test key)
 * Optionally override the host with SELECTWIN_BASE_URL (defaults to the SDK's
 * built-in https://api.selectwin.io; the sandbox/prod environment is resolved
 * from the key prefix, not the host).
 *
 * Run: npm run test:integration
 */
import { randomUUID } from 'node:crypto';
import { Selectwin, type SelectwinOptions } from '../../src/index';

function resolveSandboxKey(): string | undefined {
  const explicit = process.env.SELECTWIN_SANDBOX_KEY?.trim();
  if (explicit) return explicit;
  const generic = process.env.SELECTWIN_API_KEY?.trim();
  // Only borrow the generic key if it is unmistakably a sandbox/test key — we
  // must never run these mutations against a live key by accident.
  if (generic && generic.startsWith('sk_test_')) return generic;
  return undefined;
}

export const sandboxKey = resolveSandboxKey();
export const hasSandboxKey = Boolean(sandboxKey);
export const sandboxBaseUrl = process.env.SELECTWIN_BASE_URL?.trim() || undefined;

/** A client bound to the sandbox key. Only call inside a gated `describe`. */
export function makeClient(overrides: SelectwinOptions = {}): Selectwin {
  if (!sandboxKey) throw new Error('makeClient() called without a sandbox key — the suite should be skipped');
  return new Selectwin(sandboxKey, {
    baseUrl: sandboxBaseUrl,
    maxRetries: 1,
    timeoutMs: 30_000,
    userAgent: 'selectwin-node-integration-tests',
    ...overrides,
  });
}

/** A unique, obviously-synthetic email so test data is easy to spot and never collides. */
export const uniqueEmail = () => `sdk-it-${Date.now()}-${randomUUID().slice(0, 8)}@sandbox.selectwin.test`;

/** Tag written to every created resource's metadata for traceability/cleanup. */
export const TEST_METADATA = { sdkIntegrationTest: true } as const;
