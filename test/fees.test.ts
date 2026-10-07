import { describe, it, expect } from 'vitest';
import * as root from '../src/index.js';
import {
  PaymentGate,
  PaymentVerifier,
  WEBMCP_TREASURY,
  PLATFORM_FEE_RATE,
  DEFAULT_FEE_RATE,
  type X402PaymentEnvelope,
} from '../src/index.js';

const MERCHANT = '0x1111111111111111111111111111111111111111' as const;
const OWN_FEE_WALLET = '0x2222222222222222222222222222222222222222' as const;
const PAYER = '0x3333333333333333333333333333333333333333' as const;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX = `0x${'ab'.repeat(32)}` as const;

describe('fee defaults (0.4.0)', () => {
  it('default: envelope charges the full merchant amount and has no fee fields', async () => {
    const gate = new PaymentGate({ merchantWallet: MERCHANT });
    const env = await gate.buildPaymentEnvelope(gate.require({ amount: '0.50', token: 'USDC', chain: 'base' }), 'r');
    expect(env.amount).toBe('500000');
    expect(env.amountDecimal).toBe('0.50');
    expect(env.recipient).toBe(MERCHANT);
    expect('feeRecipient' in env).toBe(false);
    expect('feeAmount' in env).toBe(false);
    expect(JSON.stringify(env)).not.toContain(WEBMCP_TREASURY);
  });

  it('default via protect(): 402 envelope has no fee fields', async () => {
    const gate = new PaymentGate({ merchantWallet: MERCHANT });
    const h = gate.protect(gate.require({ amount: '1.00', token: 'USDC', chain: 'base' }), async () => 'ok', 'res');
    const r = await h(undefined);
    expect(r.status).toBe(402);
    expect(r.paymentRequired?.amount).toBe('1000000');
    expect(r.paymentRequired?.feeAmount).toBeUndefined();
    expect(r.paymentRequired?.feeRecipient).toBeUndefined();
  });

  it('feeRate: 0 explicitly behaves like the default, even with feeWallet set', async () => {
    const gate = new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0, feeWallet: OWN_FEE_WALLET });
    const env = await gate.buildPaymentEnvelope(gate.require({ amount: '2', token: 'USDC', chain: 'base' }), 'r');
    expect(env.amount).toBe('2000000');
    expect(env.feeAmount).toBeUndefined();
    expect(env.feeRecipient).toBeUndefined();
  });

  it('feeRate > 0 without feeWallet throws (no default fee destination)', () => {
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0.01 })).toThrow(/feeWallet is required when feeRate > 0/);
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: PLATFORM_FEE_RATE })).toThrow(/feeWallet is required/);
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0.0001 })).toThrow(/feeWallet is required/);
  });

  it('opted in at 1% with own feeWallet: net amount + fee fields to that wallet', async () => {
    const gate = new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0.01, feeWallet: OWN_FEE_WALLET });
    const env = await gate.buildPaymentEnvelope(gate.require({ amount: '0.50', token: 'USDC', chain: 'base' }), 'r');
    expect(env.amount).toBe('495000');
    expect(env.feeAmount).toBe('5000');
    expect(env.feeRecipient).toBe(OWN_FEE_WALLET);
    expect(JSON.stringify(env)).not.toContain(WEBMCP_TREASURY);
  });

  it('opted in with PLATFORM_FEE_RATE and own feeWallet: fee goes to that wallet', async () => {
    const gate = new PaymentGate({ merchantWallet: MERCHANT, feeRate: PLATFORM_FEE_RATE, feeWallet: OWN_FEE_WALLET });
    const env = await gate.buildPaymentEnvelope(gate.require({ amount: '10', token: 'USDC', chain: 'base' }), 'r');
    expect(env.amount).toBe('9900000');
    expect(env.feeAmount).toBe('100000');
    expect(env.feeRecipient).toBe(OWN_FEE_WALLET);
  });

  it('rejects invalid feeRate and feeWallet', () => {
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: -0.01 })).toThrow(/feeRate/);
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: 1 })).toThrow(/feeRate/);
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: Number.NaN })).toThrow(/feeRate/);
    expect(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0.01, feeWallet: '0xnope' as `0x${string}` })).toThrow(/Invalid feeWallet/);
  });

  it('WEBMCP_TREASURY is still exported (deprecated, unused) with its 0.3.x value', () => {
    expect(WEBMCP_TREASURY).toBe('0xd7cF53B92A145A9EAFF210f56664865714F3D7BE');
  });

  it('constants', () => {
    expect(DEFAULT_FEE_RATE).toBe(0);
    expect(PLATFORM_FEE_RATE).toBe(0.01);
    expect(root.VERSION).toBe('0.4.0');
  });
});

