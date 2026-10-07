/**
 * PaymentVerifier — On-chain payment verification
 *
 * Verifies USDC/ERC-20 transfers on Base (and other EVM chains) using viem.
 * Server-side only — NEVER trust client claims about payment.
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  type PublicClient,
  type Log,
  type Address,
} from 'viem';
import { base, baseSepolia, arbitrum, optimism } from 'viem/chains';

import type {
  PaymentProof,
  VerificationResult,
  X402PaymentEnvelope,
  SupportedChain,
} from '../types/index.js';
import {
  CHAIN_CONFIGS,
  isValidTxHash,
  isValidAddress,
} from '../utils/chains.js';
import { issueAccessToken } from '../utils/access-token.js';

// ─── ERC-20 Transfer event ABI ─────────────────────────────────────────────
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

// ─── Viem chain map ────────────────────────────────────────────────────────
const VIEM_CHAINS = {
  'base': base,
  'base-sepolia': baseSepolia,
  'arbitrum': arbitrum,
  'optimism': optimism,
} as const;

export interface PaymentVerifierConfig {
  /** Block confirmations required before considering payment final */
  confirmations?: number;
  /** Custom RPC URLs per chain */
  rpcUrls?: Partial<Record<SupportedChain, string>>;
  /** Secret for signing access tokens */
  accessTokenSecret?: string;
  /** Access token TTL in seconds (default: 3600) */
  accessTokenTtl?: number;
  /** Max age of payment proof in seconds (default: 600 = 10 min) */
  maxProofAge?: number;
  /**
   * Optional client factory — inject for testing or custom RPC providers.
   * Defaults to viem createPublicClient.
   */
  clientFactory?: (chain: SupportedChain, rpcUrl: string) => PublicClient;
}

export class PaymentVerifier {
  private clients: Map<SupportedChain, PublicClient> = new Map();
  readonly config: Required<PaymentVerifierConfig>;

  constructor(config: PaymentVerifierConfig = {}) {
    this.config = {
      confirmations: config.confirmations ?? 1,
      rpcUrls: config.rpcUrls ?? {},
      accessTokenSecret: config.accessTokenSecret ?? this.generateSecret(),
      accessTokenTtl: config.accessTokenTtl ?? 3600,
      maxProofAge: config.maxProofAge ?? 600,
      clientFactory: config.clientFactory ?? this.defaultClientFactory.bind(this),
    };
  }

  /**
   * Verify a payment proof against the original payment envelope.
   * This is the primary method — call it after receiving proof from agent.
   */
  async verify(
    proof: PaymentProof,
    envelope: X402PaymentEnvelope
  ): Promise<VerificationResult> {
    // 1. Basic input validation
    const validationError = this.validateInputs(proof, envelope);
    if (validationError) {
      return { verified: false, error: validationError };
    }

    // 2. Check nonce matches
    if (proof.nonce !== envelope.nonce) {
      return { verified: false, error: 'Nonce mismatch — payment proof does not match request' };
    }

    // 3. Check chain matches
    if (proof.chain !== envelope.chain) {
      return { verified: false, error: `Chain mismatch: proof=${proof.chain}, expected=${envelope.chain}` };
    }

    // 4. Check envelope has not expired
    const now = Math.floor(Date.now() / 1000);
    if (now > envelope.expiresAt) {
      return { verified: false, error: 'Payment envelope has expired — request new payment' };
    }

    // 5. Get on-chain transaction receipt
    const client = this.getClient(proof.chain);

    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
    try {
      receipt = await client.getTransactionReceipt({ hash: proof.txHash });
    } catch (err) {
      return { verified: false, error: `Transaction not found: ${proof.txHash}` };
    }

    // 6. Check transaction succeeded
    if (receipt.status !== 'success') {
      return { verified: false, error: 'Transaction reverted on-chain' };
    }

    // 7. Check confirmations
    if (this.config.confirmations > 0) {
      const currentBlock = await client.getBlockNumber();
      const confirmations = Number(currentBlock - receipt.blockNumber);
      if (confirmations < this.config.confirmations) {
        return {
          verified: false,
          error: `Insufficient confirmations: ${confirmations}/${this.config.confirmations}`,
          blockNumber: receipt.blockNumber,
          confirmations,
        };
      }
    }

    // 8. Parse Transfer logs and verify amounts/recipients
    const chainConfig = CHAIN_CONFIGS[proof.chain];
    const tokenAddress = chainConfig.tokens[envelope.token];
    if (!tokenAddress) {
      return { verified: false, error: `Token ${envelope.token} not configured for ${proof.chain}` };
    }

    const transferLogs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === tokenAddress.toLowerCase()
    );

    const verifyResult = this.verifyTransferLogs(transferLogs, envelope, proof.payer);
    if (!verifyResult.ok) {
      return { verified: false, ...(verifyResult.error !== undefined ? { error: verifyResult.error } : {}) };
    }

    // 9. Issue access token
    const { token: accessToken, expiresAt } = issueAccessToken(
      envelope.nonce,
      proof.txHash,
      proof.payer,
      envelope.resource,
      this.config.accessTokenSecret,
      this.config.accessTokenTtl
    );

