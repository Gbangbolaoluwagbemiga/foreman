import { generatePrivateKey } from "viem/accounts";
import type { GatewayClient } from "@circle-fin/x402-batching/client";
import { CrewRegistry, usingRealBrain } from "./crew";
import { config } from "./config";
import { startCrewServer } from "./gateway/crewServer";
import { createForemanGateway } from "./gateway/foreman";
import { gatewayHire } from "./gateway/hirer";
import { runJob } from "./orchestrator";

/**
 * The FULL Foreman flow on real money: plan a job, hire several crew, and pay
 * each one in USDC on Arc via Circle Gateway batching. This is the whole product
 * end-to-end — not an isolated single payment.
 */
const PORT = 8404;
const FAUCET = "https://faucet.circle.com";

async function ensureGatewayBalance(gateway: GatewayClient, neededUnits: bigint): Promise<bigint> {
  let available = (await gateway.getBalances()).gateway.available;
  if (available >= neededUnits) return available;

  console.log(`\n  Depositing $1.00 into Circle Gateway…`);
  const dep = await gateway.deposit("1");
  console.log(`  deposited ${dep.formattedAmount} USDC  [${dep.depositTxHash.slice(0, 12)}…]`);

  const start = Date.now();
  while (available < neededUnits && Date.now() - start < 90_000) {
    await new Promise((r) => setTimeout(r, 3000));
    available = (await gateway.getBalances()).gateway.available;
    console.log(`  …waiting for deposit to credit (available: ${(Number(available) / 1e6).toFixed(2)} USDC)`);
  }
  return available;
}

async function main() {
  const registry = CrewRegistry.seeded();
  const server = await startCrewServer(registry, PORT);

  const goal =
    process.argv.slice(2).join(" ") ||
    "Write a short blog post about my coffee shop 'Bean There', with a headline and a header image concept.";
  const budgetUsdc = 1.0;

  const pk = (config.foremanPrivateKey || generatePrivateKey()) as `0x${string}`;
  const gateway = createForemanGateway(pk);

  console.log("════════════════════════════════════════════════════════════");
  console.log("  FOREMAN × Circle Gateway — FULL job, real USDC on Arc");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  brain:   ${usingRealBrain() ? config.groqModel : "mock"}`);
  console.log(`  foreman: ${gateway.address}`);

  const usdc = await gateway.getUsdcBalance();
  const balances = await gateway.getBalances();
  console.log(`  wallet USDC: ${usdc.formatted}   gateway available: ${balances.gateway.formattedAvailable}`);

  if (usdc.balance === 0n && balances.gateway.available === 0n) {
    console.log(`\n  ⚠️  Unfunded. Fund ${gateway.address} at ${FAUCET}, set FOREMAN_PRIVATE_KEY in .env, re-run.`);
    server.close();
    return;
  }

  const available = await ensureGatewayBalance(gateway, BigInt(Math.round(budgetUsdc * 1e6)));
  if (available <= 0n) {
    console.log("  ⚠️  No available Gateway balance yet — re-run shortly.");
    server.close();
    return;
  }
  console.log(`  ✓ Gateway available: ${(Number(available) / 1e6).toFixed(2)} USDC\n`);

  const receipt = await runJob(
    { goal, budgetUsdc },
    {
      registry,
      hire: gatewayHire(gateway, `http://localhost:${PORT}`),
      rail: "circle-gateway",
      onEvent: (m) => console.log("  " + m),
    },
  );

  console.log("────────────────────────────────────────────────────────────");
  console.log(`  🧾 RECEIPT — spent $${receipt.spentUsdc.toFixed(2)} / $${receipt.budgetUsdc.toFixed(2)}  rail: ${receipt.rail}`);
  for (const li of receipt.lineItems) {
    console.log(`     • ${li.skill.padEnd(13)} ${li.crew.padEnd(8)} $${li.priceUsdc.toFixed(2)}  [${li.paymentRef}]  rep→${li.reputationAfter}`);
  }
  console.log("════════════════════════════════════════════════════════════");
  console.log("\n" + receipt.result);
  server.close();
}

main().catch((e) => {
  console.error("gateway job failed:", e);
  process.exit(1);
});
