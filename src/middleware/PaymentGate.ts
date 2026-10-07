/**
 * PaymentGate — Server-side middleware
 *
 * Wraps any WebMCP tool with a payment requirement.
 * Returns HTTP 402 + x402 payment envelope when payment is needed.
 * Verifies on-chain payment before granting access.
 *
 * Compatible with:
 *   - @mcp-b/global polyfill (navigator.modelContext)
 *   - Native browser WebMCP (navigator.modelContext), where available
 *   - Express / Fastify / plain Node.js HTTP handlers
 *
 * Fees: none by default (feeRate 0). A platform fee is only added when the
 * integrator passes `feeRate > 0`; it goes to `feeWallet`, or to
 * WEBMCP_TREASURY if no feeWallet is given.
 */
import type {
  PaymentGateConfig,
  PricingConfig,
  PerCallPricing,
  MeteredPricing,
  SubscriptionPricing,
  X402PaymentEnvelope,
  PaymentProof,
  GatedToolResult,
  ToolHandler,
  RequestContext,
  SupportedChain,
  SupportedToken,
  PaymentEventHandler,
  PaymentEvent,
} from '../types/index.js';
import {
  WEBMCP_TREASURY,
  DEFAULT_FEE_RATE,
  getTokenAddress,
  toSmallestUnit,
  calculateFee,
  generateNonce,
  isValidAddress,
  isValidTxHash,
} from '../utils/chains.js';
import { verifyAccessToken } from '../utils/access-token.js';
import { PaymentVerifier } from '../verifier/PaymentVerifier.js';

const DEFAULT_PAYMENT_TTL = 300; // 5 minutes
const DEFAULT_CHAIN: SupportedChain = 'base';
const DEFAULT_TOKENS: SupportedToken[] = ['USDC'];

export class PaymentGate {
  private readonly config: Required<PaymentGateConfig>;
  private readonly verifier: PaymentVerifier;
  private readonly eventHandlers: PaymentEventHandler[] = [];

  constructor(config: PaymentGateConfig) {
    if (!isValidAddress(config.merchantWallet)) {
      throw new Error(`Invalid merchantWallet address: ${config.merchantWallet}`);
    }

    const feeRate = config.feeRate ?? DEFAULT_FEE_RATE;
    if (typeof feeRate !== 'number' || !Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) {
      throw new Error(`Invalid feeRate: ${String(config.feeRate)} (expected a number >= 0 and < 1, e.g. 0.01 for 1%)`);
    }
    if (config.feeWallet !== undefined && !isValidAddress(config.feeWallet)) {
      throw new Error(`Invalid feeWallet address: ${config.feeWallet}`);
    }

    this.config = {
      merchantWallet: config.merchantWallet,
      chain: config.chain ?? DEFAULT_CHAIN,
      acceptedTokens: config.acceptedTokens ?? DEFAULT_TOKENS,
      // Only used when feeRate > 0 (opt-in). Defaults to the WebMCP treasury.
      feeWallet: config.feeWallet ?? WEBMCP_TREASURY,
      feeRate,
      paymentTtl: config.paymentTtl ?? DEFAULT_PAYMENT_TTL,
      confirmations: config.confirmations ?? 1,
      rpcUrl: config.rpcUrl ?? '',
    };

    const rpcUrls: Partial<Record<SupportedChain, string>> = this.config.rpcUrl
      ? { [this.config.chain]: this.config.rpcUrl }
      : {};

    this.verifier = new PaymentVerifier({
      confirmations: this.config.confirmations,
      rpcUrls,
    });
  }

  // ─── Pricing model factories ─────────────────────────────────────────────

  /**
   * Require a fixed per-call payment
   *
   * @example
   * server.tool('premium-data', gate.require({ amount: '0.50', token: 'USDC' }), handler)
   */
  require(pricing: Omit<PerCallPricing, 'model'>): PerCallPricing {
    return {
      chain: pricing.chain ?? this.config.chain,
      token: pricing.token ?? (this.config.acceptedTokens[0] as SupportedToken) ?? 'USDC',
      model: 'per-call',
      amount: pricing.amount,
    };
  }

  /**
   * Metered pricing — charge per unit (tokens, requests, MB, etc.)
   */
  metered(pricing: Omit<MeteredPricing, 'model'>): MeteredPricing {
    return {
      chain: pricing.chain ?? this.config.chain,
      token: pricing.token ?? (this.config.acceptedTokens[0] as SupportedToken) ?? 'USDC',
      model: 'metered',
      perUnit: pricing.perUnit,
      unit: pricing.unit,
      ...(pricing.maxAmount !== undefined ? { maxAmount: pricing.maxAmount } : {}),
    };
  }

