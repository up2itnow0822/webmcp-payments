import { describe, it, expect, vi } from 'vitest';
import { PaymentGate, type X402PaymentEnvelope } from '../src/index.js';

const MERCHANT = '0x1111111111111111111111111111111111111111' as const;
const PAYER = '0x3333333333333333333333333333333333333333' as const;
const TX = `0x${'ab'.repeat(32)}` as const;

function gateWithVerifier(verified: boolean, delayMs = 0) {
  const gate = new PaymentGate({ merchantWallet: MERCHANT });
  const verify = vi.fn(async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return verified ? { verified: true } : { verified: false, error: 'not confirmed' };
  });
  (gate as unknown as { verifier: { verify: typeof verify } }).verifier = { verify } as never;
  return { gate, verify };
}

const proof = { txHash: TX, chain: 'base' as const, nonce: 'n1', payer: PAYER };
const env = { nonce: 'n1' } as unknown as X402PaymentEnvelope;

describe('S5 replay protection', () => {
  it('accepts a payment tx once, rejects sequential replays', async () => {
    const { gate } = gateWithVerifier(true);
    expect((await gate.verifyPayment(proof, env)).verified).toBe(true);
    for (let i = 0; i < 4; i++) {
      const r = await gate.verifyPayment({ ...proof, nonce: `x${i}` }, env);
      expect(r.verified).toBe(false);
      expect(r.error).toMatch(/already used/);
    }
  });

  it('is case-insensitive on txHash', async () => {
    const { gate } = gateWithVerifier(true);
    await gate.verifyPayment(proof, env);
    expect((await gate.verifyPayment({ ...proof, txHash: TX.toUpperCase().replace('0X', '0x') as `0x${string}` }, env)).verified).toBe(false);
  });

  it('only one of 50 concurrent replays passes', async () => {
    const { gate } = gateWithVerifier(true, 5);
    const rs = await Promise.all(Array.from({ length: 50 }, () => gate.verifyPayment(proof, env)));
    expect(rs.filter((r) => r.verified).length).toBe(1);
  });

  it('releases the claim when verification fails so an honest retry works', async () => {
    const { gate, verify } = gateWithVerifier(false);
    expect((await gate.verifyPayment(proof, env)).verified).toBe(false);
    verify.mockResolvedValueOnce({ verified: true } as never);
    expect((await gate.verifyPayment(proof, env)).verified).toBe(true);
  });
});
