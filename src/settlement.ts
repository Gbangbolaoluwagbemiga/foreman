import { createWalletClient, createPublicClient, http, erc20Abi, parseUnits } from "viem";
import { arcTestnet, config, USDC_DECIMALS } from "./config";
import type { AgentSigner } from "./signer";

export interface PaymentRequest {
  from: AgentSigner;
  to: `0x${string}`;
  amountUsdc: number;
  memo: string;
}

export interface PaymentReceipt {
  ref: string;
  settled: boolean;
  rail: string;
  amountUsdc: number;
}

/** A payment rail. Mock today, Circle Gateway / x402 later — same interface. */
export interface Settlement {
  readonly rail: string;
  pay(req: PaymentRequest): Promise<PaymentReceipt>;
}

/** Instant, free, no funds. Lets the whole economy run locally for demos and tests. */
export class MockSettlement implements Settlement {
  readonly rail = "mock";
  async pay(req: PaymentRequest): Promise<PaymentReceipt> {
    const ref = `mock-0x${Math.random().toString(16).slice(2, 10)}`;
    return { ref, settled: true, rail: this.rail, amountUsdc: req.amountUsdc };
  }
}

/**
 * Real sub-cent USDC transfers on Arc Testnet via viem.
 * (Circle Gateway batching — which makes sub-cent economically viable by
 * batching many authorizations into one settlement — slots in here next.)
 */
export class ArcUsdcSettlement implements Settlement {
  readonly rail = "arc-usdc";
  private publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

  async pay(req: PaymentRequest): Promise<PaymentReceipt> {
    const walletClient = createWalletClient({
      account: req.from.account,
      chain: arcTestnet,
      transport: http(),
    });
    const value = parseUnits(req.amountUsdc.toString(), USDC_DECIMALS);
    const hash = await walletClient.writeContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [req.to, value],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { ref: hash, settled: true, rail: this.rail, amountUsdc: req.amountUsdc };
  }
}

export function createSettlement(): Settlement {
  return config.settlementRail === "arc-usdc" ? new ArcUsdcSettlement() : new MockSettlement();
}
