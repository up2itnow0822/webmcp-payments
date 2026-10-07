/**
 * @webmcp/payments — Core Types
 * x402 payment protocol types for WebMCP agent payment acceptance
 */
export type SupportedChain = 'base' | 'base-sepolia' | 'arbitrum' | 'optimism';
export type SupportedToken = 'USDC' | 'USDT' | 'DAI';
export type PricingModel = 'per-call' | 'metered' | 'subscription';
export interface PerCallPricing {
    model: 'per-call';
    amount: string;
    token: SupportedToken;
    chain: SupportedChain;
}
export interface MeteredPricing {
    model: 'metered';
    perUnit: string;
    unit: string;
    token: SupportedToken;
    chain: SupportedChain;
    maxAmount?: string;
}
export interface SubscriptionPricing {
    model: 'subscription';
    amount: string;
    token: SupportedToken;
    chain: SupportedChain;
    interval: 'day' | 'week' | 'month' | 'year';
}
export type PricingConfig = PerCallPricing | MeteredPricing | SubscriptionPricing;
export interface X402PaymentEnvelope {
    /** Always "x402" — identifies this as an x402 payment request */
    protocol: 'x402';
    /** Protocol version */
    version: '1';
    /** Chain identifier */
    chain: SupportedChain;
    /** EVM chain ID */
    chainId: number;
    /** Token contract address */
    tokenAddress: `0x${string}`;
    /** Token symbol */
    token: SupportedToken;
    /** Amount in token's smallest unit (e.g., USDC has 6 decimals) */
    amount: string;
    /** Human-readable amount (e.g., "0.50") */
    amountDecimal: string;
    /** Merchant's receiving wallet address */
    recipient: `0x${string}`;
    /** Platform fee wallet address */
    feeRecipient: `0x${string}`;
    /** Platform fee amount in smallest unit */
    feeAmount: string;
    /** Unique nonce to prevent replay attacks */
    nonce: string;
    /** Unix timestamp (seconds) when this payment request expires */
    expiresAt: number;
    /** Resource identifier — what is being purchased */
    resource: string;
    /** Optional: human-readable description */
    description?: string;
    /** Optional: memo attached to the payment */
    memo?: string;
}
export interface PaymentProof {
    /** Transaction hash on-chain */
    txHash: `0x${string}`;
    /** Chain where payment was made */
    chain: SupportedChain;
    /** Original payment envelope nonce (ties proof to request) */
    nonce: string;
    /** Agent's wallet address */
    payer: `0x${string}`;
    /** Optional: block number of the transaction */
    blockNumber?: bigint;
}
export interface VerificationResult {
    verified: boolean;
    txHash?: `0x${string}`;
    blockNumber?: bigint;
    confirmations?: number;
    error?: string;
    /** Access token issued after successful verification */
    accessToken?: string;
    /** When the access token expires (for session-based access) */
    accessTokenExpiresAt?: number;
}
export interface PaymentGateConfig {
    /** Merchant's receiving wallet address */
    merchantWallet: `0x${string}`;
    /** Default chain for payments */
    chain?: SupportedChain;
    /** Accepted tokens */
    acceptedTokens?: SupportedToken[];
    /** Platform fee wallet (defaults to WebMCP treasury) */
    feeWallet?: `0x${string}`;
    /** Platform fee rate (default: 0.01 = 1%) */
    feeRate?: number;
    /** Payment request TTL in seconds (default: 300 = 5 min) */
    paymentTtl?: number;
    /** Block confirmations required (default: 1) */
    confirmations?: number;
    /** Custom RPC URL for the chain */
    rpcUrl?: string;
}
export type ToolHandler<TInput = unknown, TOutput = unknown> = (input: TInput, context?: RequestContext) => Promise<TOutput>;
export interface RequestContext {
    /** HTTP headers from the incoming request */
    headers?: Record<string, string>;
    /** Payment proof from the agent (if provided) */
    paymentProof?: PaymentProof;
    /** Verified access token (if using session-based auth) */
    accessToken?: string;
}
export interface GatedToolResult<T = unknown> {
    /** True if payment was verified and tool executed */
    success: boolean;
    /** Tool output (only present if success = true) */
    result?: T;
    /** HTTP status code to return */
    status: 200 | 402 | 400 | 500;
    /** x402 payment envelope (only present if status = 402) */
    paymentRequired?: X402PaymentEnvelope;
    /** Error message (only present if success = false) */
    error?: string;
}
export interface PaymentMetadata {
    required: boolean;
    model: PricingModel;
    amount?: string;
    token?: SupportedToken;
    chain?: SupportedChain;
    /** For metered: cost per unit */
    perUnit?: string;
    unit?: string;
    /** For subscription: billing interval */
    interval?: 'day' | 'week' | 'month' | 'year';
    /** Human-readable description of what you get */
    description?: string;
}
export interface WebMCPToolMetadata {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    payment?: PaymentMetadata;
}
export interface ChainConfig {
    chainId: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    tokens: {
        USDC: `0x${string}`;
        USDT?: `0x${string}`;
        DAI?: `0x${string}`;
    };
}
export interface PaymentEvent {
    type: 'payment.required' | 'payment.received' | 'payment.verified' | 'payment.failed';
    timestamp: number;
    nonce: string;
    txHash?: `0x${string}`;
    amount?: string;
    token?: SupportedToken;
    payer?: `0x${string}`;
    error?: string;
}
export type PaymentEventHandler = (event: PaymentEvent) => void | Promise<void>;