// ─── Verifier with a mocked chain client ─────────────────────────────────
function pad(addr: string) {
  return `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
}
function transferLog(to: string, value: bigint) {
  return {
    address: USDC_BASE,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      pad(PAYER),
      pad(to),
    ],
    data: `0x${value.toString(16).padStart(64, '0')}`,
  };
}
function verifierWithLogs(logs: unknown[]) {
  const client = {
    getTransactionReceipt: async () => ({ status: 'success', blockNumber: 100n, logs }),
    getBlockNumber: async () => 105n,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PaymentVerifier({ clientFactory: () => client as any });
}
async function envelope(gate: PaymentGate, amount: string): Promise<X402PaymentEnvelope> {
  return gate.buildPaymentEnvelope(gate.require({ amount, token: 'USDC', chain: 'base' }), 'r');
}

describe('verifier with and without fee fields', () => {
  it('default (no fee): a single full-amount transfer to the merchant verifies', async () => {
    const env = await envelope(new PaymentGate({ merchantWallet: MERCHANT }), '0.50');
    const res = await verifierWithLogs([transferLog(MERCHANT, 500000n)]).verify(
      { txHash: TX, chain: 'base', nonce: env.nonce, payer: PAYER }, env);
    expect(res.verified).toBe(true);
  });

  it('default (no fee): a transfer below the full amount is rejected', async () => {
    const env = await envelope(new PaymentGate({ merchantWallet: MERCHANT }), '0.50');
    const res = await verifierWithLogs([transferLog(MERCHANT, 495000n)]).verify(
      { txHash: TX, chain: 'base', nonce: env.nonce, payer: PAYER }, env);
    expect(res.verified).toBe(false);
  });

  it('opted in (1%): merchant net + fee transfer verifies (0.3.x behaviour preserved)', async () => {
    const env = await envelope(new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0.01, feeWallet: OWN_FEE_WALLET }), '0.50');
    const res = await verifierWithLogs([transferLog(MERCHANT, 495000n), transferLog(OWN_FEE_WALLET, 5000n)]).verify(
      { txHash: TX, chain: 'base', nonce: env.nonce, payer: PAYER }, env);
    expect(res.verified).toBe(true);
  });

  it('legacy 0.3.x envelope shape (fee fields present) still verifies', async () => {
    const env = await envelope(new PaymentGate({ merchantWallet: MERCHANT }), '0.50');
    const legacy = { ...env, amount: '495000', feeRecipient: OWN_FEE_WALLET, feeAmount: '5000' } as X402PaymentEnvelope;
    const res = await verifierWithLogs([transferLog(MERCHANT, 495000n), transferLog(OWN_FEE_WALLET, 5000n)]).verify(
      { txHash: TX, chain: 'base', nonce: env.nonce, payer: PAYER }, legacy);
    expect(res.verified).toBe(true);
  });
});

describe('export surface', () => {
  it('keeps every 0.3.1 root export and adds only DEFAULT_FEE_RATE', () => {
    const v031 = ['CHAIN_CONFIGS','PLATFORM_FEE_RATE','PaymentDiscovery','PaymentGate','PaymentVerifier','TOKEN_DECIMALS','VERSION','WEBMCP_TREASURY','calculateFee','createDiscovery','extractProofFromHeaders','fromSmallestUnit','generateNonce','getTokenAddress','toSmallestUnit'];
    expect(Object.keys(root).sort()).toEqual([...v031, 'DEFAULT_FEE_RATE'].sort());
  });
});
