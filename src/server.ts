import http from "node:http";
import { config } from "./config";
import { CrewRegistry, usingRealBrain } from "./crew";
import { createLocalSigner } from "./signer";
import { MockSettlement } from "./settlement";
import { runJob, type Hirer } from "./orchestrator";

/**
 * Foreman engine API — drives the orchestrator and exposes the live economy to
 * the Next.js app. Rail-agnostic: ENGINE_RAIL=mock (default) or =gateway (real
 * Circle Gateway settlement on Arc).
 *
 *   GET  /stats     cumulative jobs / payments / volume
 *   GET  /crew      crew marketplace + reputation
 *   GET  /activity  recent agent-to-agent payments (ledger)
 *   GET  /events    SSE stream of live decisions + payments
 *   POST /run       { goal, budget } → runs a job (streamed over /events)
 */
const PORT = Number(process.env.PORT) || 8799;
const RAIL = (process.env.ENGINE_RAIL || "mock") as "mock" | "gateway";

const registry = CrewRegistry.seeded();
const clients = new Set<http.ServerResponse>();
const log: unknown[] = [];
const stats = { jobs: 0, payments: 0, volumeUsdc: 0, startedAt: Date.now(), rail: RAIL };
const ledger: Array<{ ts: number; crew: string; skill: string; amountUsdc: number; ref: string }> = [];

let hireFn: Hirer | undefined; // gateway rail
let beforeRun: (() => Promise<void>) | undefined;
let mockSettlement: MockSettlement | undefined;
let mockForeman = createLocalSigner();
let foremanAddress = mockForeman.address;
let running = false;

function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function broadcast(event: unknown) {
  log.push(event);
  if (log.length > 200) log.shift();
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(line);
}

function crewSnapshot() {
  return registry.members
    .map((m) => ({
      name: m.name,
      skill: m.skill,
      priceUsdc: m.priceUsdc,
      reputation: m.reputation,
      jobs: m.jobsCompleted,
      address: m.signer.address,
    }))
    .sort((a, b) => b.reputation - a.reputation);
}

async function handleRun(goal: string, budgetUsdc: number) {
  if (running) {
    broadcast({ type: "log", msg: "⏳ a job is already running", ts: Date.now() });
    return;
  }
  running = true;
  broadcast({ type: "job-start", goal, budgetUsdc, ts: Date.now() });
  try {
    if (beforeRun) await beforeRun();
    const receipt = await runJob(
      { goal, budgetUsdc },
      hireFn
        ? { registry, hire: hireFn, rail: "circle-gateway", onEvent: (m) => broadcast({ type: "log", msg: m, ts: Date.now() }) }
        : { registry, settlement: mockSettlement!, foreman: mockForeman, onEvent: (m) => broadcast({ type: "log", msg: m, ts: Date.now() }) },
    );
    stats.jobs += 1;
    stats.payments += receipt.lineItems.length;
    stats.volumeUsdc += receipt.spentUsdc;
    for (const li of receipt.lineItems) {
      ledger.unshift({ ts: Date.now(), crew: li.crew, skill: li.skill, amountUsdc: li.priceUsdc, ref: li.paymentRef });
    }
    if (ledger.length > 200) ledger.length = 200;
    broadcast({ type: "receipt", receipt, ts: Date.now() });
    broadcast({ type: "stats", stats, ts: Date.now() });
    broadcast({ type: "crew", members: crewSnapshot(), ts: Date.now() });
  } catch (e) {
    broadcast({ type: "log", msg: `❌ ${(e as Error).message}`, ts: Date.now() });
  } finally {
    running = false;
  }
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const json = (data: unknown, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  };

  if (req.method === "GET" && url.pathname === "/") {
    json({ ok: true, service: "foreman-engine", rail: RAIL, brain: usingRealBrain() ? config.groqModel : "mock", foreman: foremanAddress });
    return;
  }
  if (req.method === "GET" && url.pathname === "/stats") {
    json({ ...stats, foreman: foremanAddress, brain: usingRealBrain() ? config.groqModel : "mock" });
    return;
  }
  if (req.method === "GET" && url.pathname === "/crew") {
    json({ members: crewSnapshot() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/activity") {
    json({ ledger });
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello", rail: RAIL, brain: usingRealBrain() ? config.groqModel : "mock", foreman: foremanAddress })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "stats", stats })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "crew", members: crewSnapshot() })}\n\n`);
    for (const e of log) res.write(`data: ${JSON.stringify(e)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.method === "POST" && url.pathname === "/run") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { goal, budget } = JSON.parse(body || "{}");
        const g = String(goal || "").trim();
        if (!g) return json({ error: "goal required" }, 400);
        void handleRun(g, Number(budget) || 1);
        json({ ok: true }, 202);
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  json({ error: "not found" }, 404);
});

async function start() {
  if (RAIL === "gateway") {
    const { startCrewServer } = await import("./gateway/crewServer");
    const { createForemanGateway } = await import("./gateway/foreman");
    const { gatewayHire } = await import("./gateway/hirer");
    const { generatePrivateKey } = await import("viem/accounts");

    const CREW_PORT = PORT + 1;
    await startCrewServer(registry, CREW_PORT);
    const gateway = createForemanGateway((config.foremanPrivateKey || generatePrivateKey()) as `0x${string}`);
    foremanAddress = gateway.address;
    hireFn = gatewayHire(gateway, `http://localhost:${CREW_PORT}`);

    // Keep enough Gateway balance for a job before each run.
    beforeRun = async () => {
      const need = 1_000_000n; // $1.00 headroom
      let available = (await gateway.getBalances()).gateway.available;
      if (available >= need) return;
      broadcast({ type: "log", msg: "💰 topping up Gateway balance…", ts: Date.now() });
      await gateway.deposit("2");
      const startedAt = Date.now();
      while (available < need && Date.now() - startedAt < 90_000) {
        await new Promise((r) => setTimeout(r, 3000));
        available = (await gateway.getBalances()).gateway.available;
      }
    };
  } else {
    mockSettlement = new MockSettlement();
  }

  server.listen(PORT, () => {
    console.log(`\n  🟢 Foreman engine API → http://localhost:${PORT}   rail: ${RAIL}`);
    console.log(`     GET /stats /crew /activity /events   POST /run\n`);
  });
}

void start();
