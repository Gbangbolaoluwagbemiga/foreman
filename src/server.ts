import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { CrewRegistry, usingRealBrain, type RegisterInput } from "./crew";
import { createLocalSigner } from "./signer";
import { MockSettlement } from "./settlement";
import { runJob, type Hirer, type Receipt } from "./orchestrator";

const DATA_FILE = path.join(process.cwd(), "data", "registered.json");

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

// ── Per-user accounts: each connected wallet has its own deposits/spend, plus an
// overdraft (credit line) worth 10% of lifetime spend — repay anytime. The agent's
// on-chain funds are pooled; this ledger attributes them per user.
interface Account {
  deposited: number;
  spent: number;
}
const accounts = new Map<string, Account>();
const history = new Map<string, Array<{ ts: number } & Receipt>>();
const OVERDRAFT_RATE = 0.3;
function acct(user: string): Account {
  const k = user.toLowerCase();
  let a = accounts.get(k);
  if (!a) {
    a = { deposited: 0, spent: 0 };
    accounts.set(k, a);
  }
  return a;
}
function accountView(user: string) {
  const a = acct(user);
  const balance = Math.max(0, Number((a.deposited - a.spent).toFixed(6)));
  const owed = Math.max(0, Number((a.spent - a.deposited).toFixed(6)));
  const creditLimit = Number((OVERDRAFT_RATE * a.spent).toFixed(6));
  const creditAvailable = Math.max(0, Number((creditLimit - owed).toFixed(6)));
  const spendable = Number((balance + creditAvailable).toFixed(6));
  return { user, deposited: a.deposited, spent: a.spent, balance, owed, creditLimit, creditAvailable, spendable };
}

let hireFn: Hirer | undefined; // gateway rail
let beforeRun: (() => Promise<void>) | undefined;
// Structural type so the mock rail never imports the Circle SDK.
let gatewayClient:
  | {
      address: string;
      getUsdcBalance: () => Promise<{ formatted: string }>;
      getBalances: () => Promise<{ gateway: { formattedAvailable: string } }>;
      withdraw: (amount: string) => Promise<{ formattedAmount: string }>;
    }
  | undefined;
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
      address: m.walletAddress,
      earnedUsdc: m.earnedUsdc,
      registered: !!m.registered,
      external: !!m.endpointUrl,
    }))
    .sort((a, b) => b.reputation - a.reputation);
}

function loadRegistered() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as RegisterInput[];
    for (const r of list) registry.register(r);
    if (list.length) console.log(`  loaded ${list.length} registered agent(s)`);
  } catch {
    /* none yet */
  }
}

/** Verify an external agent is a real x402 seller: it must answer 402 when unpaid. */
async function probeX402(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    return r.status === 402;
  } catch {
    return false;
  }
}

function saveRegistered() {
  const list: RegisterInput[] = registry.members
    .filter((m) => m.registered)
    .map((m) => ({ name: m.name, skill: m.skill, priceUsdc: m.priceUsdc, walletAddress: m.walletAddress, systemPrompt: m.systemPrompt, endpointUrl: m.endpointUrl }));
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    console.warn("could not persist registrations:", (e as Error).message);
  }
}

async function handleRun(goal: string, budgetUsdc: number, user?: string) {
  if (running) {
    broadcast({ type: "log", msg: "⏳ a job is already running", ts: Date.now() });
    return;
  }
  if (user) {
    const v = accountView(user);
    // Only start a job you can fully cover (cash + overdraft) so owed can never
    // exceed your credit limit.
    if (v.spendable < budgetUsdc) {
      broadcast({
        type: "log",
        msg: `❌ Need $${budgetUsdc.toFixed(2)} but only $${v.spendable.toFixed(2)} available (balance $${v.balance.toFixed(2)} + credit $${v.creditAvailable.toFixed(2)}). ${v.owed > 0 ? `You owe $${v.owed.toFixed(2)} — repay or deposit.` : "Fund your Foreman."}`,
        ts: Date.now(),
      });
      return;
    }
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
    if (user) {
      const a = acct(user);
      a.spent = Number((a.spent + receipt.spentUsdc).toFixed(6));
      broadcast({ type: "account", account: accountView(user), ts: Date.now() });
      const k = user.toLowerCase();
      const h = history.get(k) ?? [];
      h.unshift({ ts: Date.now(), ...receipt });
      if (h.length > 50) h.length = 50;
      history.set(k, h);
    }
    broadcast({ type: "receipt", receipt, ts: Date.now() });
    broadcast({ type: "stats", stats, ts: Date.now() });
    broadcast({ type: "crew", members: crewSnapshot(), ts: Date.now() });
    return receipt;
  } catch (e) {
    broadcast({ type: "log", msg: `❌ ${(e as Error).message}`, ts: Date.now() });
    return undefined;
  } finally {
    running = false;
  }
}

