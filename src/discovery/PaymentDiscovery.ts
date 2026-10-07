/**
 * PaymentDiscovery — Extends WebMCP tool metadata with pricing info
 *
 * Agents discover tool costs BEFORE calling them, enabling:
 * - Budget-aware agent planning
 * - Cost comparison across services
 * - Headless payment flows with zero human interaction
 *
 * Compatible with @mcp-b/global polyfill and native navigator.modelContext where available
 */
import type {
  WebMCPToolMetadata,
  PaymentMetadata,
  PricingConfig,
  SupportedChain,
  SupportedToken,
} from '../types/index.js';
import { CHAIN_CONFIGS } from '../utils/chains.js';

export interface DiscoveryConfig {
  /** Default chain for all tools */
  defaultChain?: SupportedChain;
  /** Default accepted tokens */
  defaultTokens?: SupportedToken[];
  /** Base URL of the API (used to build tool endpoint URLs) */
  baseUrl?: string;
}

export interface ToolRegistration {
  name: string;
  description: string;
  pricing: PricingConfig;
  inputSchema?: Record<string, unknown>;
  endpoint?: string;
}

export class PaymentDiscovery {
  private readonly tools: Map<string, WebMCPToolMetadata> = new Map();
  private readonly config: Required<DiscoveryConfig>;

  constructor(config: DiscoveryConfig = {}) {
    this.config = {
      defaultChain: config.defaultChain ?? 'base',
      defaultTokens: config.defaultTokens ?? ['USDC'],
      baseUrl: config.baseUrl ?? '',
    };
  }

  /**
   * Register a tool with its pricing metadata
   */
  register(registration: ToolRegistration): this {
    const payment = this.buildPaymentMetadata(registration.pricing);

    const metadata: WebMCPToolMetadata = {
      name: registration.name,
      description: registration.description,
      ...(registration.inputSchema !== undefined ? { inputSchema: registration.inputSchema } : {}),
      payment,
    };

    this.tools.set(registration.name, metadata);
    return this;
  }

  /**
   * Get metadata for a single tool
   */
  getTool(name: string): WebMCPToolMetadata | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools with payment metadata
   */
  getAllTools(): WebMCPToolMetadata[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools that are free (no payment required)
   */
  getFreeTools(): WebMCPToolMetadata[] {
    return this.getAllTools().filter(t => !t.payment?.required);
  }

  /**
   * Get tools that require payment
   */
  getPaidTools(): WebMCPToolMetadata[] {
    return this.getAllTools().filter(t => t.payment?.required === true);
  }

  /**
   * Generate WebMCP-compatible tool manifest (navigator.modelContext format)
   * Compatible with @mcp-b/global polyfill spec
   */
  toManifest(): WebMCPManifest {
    const chainId = CHAIN_CONFIGS[this.config.defaultChain].chainId;

    return {
      version: '1',
      tools: this.getAllTools().map(tool => {
        const entry: { name: string; description: string; inputSchema: Record<string, unknown>; payment?: PaymentMetadata } = {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        };
        if (tool.payment !== undefined) entry.payment = tool.payment;
        return entry;
      }),
      paymentConfig: {
        defaultChain: this.config.defaultChain,
        defaultChainId: chainId,
        acceptedTokens: this.config.defaultTokens,
        protocol: 'x402',
      },
    };
  }

  /**
   * Serialize to JSON (for HTTP response or navigator.modelContext.tools)
   */
  toJSON(): string {
    return JSON.stringify(this.toManifest(), null, 2);
  }

  /**
   * Generate HTTP handler response for tool discovery endpoint
   * Agents call GET /.well-known/webmcp to discover tools
   */
  toDiscoveryResponse(): {
    status: 200;
    headers: Record<string, string>;
    body: string;
  } {
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-WebMCP-Version': '1',
        'Cache-Control': 'public, max-age=60',
      },
      body: this.toJSON(),
    };
  }

  /**
   * Build payment metadata from pricing config
   */
  private buildPaymentMetadata(pricing: PricingConfig): PaymentMetadata {
    const base = {
      required: true,
      model: pricing.model,
      token: pricing.token,
      chain: pricing.chain ?? this.config.defaultChain,
    };

    switch (pricing.model) {
      case 'per-call':
        return { ...base, model: 'per-call', amount: pricing.amount };
      case 'metered':
        return { ...base, model: 'metered', perUnit: pricing.perUnit, unit: pricing.unit };
      case 'subscription':
        return { ...base, model: 'subscription', amount: pricing.amount, interval: pricing.interval };
      default: {
        const _exhaustive: never = pricing;
        return base as PaymentMetadata;
      }
    }
  }

  /**
   * Register a free tool (no payment required)
   */
  registerFree(name: string, description: string, inputSchema?: Record<string, unknown>): this {
    const metadata: WebMCPToolMetadata = {
      name,
      description,
      ...(inputSchema !== undefined ? { inputSchema } : {}),
      payment: { required: false, model: 'per-call' },
    };
    this.tools.set(name, metadata);
    return this;
  }

  /**
   * Remove a tool from discovery
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Estimate cost for a given tool and units
   */
  estimateCost(toolName: string, units?: number): string | null {
    const tool = this.getTool(toolName);
    if (!tool) return null;
    if (!tool.payment?.required) return '0';

    const { payment } = tool;
    if (payment.model === 'per-call') return payment.amount ?? '0';
    if (payment.model === 'metered' && payment.perUnit && units) {
      const perUnit = parseFloat(payment.perUnit);
      return (perUnit * units).toFixed(6);
    }
    if (payment.model === 'subscription') return payment.amount ?? '0';

    return null;
  }
}

// ─── Manifest types ────────────────────────────────────────────────────────

export interface WebMCPManifest {
  version: '1';
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    payment?: PaymentMetadata;
  }>;
  paymentConfig: {
    defaultChain: SupportedChain;
    defaultChainId: number;
    acceptedTokens: SupportedToken[];
    protocol: 'x402';
  };
}

// ─── Singleton factory ─────────────────────────────────────────────────────

/**
 * Create a discovery instance pre-configured for Base mainnet + USDC
 */
export function createDiscovery(config?: DiscoveryConfig): PaymentDiscovery {
  return new PaymentDiscovery(config);
}
