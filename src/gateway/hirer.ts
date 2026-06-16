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
    try {
      const result = await gateway.pay<{ deliverable?: string }>(url, {
        method: "POST",
        body: { task, context },
      });
      // Gateway settles in gas-free batches, so pay() rarely returns an L1 hash
      // synchronously. The durable, verifiable artifact is the Circle transfer
      // RECORD: look it up by recipient + amount right after paying and surface
      // its UUID as the payment reference (queryable via /transfer → getTransferById).
      let ref = result.transaction?.startsWith("0x") ? result.transaction : `gw:${result.formattedAmount}`;
      try {
        const found = await gateway.searchTransfers({
          from: gateway.address as `0x${string}`,
          to: member.walletAddress as `0x${string}`,
          pageSize: 1,
        });
        const t = found.transfers?.[0];
        // match the just-settled payment by amount (atomic units, 6dp)
        if (t && Number(t.amount) === Math.round(Number(result.formattedAmount) * 1e6)) ref = t.id;
      } catch {
        /* search is best-effort — keep the gw: fallback */
      }
      return {
        deliverable: result.data?.deliverable ?? "(delivered by external agent)",
        paymentRef: ref,
        amountUsdc: Number(result.formattedAmount),
        recipient: member.walletAddress,
      };
    } catch (e) {
      // A flaky external/registered endpoint must never crash the job — no pay, no charge.
      return {
        deliverable: `⚠ ${member.name} was unavailable: ${((e as Error).message.split("\n")[0] ?? "error").slice(0, 80)}`,
        paymentRef: "unpaid",
        amountUsdc: 0,
      };
    }
  };
}
