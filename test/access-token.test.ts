import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { PaymentGate } from '../src/index.js';

const MERCHANT = '0x1111111111111111111111111111111111111111' as const;

function forge(secret: string, resource: string): string {
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ nonce: 'n', txHash: '0x', payer: '0x', resource, issuedAt: now, expiresAt: now + 600 })).toString('base64url');
  return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`;
}

function run(gate: PaymentGate, token: string, path = '/tool') {
  let nexted = false; let status = 0;
  const req = { path, headers: { 'x-payment-token': token } } as never;
  const res = { status(c: number) { status = c; return this; }, json() { return this; }, setHeader() { return this; }, set() { return this; }, send() { return this; }, end() { return this; } } as never;
  return gate.express(gate.require({ amount: '0.50', token: 'USDC', chain: 'base' }))(req, res, () => { nexted = true; }).then(() => ({ nexted, status }));
}

describe('access token hardening', () => {
  it('rejects tokens forged with the old public default secret', async () => {
    delete process.env['WEBMCP_ACCESS_TOKEN_SECRET'];
    const gate = new PaymentGate({ merchantWallet: MERCHANT });
    const r = await run(gate, forge('webmcp-default-secret-change-me', '/tool'));
    expect(r.nexted).toBe(false);
  });

  it('rejects a valid token issued for a different resource', async () => {
    process.env['WEBMCP_ACCESS_TOKEN_SECRET'] = 'x'.repeat(32);
    const gate = new PaymentGate({ merchantWallet: MERCHANT });
    expect((await run(gate, forge('x'.repeat(32), '/cheap'), '/tool')).nexted).toBe(false);
    expect((await run(gate, forge('x'.repeat(32), '/tool'), '/tool')).nexted).toBe(true);
    delete process.env['WEBMCP_ACCESS_TOKEN_SECRET'];
  });
});
