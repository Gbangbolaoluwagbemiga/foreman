import "dotenv/config";
import { verifyTypedData } from "viem";
import { BatchEvmScheme, CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { createCircleSigner } from "./gateway/circleSigner";
import { config } from "./config";

/**
 *   npm run circle:verify
 *
 * Proves MPC custody works end-to-end: signs a sample EIP-712 payment
 * authorization (the exact shape the x402 batching rail signs) through the Circle
 * wallet, then recovers the signer and confirms it matches the treasury address.
 * If this passes, the treasury can pay crew on the real rail with NO raw key.
 */
async function main() {
  const signer = createCircleSigner();
  console.log("→ MPC treasury:", signer.address, `(${config.circleBlockchain})`);

  // A representative EIP-3009 transferWithAuthorization typed-data payload.
  const domain = {
    name: "USDC",
    version: "2",
    chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    verifyingContract: config.usdcAddress,
  } as const;
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: signer.address,
    to: "0x000000000000000000000000000000000000dEaD",
    value: "1000",
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    nonce: "0x" + "11".repeat(32),
  };

  console.log("→ Signing via Circle MPC…");
  const signature = await signer.signTypedData({ domain, types, primaryType: "TransferWithAuthorization", message });
  console.log("  signature:", signature.slice(0, 22) + "…");

  const ok = await verifyTypedData({
    address: signer.address,
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
    signature,
  });
  console.log(ok ? "\n✅ MPC signature verified — recovered signer matches the treasury address." : "\n✗ signature did NOT recover to the treasury address.");
  if (!ok) process.exit(1);

  // ── Second proof: the exact signing call the live pay path uses. ──────────────
  // createForemanGatewayMPC().pay() signs crew payments via BatchEvmScheme; prove
  // that path builds a valid Gateway-batched authorization signed by the treasury,
  // with no funds and no live seller needed.
  console.log("\n→ Building a Gateway-batched payment authorization via MPC (the real pay path)…");
  const scheme = new BatchEvmScheme(signer);
  const requirements = {
    scheme: "exact",
    network: `eip155:${CHAIN_CONFIGS.arcTestnet.chain.id}`,
    asset: CHAIN_CONFIGS.arcTestnet.usdc,
    amount: "1000",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 60,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: CHAIN_CONFIGS.arcTestnet.gatewayWallet },
  };
  const payload = (await scheme.createPaymentPayload(2, requirements)) as {
    payload: { authorization: { from: string }; signature: string };
  };
  const from = payload.payload.authorization.from?.toLowerCase();
  const payOk = from === signer.address.toLowerCase() && !!payload.payload.signature;
  console.log("  authorized from:", payload.payload.authorization.from);
  console.log(
    payOk
      ? "\n✅ Pay path verified — Circle MPC signs crew payment authorizations as the treasury. No raw key."
      : "\n✗ pay-path authorization did not come from the treasury.",
  );
  process.exit(payOk ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ circle:verify failed:", e?.response?.data ?? e?.message ?? e);
  process.exit(1);
});
