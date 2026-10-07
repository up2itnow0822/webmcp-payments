// Smoke test against an INSTALLED webmcp-payments (run from a dir where it's installed).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MERCHANT = '0x1111111111111111111111111111111111111111';
const OWN = '0x2222222222222222222222222222222222222222';
const TREASURY = '0xd7cF53B92A145A9EAFF210f56664865714F3D7BE';
const V031_ROOT = ['CHAIN_CONFIGS','PLATFORM_FEE_RATE','PaymentDiscovery','PaymentGate','PaymentVerifier','TOKEN_DECIMALS','VERSION','WEBMCP_TREASURY','calculateFee','createDiscovery','extractProofFromHeaders','fromSmallestUnit','generateNonce','getTokenAddress','toSmallestUnit'];
const SUBPATHS = { middleware: ['PaymentGate','extractProofFromHeaders'], verifier: ['PaymentVerifier'], discovery: ['PaymentDiscovery','createDiscovery'] };

let n = 0;
const ok = (msg) => console.log(`ok ${++n} - ${msg}`);

async function check(label, mod, sub) {
  const { PaymentGate } = mod;
  // exports
  const keys = Object.keys(mod).filter((k) => k !== 'default' && k !== '__esModule').sort();
  for (const k of V031_ROOT) assert.ok(keys.includes(k), `${label}: missing 0.3.1 export ${k}`);
  assert.deepEqual(keys.filter((k) => !V031_ROOT.includes(k)), ['DEFAULT_FEE_RATE'], `${label}: unexpected new exports`);
  assert.equal(mod.VERSION, '0.4.0');
  assert.equal(mod.WEBMCP_TREASURY, TREASURY);
  assert.equal(mod.PLATFORM_FEE_RATE, 0.01);
  assert.equal(mod.DEFAULT_FEE_RATE, 0);
  ok(`${label}: root exports = 0.3.1 set + DEFAULT_FEE_RATE`);
  for (const [p, names] of Object.entries(SUBPATHS)) {
    const m = await sub(p);
    for (const k of names) assert.equal(typeof m[k], 'function', `${label}: ${p}.${k}`);
  }
  ok(`${label}: subpaths middleware/verifier/discovery load`);

  // default: full amount, no fee fields
  const g0 = new PaymentGate({ merchantWallet: MERCHANT });
  const e0 = await g0.buildPaymentEnvelope(g0.require({ amount: '0.50', token: 'USDC', chain: 'base' }), 'r');
  assert.equal(e0.amount, '500000');
  assert.equal(e0.recipient, MERCHANT);
  assert.ok(!('feeRecipient' in e0) && !('feeAmount' in e0), 'default envelope must not carry fee fields');
  const r0 = await g0.protect(g0.require({ amount: '0.50', token: 'USDC', chain: 'base' }), async () => 1, 'r')(undefined);
  assert.equal(r0.status, 402);
  assert.ok(!('feeAmount' in r0.paymentRequired));
  ok(`${label}: default -> full amount 500000, no fee fields (buildPaymentEnvelope + protect 402)`);

  // opted in at 1%, no feeWallet -> treasury
  const g1 = new PaymentGate({ merchantWallet: MERCHANT, feeRate: 0.01 });
  const e1 = await g1.buildPaymentEnvelope(g1.require({ amount: '0.50', token: 'USDC', chain: 'base' }), 'r');
  assert.equal(e1.amount, '495000');
  assert.equal(e1.feeAmount, '5000');
  assert.equal(e1.feeRecipient, TREASURY);
  ok(`${label}: feeRate 0.01 -> amount 495000 + feeAmount 5000 to ${TREASURY}`);

  // opted in with own wallet
  const g2 = new PaymentGate({ merchantWallet: MERCHANT, feeRate: mod.PLATFORM_FEE_RATE, feeWallet: OWN });
  const e2 = await g2.buildPaymentEnvelope(g2.require({ amount: '10', token: 'USDC', chain: 'base' }), 'r');
  assert.equal(e2.amount, '9900000');
  assert.equal(e2.feeAmount, '100000');
  assert.equal(e2.feeRecipient, OWN);
  ok(`${label}: feeRate 1% + feeWallet override -> fee to override wallet`);

  assert.throws(() => new PaymentGate({ merchantWallet: MERCHANT, feeRate: 1 }), /feeRate/);
  ok(`${label}: invalid feeRate rejected`);
}

await check('ESM', await import('webmcp-payments'), (p) => import(`webmcp-payments/${p}`));
await check('CJS', require('webmcp-payments'), async (p) => require(`webmcp-payments/${p}`));
console.log(`\nall ${n} smoke checks passed`);