/** Synchronous delegate: run a job and return the receipt (for MCP / programmatic agents). */
async function delegate(goal: string, budgetUsdc: number, user?: string): Promise<{ receipt?: Receipt; error?: string }> {
  if (running) return { error: "Foreman is busy with another job — try again in a moment." };
  if (user) {
    const v = accountView(user);
    if (v.spendable < budgetUsdc) {
      return { error: `Insufficient funds: need $${budgetUsdc.toFixed(2)}, have $${v.spendable.toFixed(2)} (balance $${v.balance.toFixed(2)} + credit $${v.creditAvailable.toFixed(2)}). Fund the Foreman account.` };
    }
  }
  const receipt = await handleRun(goal, budgetUsdc, user);
  return receipt ? { receipt } : { error: "job failed" };
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
  if (req.method === "GET" && url.pathname === "/foreman") {
    void (async () => {
      if (gatewayClient) {
        try {
          const [u, b] = await Promise.all([gatewayClient.getUsdcBalance(), gatewayClient.getBalances()]);
          json({ address: foremanAddress, rail: RAIL, walletUsdc: u.formatted, gatewayAvailable: b.gateway.formattedAvailable });
        } catch (e) {
          json({ address: foremanAddress, rail: RAIL, walletUsdc: null, gatewayAvailable: null, error: (e as Error).message });
        }
      } else {
        json({ address: foremanAddress, rail: RAIL, walletUsdc: null, gatewayAvailable: null });
      }
    })();
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
  if (req.method === "POST" && url.pathname === "/foreman/withdraw") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!gatewayClient) return json({ error: "withdraw is only available on the gateway rail" }, 400);
      void (async () => {
        try {
          const { amount } = JSON.parse(body || "{}");
          const r = await gatewayClient!.withdraw(String(amount || "0"));
          broadcast({ type: "log", msg: `🏧 Withdrew ${r.formattedAmount} USDC from Gateway → agent wallet`, ts: Date.now() });
          json({ ok: true, withdrew: r.formattedAmount });
        } catch (e) {
          json({ error: (e as Error).message }, 500);
        }
      })();
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/register") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () =>
      void (async () => {
        try {
          const b = JSON.parse(body || "{}");
          const name = String(b.name ?? "").trim();
          const skill = String(b.skill ?? "").trim().toLowerCase();
          const price = Number(b.priceUsdc);
          const wallet = String(b.walletAddress ?? "");
          const systemPrompt = b.systemPrompt ? String(b.systemPrompt).trim() : "";
          const endpointUrl = b.endpointUrl ? String(b.endpointUrl).trim() : "";

          // ── Validation (keep junk/fake agents out) ──
          if (name.length < 2 || name.length > 40) return json({ error: "name must be 2–40 characters" }, 400);
          if (!/^[a-z0-9][a-z0-9 -]{0,23}$/.test(skill)) return json({ error: "skill must be a short word (letters, numbers, dashes)" }, 400);
          if (!Number.isFinite(price) || price < 0.001 || price > 10) return json({ error: "price must be between 0.001 and 10 USDC" }, 400);
          if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "a valid wallet address is required to receive earnings" }, 400);

          // Dedupe: one agent per wallet+skill.
          if (registry.members.some((m) => m.registered && m.skill === skill && m.walletAddress.toLowerCase() === wallet.toLowerCase()))
            return json({ error: "this wallet already has an agent registered for that skill" }, 409);

          if (endpointUrl) {
            if (!/^https?:\/\//.test(endpointUrl)) return json({ error: "endpoint must be a valid http(s) URL" }, 400);
            // Proof-of-realness: a genuine x402 agent answers 402 when unpaid.
            if (!(await probeX402(endpointUrl)))
              return json({ error: "endpoint did not return HTTP 402 — not a verifiable x402 paid agent" }, 400);
          } else if (systemPrompt.length < 15) {
            return json({ error: "hosted agents need a system prompt of at least 15 characters" }, 400);
          }

          const m = registry.register({
            name,
            skill,
            priceUsdc: price,
            walletAddress: wallet,
            systemPrompt: systemPrompt || undefined,
            endpointUrl: endpointUrl || undefined,
          });
          saveRegistered();
          broadcast({ type: "crew", members: crewSnapshot() });
          broadcast({ type: "log", msg: `🆕 ${m.name} registered as a ${m.skill} agent ($${m.priceUsdc}) — now hireable`, ts: Date.now() });
          json({ ok: true, agent: { id: m.id, name: m.name, skill: m.skill, priceUsdc: m.priceUsdc, walletAddress: m.walletAddress } }, 201);
        } catch {
          json({ error: "bad json" }, 400);
        }
      })(),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/run") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { goal, budget, user } = JSON.parse(body || "{}");
        const g = String(goal || "").trim();
        if (!g) return json({ error: "goal required" }, 400);
        const u = typeof user === "string" && /^0x[0-9a-fA-F]{40}$/.test(user) ? user : undefined;
        void handleRun(g, Number(budget) || 1, u);
        json({ ok: true }, 202);
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/delegate") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () =>
      void (async () => {
        try {
          const { goal, budget, user } = JSON.parse(body || "{}");
          const g = String(goal || "").trim();
          if (!g) return json({ error: "goal required" }, 400);
          const u = typeof user === "string" && /^0x[0-9a-fA-F]{40}$/.test(user) ? user : undefined;
          const out = await delegate(g, Number(budget) || 1, u);
          json(out, out.error ? 402 : 200);
        } catch {
          json({ error: "bad json" }, 400);
        }
      })(),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/history") {
    const user = url.searchParams.get("user") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) return json({ error: "valid user address required" }, 400);
    json({ jobs: history.get(user.toLowerCase()) ?? [] });
    return;
  }
  if (req.method === "GET" && url.pathname === "/account") {
    const user = url.searchParams.get("user") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) return json({ error: "valid user address required" }, 400);
    json(accountView(user));
    return;
  }
  if (req.method === "POST" && url.pathname === "/account/deposit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, amount } = JSON.parse(body || "{}");
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0) return json({ error: "amount must be positive" }, 400);
        const a = acct(String(user));
        const wasOwed = Math.max(0, a.spent - a.deposited);
        a.deposited = Number((a.deposited + amt).toFixed(6));
        broadcast({ type: "log", msg: wasOwed > 0 ? `💵 Repaid/deposited ${amt} USDC` : `💵 Deposited ${amt} USDC to your Foreman`, ts: Date.now() });
        json(accountView(String(user)));
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  json({ error: "not found" }, 404);
});

async function start() {
  loadRegistered();
  if (RAIL === "gateway") {
    const { startCrewServer } = await import("./gateway/crewServer");
    const { createForemanGateway } = await import("./gateway/foreman");
    const { gatewayHire } = await import("./gateway/hirer");
    const { generatePrivateKey } = await import("viem/accounts");

    const CREW_PORT = PORT + 1;
    await startCrewServer(registry, CREW_PORT);
    const gateway = createForemanGateway((config.foremanPrivateKey || generatePrivateKey()) as `0x${string}`);
    foremanAddress = gateway.address;
    gatewayClient = gateway;
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
    console.log(`     crew: ${registry.members.length} · overdraft: ${Math.round(OVERDRAFT_RATE * 100)}% · planner: smart/minimal · history: on`);
    console.log(`     GET /stats /crew /activity /history /account /events   POST /run /register /account/deposit\n`);
  });
}

void start();