  /**
   * Subscription pricing — recurring payment
   */
  subscription(pricing: Omit<SubscriptionPricing, 'model'>): SubscriptionPricing {
    return {
      chain: pricing.chain ?? this.config.chain,
      token: pricing.token ?? (this.config.acceptedTokens[0] as SupportedToken) ?? 'USDC',
      model: 'subscription',
      amount: pricing.amount,
      interval: pricing.interval,
    };
  }

  // ─── Tool wrapping ────────────────────────────────────────────────────────

  /**
   * Wrap a tool handler with payment gating.
   * Returns a new handler that checks for payment before executing.
   *
   * @example
   * const gatedHandler = gate.protect(
   *   gate.require({ amount: '0.50', token: 'USDC' }),
   *   async (input) => fetchPremiumData(input)
   * );
   */
  protect<TInput, TOutput>(
    pricing: PricingConfig,
    handler: ToolHandler<TInput, TOutput>,
    resource?: string
  ): (input: TInput, context?: RequestContext) => Promise<GatedToolResult<TOutput>> {
    return async (input: TInput, context?: RequestContext): Promise<GatedToolResult<TOutput>> => {
      const resourceId = resource ?? `webmcp-tool-${Date.now()}`;

      // 1. Check for existing access token (session-based auth)
      if (context?.accessToken) {
        const tokenResult = verifyAccessToken(context.accessToken, this.getAccessTokenSecret());
        if (tokenResult.valid && tokenResult.payload?.resource === resourceId) {
          // Valid session — execute tool
          try {
            const result = await handler(input, context);
            return { success: true, result, status: 200 };
          } catch (err) {
            return { success: false, status: 500, error: String(err) };
          }
        }
      }

      // 2. Check for payment proof in context
      if (context?.paymentProof) {
        return this.handlePaymentProof(context.paymentProof, pricing, resourceId, input, handler);
      }

      // 3. No payment — return 402 with payment envelope
      const envelope = await this.buildPaymentEnvelope(pricing, resourceId);
      this.emit({ type: 'payment.required', timestamp: Date.now(), nonce: envelope.nonce });

      return {
        success: false,
        status: 402,
        paymentRequired: envelope,
      };
    };
  }

  /**
   * Build the x402 HTTP 402 response body
   */
  async buildPaymentEnvelope(
    pricing: PricingConfig,
    resource: string
  ): Promise<X402PaymentEnvelope> {
    const chain = pricing.chain ?? this.config.chain;
    const token = pricing.token ?? (this.config.acceptedTokens[0] as SupportedToken) ?? 'USDC';
    const amount = this.getAmount(pricing);

    const tokenAddress = getTokenAddress(chain, token);
    const amountSmallest = toSmallestUnit(amount, token);
    // Fee is opt-in: with the default feeRate of 0 the merchant is charged the
    // full amount and the envelope carries no fee fields.
    const feeEnabled = this.config.feeRate > 0;
    const feeAmount = feeEnabled ? calculateFee(amountSmallest, this.config.feeRate) : 0n;
    const netAmount = amountSmallest - feeAmount; // merchant receives net of any opted-in fee

    const chainConfig = await import('../utils/chains.js').then(m => m.CHAIN_CONFIGS[chain]);

    return {
      protocol: 'x402',
      version: '1',
      chain,
      chainId: chainConfig.chainId,
      tokenAddress,
      token,
      amount: netAmount.toString(),
      amountDecimal: amount,
      recipient: this.config.merchantWallet,
      ...(feeEnabled
        ? {
            feeRecipient: this.config.feeWallet as `0x${string}`,
            feeAmount: feeAmount.toString(),
          }
        : {}),
      nonce: generateNonce(),
      expiresAt: Math.floor(Date.now() / 1000) + this.config.paymentTtl,
      resource,
    };
  }

