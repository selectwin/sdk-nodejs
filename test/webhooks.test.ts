import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { constructEvent } from '../src/webhooks';
import { SignatureVerificationError } from '../src/errors';

const secret = 'whsec_test_123';
const payload = JSON.stringify({
  id: 'wbh_1',
  type: 'transaction.approved',
  payload: { object: { id: 'tra_1', amount: 9990 } },
});
const validSig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

describe('constructEvent', () => {
  it('accepts a valid signature and returns the parsed, typed event', () => {
    const ev = constructEvent<{ id: string; amount: number }>(payload, validSig, secret);
    expect(ev.id).toBe('wbh_1');
    expect(ev.type).toBe('transaction.approved');
    expect(ev.payload.object.amount).toBe(9990);
  });

  it('accepts the raw hex without the sha256= prefix', () => {
    const ev = constructEvent(payload, validSig.slice('sha256='.length), secret);
    expect(ev.id).toBe('wbh_1');
  });

  it('accepts a Buffer body', () => {
    const ev = constructEvent(Buffer.from(payload, 'utf8'), validSig, secret);
    expect(ev.id).toBe('wbh_1');
  });

  it('rejects a tampered body', () => {
    expect(() => constructEvent(payload + ' ', validSig, secret)).toThrow(SignatureVerificationError);
  });

  it('rejects a wrong secret', () => {
    expect(() => constructEvent(payload, validSig, 'whsec_other')).toThrow(SignatureVerificationError);
  });

  it('rejects a missing signature header', () => {
    expect(() => constructEvent(payload, undefined, secret)).toThrow(SignatureVerificationError);
    expect(() => constructEvent(payload, '', secret)).toThrow(SignatureVerificationError);
  });

  it('rejects non-JSON payloads (after signature passes)', () => {
    const notJson = 'not json';
    const sig = 'sha256=' + createHmac('sha256', secret).update(notJson).digest('hex');
    expect(() => constructEvent(notJson, sig, secret)).toThrow(SignatureVerificationError);
  });

  describe('v1 replay scheme', () => {
    const t = 1_000_000;
    const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');

    it('verifies v1 within tolerance', () => {
      const ev = constructEvent(payload, validSig, secret, {
        signatureV1: `t=${t},v1=${v1}`,
        tolerance: 300,
        now: () => t * 1000,
      });
      expect(ev.id).toBe('wbh_1');
    });

    it('rejects a v1 timestamp outside tolerance', () => {
      expect(() =>
        constructEvent(payload, validSig, secret, {
          signatureV1: `t=${t},v1=${v1}`,
          tolerance: 300,
          now: () => (t + 1000) * 1000,
        }),
      ).toThrow(SignatureVerificationError);
    });

    it('rejects a forged v1 signature', () => {
      expect(() =>
        constructEvent(payload, validSig, secret, { signatureV1: `t=${t},v1=deadbeef` }),
      ).toThrow(SignatureVerificationError);
    });

    // Fail-closed: opting into v1/tolerance must never silently skip the check.
    it('rejects a malformed v1 header (missing v1=) instead of silently passing', () => {
      expect(() =>
        constructEvent(payload, validSig, secret, { signatureV1: `t=${t}`, tolerance: 300 }),
      ).toThrow(SignatureVerificationError);
    });

    it('rejects an empty v1 header when opted in', () => {
      expect(() =>
        constructEvent(payload, validSig, secret, { signatureV1: '   ' }),
      ).toThrow(SignatureVerificationError);
    });

    it('rejects tolerance set without a signatureV1 header', () => {
      expect(() => constructEvent(payload, validSig, secret, { tolerance: 300 })).toThrow(
        SignatureVerificationError,
      );
    });

    it('rejects a non-numeric v1 timestamp when tolerance is enforced', () => {
      const forgedV1 = createHmac('sha256', secret).update(`abc.${payload}`).digest('hex');
      expect(() =>
        constructEvent(payload, validSig, secret, {
          signatureV1: `t=abc,v1=${forgedV1}`,
          tolerance: 300,
        }),
      ).toThrow(SignatureVerificationError);
    });
  });
});
