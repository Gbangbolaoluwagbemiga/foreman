import "dotenv/config";
import { createForemanGatewayMPC } from "./gateway/foremanMpc";

/**
 *   npm run circle:withdraw -- [amount]
 *
 * Proves the MPC withdrawal path: signs a Gateway burn intent via Circle MPC,
 * gets Circle's attestation, and mints the USDC back to the treasury wallet with
 * an MPC-signed on-chain tx. No raw key. Default amount 0.5 USDC.
 */
async function main() {
  const amount = process.argv[2] || "0.5";
  const gw = createForemanGatewayMPC();
  console.log("→ MPC treasury:", gw.address);

  const before = await gw.getBalances();
  console.log(`   Gateway available before: ${before.gateway.formattedAvailable} USDC`);

  console.log(`→ Withdrawing ${amount} USDC via Circle MPC (burn intent + mint)…`);
  const r = await gw.withdraw(amount);
  console.log(`   withdrew: ${r.formattedAmount} USDC`);

  const after = await gw.getBalances();
  const wallet = await gw.getUsdcBalance();
  console.log(`   Gateway available after:  ${after.gateway.formattedAvailable} USDC`);
  console.log(`   Treasury wallet USDC:     ${wallet.formatted} USDC`);
  console.log("\n✅ MPC withdrawal settled — burn intent signed by MPC, minted back on Arc. No raw key.");
}

main().catch((e) => {
  console.error("✗ circle:withdraw failed:", e?.response?.data ?? e?.message ?? e);
  process.exit(1);
});
