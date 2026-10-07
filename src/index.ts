/**
 * webmcp-payments — Agent payment acceptance layer for websites
 *
 * Phase 1: Core payment gate, on-chain verification, tool discovery
 *
 * @example
 * ```typescript
 * import { PaymentGate, PaymentDiscovery } from 'webmcp-payments';
 *
 * const gate = new PaymentGate({
 *   merchantWallet: '0xYourWallet',
 *   chain: 'base',
 *   acceptedTokens: ['USDC'],
 * });
 *
 * const discovery = new PaymentDiscovery({ defaultChain: 'base' });
 * discovery.register({
 *   name: 'premium-data',
 *   description: 'Get premium market analysis',
 *   pricing: gate.require({ amount: '0.50', token: 'USDC' }),
 * });
 * ```
 */

// ─── Core classes ──────────────────────────────────────────────────────────
export { PaymentGate, extractProofFromHeaders } from './middleware/PaymentGate.js';
export { PaymentVerifier } from './verifier/PaymentVerifier.js';
export { PaymentDiscovery, createDiscovery } from './discovery/PaymentDiscovery.js';

// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  // Chain & token
  SupportedChain,
  SupportedToken,
  // Pricing
  PricingModel,
  PricingConfig,
  PerCallPricing,
  MeteredPricing,
  SubscriptionPricing,
  // x402 protocol
  X402PaymentEnvelope,
  PaymentProof,
  VerificationResult,
  // Gate
  PaymentGateConfig,
  GatedToolResult,
  ToolHandler,
  RequestContext,
  // Discovery
  WebMCPToolMetadata,
  PaymentMetadata,
  // Events
  PaymentEvent,
  PaymentEventHandler,
} from './types/index.js';

export type { PaymentVerifierConfig } from './verifier/PaymentVerifier.js';
export type { DiscoveryConfig, ToolRegistration, WebMCPManifest } from './discovery/PaymentDiscovery.js';

// ─── Constants ─────────────────────────────────────────────────────────────
export {
  WEBMCP_TREASURY,
  PLATFORM_FEE_RATE,
  DEFAULT_FEE_RATE,
  CHAIN_CONFIGS,
  TOKEN_DECIMALS,
  toSmallestUnit,
  fromSmallestUnit,
  calculateFee,
  generateNonce,
  getTokenAddress,
} from './utils/chains.js';

// ─── Version ───────────────────────────────────────────────────────────────
export const VERSION = '0.4.0';