    return {
      verified: true,
      txHash: proof.txHash,
      blockNumber: receipt.blockNumber,
      confirmations: this.config.confirmations,
      accessToken,
      accessTokenExpiresAt: expiresAt,
    };
  }

  /**
   * Verify a payment using only a tx hash (simpler flow without full envelope)
   */
  async verifyTxHash(
    txHash: `0x${string}`,
    chain: SupportedChain,
    expectedRecipient: `0x${string}`,
    expectedAmount: bigint,
    tokenAddress: `0x${string}`
  ): Promise<VerificationResult> {
    if (!isValidTxHash(txHash)) {
      return { verified: false, error: 'Invalid transaction hash format' };
    }

    const client = this.getClient(chain);

    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch {
      return { verified: false, error: `Transaction not found: ${txHash}` };
    }

    if (receipt.status !== 'success') {
      return { verified: false, error: 'Transaction reverted' };
    }

    // Check for Transfer event to recipient with correct amount
    const matchingLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) return false;
      if (log.topics.length < 3) return false;

      // Transfer(address from, address to, uint256 value)
      // topics[0] = event sig, topics[1] = from, topics[2] = to
      const toAddress = `0x${log.topics[2]?.slice(26)}`;
      if (toAddress.toLowerCase() !== expectedRecipient.toLowerCase()) return false;

      // Parse value from data
      const value = BigInt(log.data);
      return value >= expectedAmount;
    });

    if (!matchingLog) {
      return { verified: false, error: 'No matching Transfer event found in transaction' };
    }

    return {
      verified: true,
      txHash,
      blockNumber: receipt.blockNumber,
    };
  }

  /**
   * Get or create a viem public client for a chain
   */
  private getClient(chain: SupportedChain): PublicClient {
    if (!this.clients.has(chain)) {
      const chainConfig = CHAIN_CONFIGS[chain];
      const rpcUrl = this.config.rpcUrls[chain] ?? chainConfig.rpcUrl;
      const client = this.config.clientFactory(chain, rpcUrl);
      this.clients.set(chain, client);
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.clients.get(chain)!;
  }

  /**
   * Default viem client factory
   */
  private defaultClientFactory(chain: SupportedChain, rpcUrl: string): PublicClient {
    const viemChain = VIEM_CHAINS[chain];
    return createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  /**
   * Verify Transfer logs match the payment envelope
   */
  private verifyTransferLogs(
    logs: Log[],
    envelope: X402PaymentEnvelope,
    payer: `0x${string}`
  ): { ok: boolean; error?: string } {
    const expectedAmount = BigInt(envelope.amount);
    const expectedFee = BigInt(envelope.feeAmount);
    const totalExpected = expectedAmount + expectedFee;

    // Look for a transfer to merchant (net amount after fee)
    // OR total amount (if fee split happens in contract)
    const merchantTransfer = logs.find((log) => {
      if (log.topics.length < 3) return false;
      const toAddress = `0x${log.topics[2]?.slice(26)}` as Address;
      if (toAddress.toLowerCase() !== envelope.recipient.toLowerCase()) return false;
      const value = BigInt(log.data);
      // Accept if merchant received at least the net amount
      return value >= expectedAmount;
    });

    // Also check for fee transfer to platform
    const feeTransfer = logs.find((log) => {
      if (log.topics.length < 3) return false;
      const toAddress = `0x${log.topics[2]?.slice(26)}` as Address;
      if (toAddress.toLowerCase() !== envelope.feeRecipient.toLowerCase()) return false;
      const value = BigInt(log.data);
      return value >= expectedFee;
    });

    // Case 1: Both merchant and fee transfers present (smart contract split)
    if (merchantTransfer && feeTransfer) {
      return { ok: true };
    }

    // Case 2: Single transfer of full amount to merchant
    // (merchant collects fee themselves, or fee is 0)
    if (merchantTransfer) {
      const transferredValue = BigInt(merchantTransfer.data);
      if (transferredValue >= totalExpected) {
        return { ok: true };
      }
      // Merchant got net amount but no separate fee transfer — acceptable
      // if fee enforcement is at contract level
      if (transferredValue >= expectedAmount) {
        return { ok: true };
      }
    }

    if (!merchantTransfer) {
      return {
        ok: false,
        error: `No Transfer to merchant ${envelope.recipient} found in transaction`,
      };
    }

    return { ok: false, error: 'Transfer amount insufficient' };
  }

  /**
   * Validate basic format of proof and envelope
   */
  private validateInputs(
    proof: PaymentProof,
    envelope: X402PaymentEnvelope
  ): string | null {
    if (!isValidTxHash(proof.txHash)) {
      return 'Invalid transaction hash format';
    }
    if (!isValidAddress(proof.payer)) {
      return 'Invalid payer address format';
    }
    if (!isValidAddress(envelope.recipient)) {
      return 'Invalid recipient address in envelope';
    }
    if (!envelope.nonce || envelope.nonce.length < 4) {
      return 'Invalid nonce in envelope';
    }
    return null;
  }

  /**
   * Generate a fallback secret (should be replaced with a persistent secret in production)
   */
  private generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
