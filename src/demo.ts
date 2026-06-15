import { config } from "./config";
import { CrewRegistry, usingRealBrain } from "./crew";
import { createLocalSigner } from "./signer";
import { createSettlement } from "./settlement";
import { runJob } from "./orchestrator";

async function main() {
  const goal =
    process.argv.slice(2).join(" ") ||
    "Write a short blog post about my new coffee shop 'Bean There', with a catchy headline and a header image concept.";
  const budgetUsdc = 1.0;

  const registry = CrewRegistry.seeded();
  const settlement = createSettlement();
  const foreman = createLocalSigner(config.foremanPrivateKey || undefined);

  console.log("════════════════════════════════════════════════════════════");
  console.log("  FOREMAN — an AI that hires & pays a crew of AIs on Arc");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  brain:      ${usingRealBrain() ? "Groq " + config.groqModel : "mock (set GROQ_API_KEY for real reasoning)"}`);
  console.log(`  settlement: ${settlement.rail}`);
  console.log(`  foreman:    ${foreman.address}`);
  console.log(`  crew:       ${registry.members.length} specialists across ${registry.skills().length} skills`);
  console.log("────────────────────────────────────────────────────────────");

  const receipt = await runJob({ goal, budgetUsdc }, {
    registry,
    settlement,
    foreman,
    onEvent: (m) => console.log("  " + m),
  });

  console.log("────────────────────────────────────────────────────────────");
  console.log("  🧾 RECEIPT");
  console.log(`     budget: $${receipt.budgetUsdc.toFixed(2)}   spent: $${receipt.spentUsdc.toFixed(2)}   change: $${receipt.changeUsdc.toFixed(2)}   rail: ${receipt.rail}`);
  for (const li of receipt.lineItems) {
    console.log(`     • ${li.skill.padEnd(14)} ${li.crew.padEnd(8)} $${li.priceUsdc.toFixed(2)}  [${li.paymentRef}]  rep→${li.reputationAfter}`);
  }
  for (const s of receipt.skipped) console.log(`     • ${s.skill.padEnd(14)} (skipped — ${s.reason})`);
  console.log("════════════════════════════════════════════════════════════\n");
  console.log(receipt.result);
}

main().catch((e) => {
  console.error("Foreman demo failed:", e);
  process.exit(1);
});
