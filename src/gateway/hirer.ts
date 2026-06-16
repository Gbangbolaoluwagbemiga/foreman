import type { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hirer } from "../orchestrator";

/**
 * A real-money Hirer: the Foreman pays each crew member via Circle Gateway.
 * `gateway.pay()` runs the full x402 flow (402 → sign → retry → settle) and the
 * crew's seller endpoint returns the deliverable once payment settles on Arc.
 */
export function gatewayHire(gateway: GatewayClient, crewBaseUrl: string): Hirer {
  return async (member, task, context) => {
    // External registered agents are paid at their own x402 endpoint (cross-boundary);
    // hosted agents are paid at our crew server. Either way, USDC settles to their wallet.
    const url = member.endpointUrl || `${crewBaseUrl}/crew/${member.id}`;
    const result = await gateway.pay<{ deliverable?: string }>(url, {
      method: "POST",
      body: { task, context },
    });
    return {
      deliverable: result.data?.deliverable ?? "(delivered by external agent)",
      paymentRef: `gw:${result.formattedAmount}`,
      amountUsdc: Number(result.formattedAmount),
    };
  };
}
