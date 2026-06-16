import { CrewRegistry, usingRealBrain } from "./crew";
import { createLocalSigner } from "./signer";
import { MockSettlement } from "./settlement";
import { config } from "./config";
import { runJob, type Hirer, type Receipt } from "./orchestrator";

/**
 * The always-on swarm: a Foreman continuously takes jobs from a pool and pays a
 * crew of AIs to do them — racking up REAL agent-to-agent USDC volume on Arc
 * (the hackathon's traction metric) and a living reputation economy.
 *
 *   SWARM_RAIL=mock|gateway   (default mock — gateway moves real USDC)
 *   SWARM_INTERVAL_MS=4000    pause between jobs
 *   SWARM_BUDGET=1.0          budget per job (USDC)
 *   SWARM_MAX_JOBS=0          0 = run forever
 */
const RAIL = (process.env.SWARM_RAIL || "mock") as "mock" | "gateway";
const INTERVAL_MS = Number(process.env.SWARM_INTERVAL_MS || 4000);
const BUDGET = Number(process.env.SWARM_BUDGET || 1.0);
const MAX_JOBS = Number(process.env.SWARM_MAX_JOBS || 0);

const GOALS = [
  "Write a launch tweet for a new AI coffee shop called 'Bean There'.",
  "Draft a product description for noise-cancelling earbuds aimed at students.",
  "Summarize the benefits of stablecoin payments for small businesses.",
  "Write a catchy headline and subheading for a fitness app landing page.",
  "Create SEO keywords and a meta description for a vegan bakery.",
  "Write a short cold email pitching a freelance design service.",
  "Draft release notes for a mobile app's dark-mode update.",
  "Write an image prompt for a hero banner for a travel startup.",
  "Proofread and polish a tagline: 'we make payment easy for everyones'.",
  "Research 3 competitors for a budgeting app and note their taglines.",
];

const stats = { jobs: 0, payments: 0, volumeUsdc: 0, startedAt: Date.now() };

async function main() {
  const registry = CrewRegistry.seeded();
  console.log("════════════════════════════════════════════════════════════");
  console.log("  FOREMAN SWARM — continuous agent-to-agent economy on Arc");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  rail: ${RAIL}   brain: ${usingRealBrain() ? config.groqModel : "mock"}   budget/job: $${BUDGET.toFixed(2)}`);

  let runOne: (goal: string) => Promise<Receipt>;
  let cleanup = () => {};

  if (RAIL === "gateway") {
    // Lazy-load Circle SDK only on the real rail so the mock swarm needs nothing.
    const { startCrewServer } = await import("./gateway/crewServer");
    const { createForemanGateway } = await import("./gateway/foreman");
    const { gatewayHire } = await import("./gateway/hirer");
    const { generatePrivateKey } = await import("viem/accounts");

    const PORT = 8405;
    const server = await startCrewServer(registry, PORT);
    cleanup = () => server.close();
    const gateway = createForemanGateway((config.foremanPrivateKey || generatePrivateKey()) as `0x${string}`);
    console.log(`  foreman: ${gateway.address}`);
    const hire: Hirer = gatewayHire(gateway, `http://localhost:${PORT}`);
    const needUnits = BigInt(Math.round(BUDGET * 1e6));

    const ensureBalance = async () => {
      let available = (await gateway.getBalances()).gateway.available;
      if (available >= needUnits) return;
      console.log(`  💰 topping up Gateway (available $${(Number(available) / 1e6).toFixed(2)} < budget)…`);
      await gateway.deposit(String(Math.max(2, BUDGET * 3)));
      const start = Date.now();
      while (available < needUnits && Date.now() - start < 90_000) {
        await new Promise((r) => setTimeout(r, 3000));
        available = (await gateway.getBalances()).gateway.available;
      }
    };

    runOne = async (goal) => {
      await ensureBalance();
      return runJob({ goal, budgetUsdc: BUDGET }, { registry, hire, rail: "circle-gateway" });
    };
  } else {
    const settlement = new MockSettlement();
    const foreman = createLocalSigner();
    runOne = (goal) => runJob({ goal, budgetUsdc: BUDGET }, { registry, settlement, foreman });
  }

  const summary = () => {
    const mins = (Date.now() - stats.startedAt) / 60000;
    const rate = mins > 0 ? (stats.payments / mins).toFixed(1) : "—";
    const top = [...registry.members].sort((a, b) => b.reputation - a.reputation).slice(0, 3);
    console.log(
      `  ▸ jobs ${stats.jobs} · payments ${stats.payments} · volume $${stats.volumeUsdc.toFixed(3)} · ${rate}/min` +
        ` · top: ${top.map((m) => `${m.name}(${m.reputation})`).join(" ")}`,
    );
  };

  process.on("SIGINT", () => {
    console.log("\n── swarm stopped ──");
    summary();
    cleanup();
    process.exit(0);
  });

  console.log("  (Ctrl+C to stop)\n");
  while (MAX_JOBS === 0 || stats.jobs < MAX_JOBS) {
    const goal = GOALS[stats.jobs % GOALS.length]!;
    try {
      const receipt = await runOne(goal);
      stats.jobs += 1;
      stats.payments += receipt.lineItems.length;
      stats.volumeUsdc += receipt.spentUsdc;
      console.log(`  ✅ "${goal.slice(0, 48)}…" — ${receipt.lineItems.length} crew paid, $${receipt.spentUsdc.toFixed(3)}`);
      summary();
    } catch (e) {
      console.error(`  ❌ job failed: ${(e as Error).message}`);
    }
    if (MAX_JOBS === 0 || stats.jobs < MAX_JOBS) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log("\n── swarm complete ──");
  summary();
  cleanup();
}

main().catch((e) => {
  console.error("swarm failed:", e);
  process.exit(1);
});
