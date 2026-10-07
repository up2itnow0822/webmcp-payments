/**
 * Chain configurations for supported networks
 */
import type { ChainConfig, SupportedChain, SupportedToken } from '../types/index.js';

/**
 * @deprecated Do not use. Kept only so existing imports keep compiling.
 * Nothing in this package uses this address since 0.4.0: there is no default
 * fee destination. It was the implicit 1% fee recipient in 0.3.x. To charge a
 * fee, pass both `feeRate` and your own `feeWallet` to PaymentGate.
 */
export const WEBMCP_TREASURY = '0xd7cF53B92A145A9EAFF210f56664865714F3D7BE' as const;

/**
 * A 1% rate constant (0.01). Not applied by default: PaymentGate's default
 * feeRate is DEFAULT_FEE_RATE (0). If you pass it as `feeRate`, you must also
 * pass your own `feeWallet`.
 */
export const PLATFORM_FEE_RATE = 0.01;

/** Default fee rate used by PaymentGate: 0 (no fee). */
export const DEFAULT_FEE_RATE = 0;

// ─── USDC decimals ────────────────────────────────────────────────────────
export const TOKEN_DECIMALS: Record<SupportedToken, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
};

// ─── Chain configs ────────────────────────────────────────────────────────
export const CHAIN_CONFIGS: Record<SupportedChain, ChainConfig> = {
  'base': {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    tokens: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    },
  },
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    tokens: {
      USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
  },
  'arbitrum': {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    tokens: {
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
  },
  'optimism': {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    tokens: {
      USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
  },
};

/**
 * Get token address for a given chain and token
 */
export function getTokenAddress(
  chain: SupportedChain,
  token: SupportedToken
): `0x${string}` {
  const config = CHAIN_CONFIGS[chain];
  const address = config.tokens[token];
  if (!address) {
    throw new Error(`Token ${token} not supported on chain ${chain}`);
  }
  return address;
}

/**
 * Convert decimal amount string to smallest unit (bigint)
 * e.g., "0.50" USDC → 500000n (6 decimals)
 */
export function toSmallestUnit(amount: string, token: SupportedToken): bigint {
  const decimals = TOKEN_DECIMALS[token];
  const [whole, frac = ''] = amount.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${fracPadded}`;
  return BigInt(combined);
}

/**
 * Convert smallest unit bigint to decimal string
 * e.g., 500000n → "0.500000" (USDC)
 */
export function fromSmallestUnit(amount: bigint, token: SupportedToken): string {
  const decimals = TOKEN_DECIMALS[token];
  const str = amount.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, str.length - decimals) || '0';
  const frac = str.slice(str.length - decimals);
  return `${whole}.${frac}`;
}

/**
 * Calculate a fee amount for a given rate.
 * Pure helper: it computes a number and charges nothing. If `feeRate` is
 * omitted it uses PLATFORM_FEE_RATE (1%), unchanged from 0.3.x.
 */
export function calculateFee(amount: bigint, feeRate: number = PLATFORM_FEE_RATE): bigint {
  // Use integer arithmetic to avoid floating point issues
  // feeRate = 0.01 → multiply by 100, divide by 10000
  const feeRateBps = Math.round(feeRate * 10000); // basis points * 100
  return (amount * BigInt(feeRateBps)) / 10000n;
}

/**
 * Generate a cryptographically random nonce
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate an Ethereum address
 */
export function isValidAddress(address: string): address is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Validate a transaction hash
 */
export function isValidTxHash(hash: string): hash is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}
