import { CrewRegistry } from "./crew";
import { createLocalSigner } from "./signer";
import { MockSettlement } from "./settlement";
import { runJob } from "./orchestrator";

/**
 * Recursive subcontracting → multi-hop payment chains (RFB-03).
 *
 * A client Foreman hires an "Agency" for a big task. The Agency is ITSELF a
 * Foreman: it takes the fee, hires a crew of specialists, pays each, keeps a
 * margin, and returns the assembled work. That's a depth-2 payment chain and an
 * emergent broker — answering RFB-03's "do broker agents emerge?".
 *
 *   Client ──$fee──▶ Agency ──$──▶ { Researcher, Writer, SEO … }
 *
 * Mock rail here (the real Circle Gateway rail is proven in gateway:job/swarm);
 * this demo isolates the agentic structure of nested hiring.
 */
async function main() {
  const settlement = new MockSettlement();
  const client = createLocalSigner(); // the top-level Foreman / customer
  const agency = createLocalSigner(); // a manager agent that subcontracts

  const goal =
    process.argv.slice(2).join(" ") ||
    "Produce a full marketing campaign for 'Bean There' coffee — research, copy, and SEO.";
  const agencyFee = 0.6; // what the client pays the Agency
  const agencyWorkingBudget = 0.45; // what the Agency spends on its crew (keeps the rest)

  console.log("════════════════════════════════════════════════════════════");
  console.log("  RECURSIVE SUBCONTRACTING — an agent that hires agents");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  client: ${client.address}`);
  console.log(`  agency: ${agency.address}`);
  console.log("────────────────────────────────────────────────────────────");

  // HOP 1 — client pays the Agency its fee.
  const hop1 = await settlement.pay({
    from: client,
    to: agency.address,
    amountUsdc: agencyFee,
    memo: "campaign (subcontracted)",
  });
  console.log(`  💸 [hop 1] Client → Agency  $${agencyFee.toFixed(2)} USDC  [${hop1.ref}]`);

  // The Agency is itself a Foreman: it hires + pays a crew from its working budget.
  console.log(`\n  🏢 Agency takes the job and assembles a crew (budget $${agencyWorkingBudget.toFixed(2)}):`);
  const subRegistry = CrewRegistry.seeded();
  const sub = await runJob(
    { goal, budgetUsdc: agencyWorkingBudget },
    {
      registry: subRegistry,
      settlement,
      foreman: agency, // ← payments now flow FROM the agency (hop 2)
      onEvent: (m) => console.log("     " + m),
    },
  );

  const margin = agencyFee - sub.spentUsdc;
  const chainDepth = 2;

  console.log("────────────────────────────────────────────────────────────");
  console.log("  🧾 PAYMENT CHAIN");
  console.log(`     Client ──$${agencyFee.toFixed(2)}──▶ Agency ──$${sub.spentUsdc.toFixed(2)}──▶ ${sub.lineItems.length} specialists`);
  console.log(`     chain depth: ${chainDepth}   total payments: ${sub.lineItems.length + 1}   Agency margin: $${margin.toFixed(2)}`);
  for (const li of sub.lineItems) {
    console.log(`       • [hop 2] Agency → ${li.crew.padEnd(8)} ${li.skill.padEnd(13)} $${li.priceUsdc.toFixed(2)}  [${li.paymentRef}]`);
  }
  console.log("════════════════════════════════════════════════════════════");
  console.log("\n" + sub.result);
}

main().catch((e) => {
  console.error("subcontract demo failed:", e);
  process.exit(1);
});