  /**
   * Verify a payment proof and return the result
   */
  async verifyPayment(
    proof: PaymentProof,
    envelope: X402PaymentEnvelope
  ): Promise<import('../types/index.js').VerificationResult> {
    this.emit({
      type: 'payment.received',
      timestamp: Date.now(),
      nonce: proof.nonce,
      txHash: proof.txHash,
      payer: proof.payer,
    });

    const result = await this.verifier.verify(proof, envelope);

    if (result.verified) {
      this.emit({
        type: 'payment.verified',
        timestamp: Date.now(),
        nonce: proof.nonce,
        txHash: proof.txHash,
        payer: proof.payer,
      });
    } else {
      this.emit({
        type: 'payment.failed',
        timestamp: Date.now(),
        nonce: proof.nonce,
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
    }

    return result;
  }

  /**
   * Subscribe to payment events
   */
  on(handler: PaymentEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    };
  }

  // ─── HTTP middleware adapters ─────────────────────────────────────────────

  /**
   * Express/Connect middleware factory
   *
   * @example
   * app.post('/api/premium-tool', gate.express(gate.require({ amount: '0.50', token: 'USDC' })), handler)
   */
  express(pricing: PricingConfig, resource?: string) {
    return async (req: ExpressLike, res: ExpressLikeRes, next: () => void): Promise<void> => {
      const resourceId = resource ?? req.path ?? '/';

      // Extract payment proof from headers
      const proof = extractProofFromHeaders(req.headers as Record<string, string>);
      const accessToken = (req.headers as Record<string, string>)['x-payment-token'];

      if (accessToken) {
        const tokenResult = verifyAccessToken(accessToken, this.getAccessTokenSecret());
        if (tokenResult.valid) {
          (req as unknown as Record<string, unknown>)['paymentVerified'] = true;
          next();
          return;
        }
      }

      if (proof) {
        const envelope = await this.buildPaymentEnvelope(pricing, resourceId);
        // Reuse nonce from proof's nonce (agent should have gotten envelope earlier)
        const fakeEnvelope = { ...envelope, nonce: proof.nonce };
        const result = await this.verifyPayment(proof, fakeEnvelope);
        if (result.verified) {
          res.setHeader('X-Payment-Verified', 'true');
          if (result.accessToken) {
            res.setHeader('X-Payment-Token', result.accessToken);
          }
          (req as unknown as Record<string, unknown>)['paymentVerified'] = true;
          next();
          return;
        }
      }

      // Return 402
      const envelope = await this.buildPaymentEnvelope(pricing, resourceId);
      res.status(402).json({
        error: 'Payment Required',
        paymentRequired: envelope,
      });
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async handlePaymentProof<TInput, TOutput>(
    proof: PaymentProof,
    pricing: PricingConfig,
    resource: string,
    input: TInput,
    handler: ToolHandler<TInput, TOutput>
  ): Promise<GatedToolResult<TOutput>> {
    const envelope = await this.buildPaymentEnvelope(pricing, resource);
    // Use the nonce from the proof — agent used the original envelope
    const envelopeWithProofNonce = { ...envelope, nonce: proof.nonce };

    const verifyResult = await this.verifyPayment(proof, envelopeWithProofNonce);

    if (!verifyResult.verified) {
      return {
        success: false,
        status: 402,
        ...(verifyResult.error !== undefined ? { error: verifyResult.error } : {}),
      };
    }

    try {
      const result = await handler(input, { paymentProof: proof });
      return { success: true, result, status: 200 };
    } catch (err) {
      return { success: false, status: 500, error: String(err) };
    }
  }

  private getAmount(pricing: PricingConfig): string {
    if (pricing.model === 'per-call') return pricing.amount;
    if (pricing.model === 'metered') return pricing.perUnit;
    if (pricing.model === 'subscription') return pricing.amount;
    return '0';
  }

  private getAccessTokenSecret(): string {
    // In production: load from env or config
    return process.env['WEBMCP_ACCESS_TOKEN_SECRET'] ?? 'webmcp-default-secret-change-me';
  }

  private emit(event: PaymentEvent): void {
    for (const handler of this.eventHandlers) {
      void handler(event);
    }
  }
}

// ─── Helper: extract PaymentProof from HTTP headers ───────────────────────

export function extractProofFromHeaders(
  headers: Record<string, string | string[] | undefined>
): PaymentProof | null {
  const txHash = headers['x-payment-tx'] ?? headers['x-payment-txhash'];
  const chain = headers['x-payment-chain'];
  const nonce = headers['x-payment-nonce'];
  const payer = headers['x-payment-payer'];

  if (!txHash || !chain || !nonce || !payer) return null;

  const txHashStr = Array.isArray(txHash) ? txHash[0] : txHash;
  const payerStr = Array.isArray(payer) ? payer[0] : payer;
  const nonceStr = Array.isArray(nonce) ? nonce[0] : nonce;
  const chainStr = Array.isArray(chain) ? chain[0] : chain;

  if (!txHashStr || !payerStr || !nonceStr || !chainStr) return null;
  if (!isValidTxHash(txHashStr)) return null;
  if (!isValidAddress(payerStr)) return null;

  return {
    txHash: txHashStr as `0x${string}`,
    chain: chainStr as SupportedChain,
    nonce: nonceStr,
    payer: payerStr as `0x${string}`,
  };
}

// ─── Minimal Express type stubs (no dep on @types/express) ────────────────
interface ExpressLike {
  path?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ExpressLikeRes {
  status(code: number): ExpressLikeRes;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}
