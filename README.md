# webmcp-payments

Server-side helpers for charging AI agents in stablecoins over [x402](https://www.x402.org/) (HTTP 402 Payment Required) on EVM chains:

- **`PaymentGate`** wraps a tool handler or an Express route. If the caller hasn't paid, it answers `402` with an x402 payment envelope. If the caller sends a payment proof, it checks the transaction on-chain before running your handler.
- **`PaymentVerifier`** checks an ERC-20 `Transfer` on-chain (via [viem](https://viem.sh)) against a payment envelope.
- **`PaymentDiscovery`** publishes per-tool pricing in a WebMCP-style manifest so agents can see costs before calling.

Supported chains: `base`, `base-sepolia`, `arbitrum`, `optimism`. Tokens: `USDC` (all chains), `USDT` and `DAI` (not on `base-sepolia`).

**No platform fee is charged by default.** See [Fees](#fees).

## Install

```bash
npm install webmcp-payments viem
```

Node.js 18 or newer. Ships CommonJS and ESM builds with TypeScript types.

## Usage

### Gate a tool handler

```ts
import { PaymentGate } from 'webmcp-payments';

const gate = new PaymentGate({
  merchantWallet: '0xYourMerchantWallet',   // receives the payment
  chain: 'base',                            // default: 'base'
  acceptedTokens: ['USDC'],                 // default: ['USDC']
});

const premiumData = gate.protect(
  gate.require({ amount: '0.50', token: 'USDC', chain: 'base' }),
  async (input: { symbol: string }) => ({ symbol: input.symbol, price: 123 }),
  'premium-data'                            // resource id
);

const result = await premiumData({ symbol: 'ETH' });
// No payment yet -> { success: false, status: 402, paymentRequired: { protocol: 'x402', amount: '500000', recipient: '0xYourMerchantWallet', nonce, ... } }

// After the agent pays on-chain, call again with the proof:
await premiumData({ symbol: 'ETH' }, {
  paymentProof: { txHash: '0x…', chain: 'base', nonce: result.paymentRequired!.nonce, payer: '0xAgentWallet' },
});
// -> { success: true, status: 200, result: { … } } once the transfer is verified
```

Other pricing helpers: `gate.metered({ perUnit, unit, maxAmount?, token, chain })` and `gate.subscription({ amount, interval, token, chain })`. The envelope amount for metered pricing is one unit (`perUnit`).

### Express middleware

```ts
app.post('/api/premium', gate.express(gate.require({ amount: '0.50', token: 'USDC', chain: 'base' })), handler);
```

Without a valid proof the route answers `402` with `{ error: 'Payment Required', paymentRequired: <envelope> }`. The agent retries with these headers: `X-Payment-Tx`, `X-Payment-Chain`, `X-Payment-Nonce`, `X-Payment-Payer`. On success the middleware sets `X-Payment-Verified: true` and calls `next()`.

### Verify a payment yourself

```ts
import { PaymentVerifier } from 'webmcp-payments/verifier';

const verifier = new PaymentVerifier({ confirmations: 1, rpcUrls: { base: 'https://your-rpc' } });
const res = await verifier.verify(proof, envelope); // { verified: boolean, error?, txHash?, blockNumber? }
```

### Pricing discovery

```ts
import { createDiscovery } from 'webmcp-payments/discovery';

const discovery = createDiscovery({ defaultChain: 'base' });
discovery.register({ name: 'premium-data', description: 'Premium market data', pricing: gate.require({ amount: '0.50', token: 'USDC', chain: 'base' }) });
discovery.registerFree('ping', 'Health check');

discovery.toManifest();          // { version: '1', tools: [...], paymentConfig: { protocol: 'x402', ... } }
discovery.toDiscoveryResponse(); // { status: 200, headers, body } for e.g. GET /.well-known/webmcp
```

### Exports

| Entry point | Exports |
|---|---|
| `webmcp-payments` | `PaymentGate`, `extractProofFromHeaders`, `PaymentVerifier`, `PaymentDiscovery`, `createDiscovery`, `PLATFORM_FEE_RATE`, `DEFAULT_FEE_RATE`, `WEBMCP_TREASURY` (deprecated, unused), `CHAIN_CONFIGS`, `TOKEN_DECIMALS`, `toSmallestUnit`, `fromSmallestUnit`, `calculateFee`, `generateNonce`, `getTokenAddress`, `VERSION`, plus types |
| `webmcp-payments/middleware` | `PaymentGate`, `extractProofFromHeaders` |
| `webmcp-payments/verifier` | `PaymentVerifier` |
| `webmcp-payments/discovery` | `PaymentDiscovery`, `createDiscovery` |

## Fees

**The default fee is 0%.** With the default configuration the 402 envelope asks the agent to pay the full price to your `merchantWallet`, and it contains no `feeRecipient` or `feeAmount` fields. Nothing is sent to anyone else, and the package has no built-in fee destination.

**Charging a fee.** To add a fee you must pass **both** `feeRate` (greater than 0 and less than 1) **and** your own `feeWallet`:

```ts
const gate = new PaymentGate({
  merchantWallet: '0xYourMerchantWallet',
  feeRate: 0.01,                    // 1%
  feeWallet: '0xYourFeeWallet',     // required whenever feeRate > 0
});
```

Passing `feeRate > 0` without `feeWallet` throws `feeWallet is required when feeRate > 0`. With a fee, the envelope's `amount` is the price minus the fee (what the merchant receives), and the envelope adds `feeRecipient` (your `feeWallet`) and `feeAmount` (in the token's smallest unit). For a 0.50 USDC price at 1%: `amount: '495000'`, `feeAmount: '5000'`. With `feeRate` left out or set to 0, `feeWallet` is ignored.

**Change from 0.3.x.** Versions 0.3.0 and 0.3.1 applied an undocumented 1% fee by default, sent to `0xd7cF53B92A145A9EAFF210f56664865714F3D7BE` unless you overrode `feeWallet`/`feeRate`. From 0.4.0 the default is 0% and a fee only ever goes to a `feeWallet` you supply. The `WEBMCP_TREASURY` export still exists so old imports compile, but it's deprecated and unused; don't use it. See [CHANGELOG.md](./CHANGELOG.md).

## Security notes and known limitations

Read these before using the package with real funds.

- **Set `WEBMCP_ACCESS_TOKEN_SECRET`.** `PaymentGate` accepts session tokens (`X-Payment-Token` header / `context.accessToken`) signed with this environment variable. If it's unset, a built-in default secret is used, and anyone who knows it can mint a token that skips payment. Set it to a long random value in production.
- **Session tokens don't carry over.** Tokens returned after verification are signed by the gate's internal verifier with a random per-process secret, so they won't validate on later requests. Treat each request as needing its own proof.
- **No replay protection.** The library doesn't remember which transaction hashes it has already accepted, and the gate takes the nonce from the proof. Keep your own store of used `txHash` values and reject repeats.
- **The payer isn't checked.** `PaymentVerifier` checks that the merchant (and, if enabled, the fee wallet) received at least the expected amount, but doesn't check that the transfer came from `proof.payer`.
- **Fees aren't enforced on-chain.** If you configure a fee, a transaction that pays the merchant its net amount still verifies even without the fee transfer.
- No public source repository exists for this package. The published files include source maps with the full TypeScript source.

## License

MIT
