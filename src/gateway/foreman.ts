import { GatewayClient } from "@circle-fin/x402-batching/client";
import { rpcUrl } from "../config";

/**
 * The Foreman's Gateway wallet. `pay(url)` runs the whole x402 flow
 * (request → 402 → sign authorization → retry → settle) and debits the
 * Foreman's pre-deposited Gateway balance — real sub-cent USDC on Arc.
 */
export function createForemanGateway(privateKey: `0x${string}`): GatewayClient {
  return new GatewayClient({
    chain: "arcTestnet",
    privateKey,
    rpcUrl,
  });
}
