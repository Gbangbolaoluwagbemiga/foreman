import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CrewRegistry, usingRealBrain } from "./crew";
import { config } from "./config";
import { startCrewServer } from "./gateway/crewServer";
import { createForemanGateway } from "./gateway/foreman";

/**
 * REAL Circle Gateway nanopayment: Foreman pays a crew member in USDC on Arc
 * Testnet, settled via Gateway batching. Needs a funded wallet (Circle faucet).
 */
const PORT = 8403;
const FAUCET = "https://faucet.circle.com";

async function main() {
  const registry = CrewRegistry.seeded();
  const server = await startCrewServer(registry, PORT);

  const autoKey = !config.foremanPrivateKey;
  const pk = (config.foremanPrivateKey || generatePrivateKey()) as `0x${string}`;
  const gateway = createForemanGateway(pk);

  console.log("════════════════════════════════════════════════════════════");
  console.log("  FOREMAN × Circle Gateway — real USDC nanopayment on Arc");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  brain:   ${usingRealBrain() ? config.groqModel : "mock"}`);
  console.log(`  foreman: ${gateway.address}`);

  const usdc = await gateway.getUsdcBalance();
  const balances = await gateway.getBalances();
  console.log(`  wallet USDC: ${usdc.formatted}   gateway available: ${balances.gateway.formattedAvailable}`);

  // Unfunded → tell the user exactly how to fund and stop cleanly.
  if (usdc.balance === 0n && balances.gateway.available === 0n) {
    console.log("\n  ⚠️  This wallet has no testnet USDC yet. To go live:");
    console.log(`     1. Fund this address from the Circle faucet: ${FAUCET}`);
    console.log(`        address → ${gateway.address}`);
    if (autoKey) {
      console.log(`     2. Save this key so the funded wallet persists:`);
      console.log(`        FOREMAN_PRIVATE_KEY=${pk}   (add to Foreman/.env)`);
    }
    console.log(`     3. Re-run: npm run gateway`);
    server.close();
    return;
  }

  // Ensure some Gateway balance to spend from.
  if (balances.gateway.available < 100_000n) {
    console.log("\n  Depositing $0.50 into Circle Gateway…");
    const dep = await gateway.deposit("0.5");
    console.log(`  deposited ${dep.formattedAmount} USDC  [${dep.depositTxHash.slice(0, 12)}…]`);
  }

  const url = `http://localhost:${PORT}/crew/quill`;
  const task = "Write a 1-line tagline for an AI coffee shop called 'Bean There'.";
  console.log("\n  Foreman → paying Quill via Gateway for copywriting…");
  const result = await gateway.pay<{ deliverable: string }>(url, {
    method: "POST",
    body: { task },
  });

  console.log(`\n  💸 Paid ${result.formattedAmount} USDC — settled on Arc via Gateway batching`);
  console.log(`  🧾 Quill delivered:\n     "${result.data.deliverable}"`);
  console.log("════════════════════════════════════════════════════════════");
  server.close();
}

main().catch((e) => {
  console.error("gateway demo failed:", e);
  process.exit(1);
});
