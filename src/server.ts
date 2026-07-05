import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { CrewRegistry, usingRealBrain, auditionHostedAgent, isLive, type RegisterInput, type CrewMember } from "./crew";
import { issueChallenge, verifyAndMint, ownsAccount, bearer, verifySession, issueApiKey, verifyApiKey } from "./auth";
import { createLocalSigner } from "./signer";
import { MockSettlement } from "./settlement";
import { runJob, type Hirer, type Receipt } from "./orchestrator";
import {
  createAttester,
  buildAttestation,
  attestationDomain,
  ATTESTATION_TYPES,
  ATTESTATION_PRIMARY_TYPE,
} from "./attestation";

const DATA_FILE = path.join(process.cwd(), "data", "registered.json");
const STATE_FILE = path.join(process.cwd(), "data", "state.json");

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
const ledger: Array<{ ts: number; crew: string; skill: string; amountUsdc: number; ref: string; recipient?: string }> = [];

// EIP-712 signer for portable, independently-verifiable credit attestations.
const attester = createAttester(config.attesterPrivateKey || undefined, process.env.AUTH_SECRET);

// ── Per-user accounts: each connected wallet has its own deposits/spend, plus a
// credit line whose size is set by a live CREDIT SCORE (repayment history + usage
// + tenure). The agent's on-chain funds are pooled; this ledger attributes them
// per user. This is the "first AI agent with a credit score" — and the score moves.
interface Account {
  deposited: number;
  spent: number;
  jobsCount: number;
  repayments: number; // number of times the user repaid owed credit
  repaidTotal: number; // lifetime credit repaid
  firstSeen: number;
  lastRepayAt: number;
  // operator control plane
  suspended: boolean;
  perJobCap: number; // 0 = no cap
  dailyCap: number; // 0 = no cap
  dayKey: string;
  spentToday: number;
}
const accounts = new Map<string, Account>();
const history = new Map<string, Array<{ ts: number } & Receipt>>();

// ── Standing orders: recurring autonomous work the card funds on a schedule.
// "Every N minutes, run this goal." Each run goes through the same checkSpend
// gate — so your kill switch and caps govern the agent even while you sleep.
interface StandingOrder {
  id: string;
  user: string;
  goal: string;
  budget: number;
  everyMinutes: number;
  active: boolean;
  createdAt: number;
  lastRunAt: number;
  runs: number;
  totalSpent: number;
  lastNote?: string;
}
const orders: StandingOrder[] = [];

// ── Agent API keys: owner address → active key metadata (the secret is never
// stored; we keep only the keyId so keys can be listed + revoked). Lets a headless
// agent (MCP / /delegate) spend from the owner's account within its caps + credit.
type ApiKeyMeta = { id: string; createdAt: number; label?: string };
const apiKeys = new Map<string, ApiKeyMeta[]>();

/**
 * Resolve which account a request may act on: an API key (headless agents) or a
 * SIWE session (a signed-in human). Returns the owner address, or null if neither.
 */
function agentOwner(req: http.IncomingMessage): string | null {
  const tok = bearer(req);
  if (tok && tok.startsWith("fmn_")) {
    const k = verifyApiKey(tok);
    if (k && apiKeys.get(k.owner)?.some((m) => m.id === k.keyId)) return k.owner;
    return null; // key was revoked or is invalid
  }
  return verifySession(tok);
}

/** The marketplace moderator, proven by a SIWE session matching ADMIN_ADDRESS. */
function isAdmin(req: http.IncomingMessage): boolean {
  if (!config.adminAddress) return false;
  return verifySession(bearer(req)) === config.adminAddress;
}

/** Full admin view of an agent (includes pending/hidden ones + the AI verdict). */
function adminAgentView(m: CrewMember) {
  return {
    id: m.id,
    name: m.name,
    skill: m.skill,
    priceUsdc: m.priceUsdc,
    walletAddress: m.walletAddress,
    reputation: m.reputation,
    jobs: m.jobsCompleted,
    earnedUsdc: m.earnedUsdc,
    registered: !!m.registered,
    external: !!m.endpointUrl,
    delisted: !!m.delisted,
    status: m.status ?? "approved",
    systemPrompt: m.systemPrompt,
    audit: m.audit ?? null,
    live: isLive(m),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
function acct(user: string): Account {
  const k = user.toLowerCase();
  let a = accounts.get(k);
  if (!a) {
    a = {
      deposited: 0, spent: 0, jobsCount: 0, repayments: 0, repaidTotal: 0,
      firstSeen: Date.now(), lastRepayAt: 0,
      suspended: false, perJobCap: 0, dailyCap: 0, dayKey: today(), spentToday: 0,
    };
    accounts.set(k, a);
  }
  if (a.dayKey !== today()) {
    a.dayKey = today();
    a.spentToday = 0;
  }
  return a;
}

/**
 * Credit score (0–100) — a transparent, agent-native FICO. It rewards proven
 * behaviour, not promises:
 *   • repayment track record  (the strongest signal a lender has)
 *   • activity / volume        (a working agent that actually transacts)
 *   • tenure                   (time since first seen)
 *   • low utilization          (not maxing out the line)
 * The credit line scales with the score: a fresh agent gets ~10% of spend, a
 * proven one up to ~50%.
 */
function creditScore(a: Account) {
  if (a.spent === 0 && a.deposited === 0) return { score: 0, rate: 0, band: "no history" };
  const owed = Math.max(0, a.spent - a.deposited);
  const tenureDays = (Date.now() - a.firstSeen) / 86_400_000;

  let score = 40; // baseline once active
  score += Math.min(20, a.repayments * 10); // proven repayment
  score += Math.min(15, a.jobsCount * 2); // activity
  score += Math.min(10, a.spent * 2); // volume
  score += Math.min(5, tenureDays * 2); // tenure
  // utilization penalty: leaning hard on credit hurts the score.
  const limitGuess = 0.3 * a.spent;
  if (owed > 0 && limitGuess > 0) score -= Math.min(20, (owed / limitGuess) * 20);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const rate = Number((0.1 + (score / 100) * 0.4).toFixed(4)); // 10% → 50% of lifetime spend
  const band = score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 45 ? "fair" : "building";
  return { score, rate, band };
}

function accountView(user: string) {
  const a = acct(user);
  const balance = Math.max(0, Number((a.deposited - a.spent).toFixed(6)));
  const owed = Math.max(0, Number((a.spent - a.deposited).toFixed(6)));
  const { score, rate, band } = creditScore(a);
  const creditLimit = Number((rate * a.spent).toFixed(6));
  const creditAvailable = Math.max(0, Number((creditLimit - owed).toFixed(6)));
  const spendable = Number((balance + creditAvailable).toFixed(6));
  return {
    user, deposited: a.deposited, spent: a.spent, balance, owed, creditLimit, creditAvailable, spendable,
    creditScore: score, creditRate: rate, creditBand: band,
    jobsCount: a.jobsCount, repayments: a.repayments, repaidTotal: a.repaidTotal,
    suspended: a.suspended, perJobCap: a.perJobCap, dailyCap: a.dailyCap, spentToday: a.spentToday,
  };
}

/** The control-plane gate: is this agent allowed to spend `budget` right now? */
function checkSpend(user: string, budget: number): { ok: boolean; reason?: string } {
  const a = acct(user);
  if (a.suspended) return { ok: false, reason: "agent is suspended — the kill switch is on" };
  if (a.perJobCap > 0 && budget > a.perJobCap) return { ok: false, reason: `exceeds the per-job cap of $${a.perJobCap.toFixed(2)}` };
  if (a.dailyCap > 0 && a.spentToday + budget > a.dailyCap) return { ok: false, reason: `would exceed the daily cap of $${a.dailyCap.toFixed(2)} ($${a.spentToday.toFixed(2)} spent today)` };
  const v = accountView(user);
  if (v.spendable < budget) return { ok: false, reason: `insufficient funds: need $${budget.toFixed(2)}, have $${v.spendable.toFixed(2)} (balance $${v.balance.toFixed(2)} + credit $${v.creditAvailable.toFixed(2)})` };
  return { ok: true };
}

let hireFn: Hirer | undefined; // gateway rail
let beforeRun: (() => Promise<void>) | undefined;
// Structural type so the mock rail never imports the Circle SDK.
interface TransferRecord {
  id: string;
  status: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}
let gatewayClient:
  | {
      address: string;
      getUsdcBalance: () => Promise<{ formatted: string }>;
      getBalances: () => Promise<{ gateway: { formattedAvailable: string } }>;
      withdraw: (amount: string) => Promise<{ formattedAmount: string }>;
      transferUsdc?: (to: string, amount: string) => Promise<{ hash: string; formattedAmount: string }>;
      getTransferById: (id: string) => Promise<TransferRecord>;
    }
  | undefined;
let mockSettlement: MockSettlement | undefined;
let mockForeman = createLocalSigner();
let foremanAddress = mockForeman.address;
let running = false;

function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
    .filter(isLive)
    .map((m) => ({
      name: m.name,
      skill: m.skill,
      priceUsdc: m.priceUsdc,
      reputation: m.reputation,
      trend: m.repDelta ?? 0, // last reputation move — powers the live ▲/▼
      jobs: m.jobsCompleted,
      address: m.walletAddress,
      earnedUsdc: m.earnedUsdc,
      registered: !!m.registered,
      external: !!m.endpointUrl,
      likes: m.likes ?? 0,
      dislikes: m.dislikes ?? 0,
    }))
    .sort((a, b) => b.reputation - a.reputation);
}

// Persisted registration record: the submission plus its moderation state.
type StoredAgent = RegisterInput & { status?: "pending" | "approved"; audit?: CrewMember["audit"] };

function loadRegistered() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as StoredAgent[];
    for (const r of list) registry.register(r, { status: r.status ?? "approved", audit: r.audit });
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

// ── Durable state: accounts, history, ledger, counters AND crew reputation
// survive restarts — otherwise every decay/slash would be wiped on each boot and
// reputation would mean nothing. (Registrations live in their own file too.)
function stateSnapshot() {
  return {
    v: 2,
    savedAt: Date.now(),
    counters: { jobs: stats.jobs, payments: stats.payments, volumeUsdc: stats.volumeUsdc },
    accounts: Object.fromEntries(accounts),
    history: Object.fromEntries(history),
    ledger,
    orders,
    apiKeys: Object.fromEntries(apiKeys),
    crew: registry.members.map((m) => ({
      name: m.name,
      skill: m.skill,
      reputation: m.reputation,
      repDelta: m.repDelta,
      jobsCompleted: m.jobsCompleted,
      earnedUsdc: m.earnedUsdc,
      lastActiveAt: m.lastActiveAt,
      likes: m.likes,
      dislikes: m.dislikes,
      delisted: m.delisted,
    })),
  };
}

let saveTimer: NodeJS.Timeout | undefined;
function saveState() {
  // debounce — a burst of mutations writes once.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(stateSnapshot(), null, 2));
    } catch (e) {
      console.warn("could not persist state:", (e as Error).message);
    }
  }, 400);
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (s.counters) {
      stats.jobs = s.counters.jobs ?? 0;
      stats.payments = s.counters.payments ?? 0;
      stats.volumeUsdc = s.counters.volumeUsdc ?? 0;
    }
    for (const [k, v] of Object.entries(s.accounts ?? {})) accounts.set(k, v as Account);
    for (const [k, v] of Object.entries(s.history ?? {})) history.set(k, v as Array<{ ts: number } & Receipt>);
    if (Array.isArray(s.ledger)) ledger.push(...s.ledger);
    if (Array.isArray(s.orders)) orders.push(...(s.orders as StandingOrder[]));
    for (const [k, v] of Object.entries(s.apiKeys ?? {})) if (Array.isArray(v)) apiKeys.set(k.toLowerCase(), v as ApiKeyMeta[]);
    // Reattach earned reputation onto the seeded/registered crew (matched by name
    // + skill) so decay and slashing carry across restarts.
    if (Array.isArray(s.crew)) {
      for (const c of s.crew as Array<Record<string, unknown>>) {
        const m = registry.members.find((x) => x.name === c.name && x.skill === c.skill);
        if (!m) continue;
        if (typeof c.reputation === "number") m.reputation = c.reputation;
        if (typeof c.repDelta === "number") m.repDelta = c.repDelta;
        if (typeof c.jobsCompleted === "number") m.jobsCompleted = c.jobsCompleted;
        if (typeof c.earnedUsdc === "number") m.earnedUsdc = c.earnedUsdc;
        if (typeof c.lastActiveAt === "number") m.lastActiveAt = c.lastActiveAt;
        if (typeof c.likes === "number") m.likes = c.likes;
        if (typeof c.dislikes === "number") m.dislikes = c.dislikes;
        if (c.delisted) m.delisted = true;
      }
    }
    const n = accounts.size;
    if (n) console.log(`  restored ${n} account(s), ${ledger.length} payment(s) from state`);
  } catch {
    /* fresh start */
  }
}

function saveRegistered() {
  const list: StoredAgent[] = registry.members
    .filter((m) => m.registered)
    .map((m) => ({ name: m.name, skill: m.skill, priceUsdc: m.priceUsdc, walletAddress: m.walletAddress, systemPrompt: m.systemPrompt, endpointUrl: m.endpointUrl, status: m.status ?? "approved", audit: m.audit }));
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
    const c = checkSpend(user, budgetUsdc);
    if (!c.ok) {
      broadcast({ type: "declined", reason: c.reason, goal, budgetUsdc, ts: Date.now() });
      broadcast({ type: "log", msg: `🛑 DECLINED: ${c.reason}.`, ts: Date.now() });
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
      ledger.unshift({ ts: Date.now(), crew: li.crew, skill: li.skill, amountUsdc: li.priceUsdc, ref: li.paymentRef, recipient: li.recipient });
    }
    if (ledger.length > 200) ledger.length = 200;
    if (user) {
      const a = acct(user);
      a.spent = Number((a.spent + receipt.spentUsdc).toFixed(6));
      a.spentToday = Number((a.spentToday + receipt.spentUsdc).toFixed(6));
      a.jobsCount += 1;
      broadcast({ type: "account", account: accountView(user), ts: Date.now() });
      const k = user.toLowerCase();
      const h = history.get(k) ?? [];
      h.unshift({ ts: Date.now(), ...receipt });
      if (h.length > 50) h.length = 50;
      history.set(k, h);
    }
    saveState();
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
    const c = checkSpend(user, budgetUsdc);
    if (!c.ok) {
      broadcast({ type: "declined", reason: c.reason, goal, budgetUsdc, ts: Date.now() });
      broadcast({ type: "log", msg: `🛑 DECLINED: ${c.reason}.`, ts: Date.now() });
      return { error: c.reason };
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
    let creditExtended = 0;
    let activeAccounts = 0;
    for (const [k] of accounts) {
      const v = accountView(k);
      creditExtended += v.creditLimit;
      if (v.deposited > 0 || v.spent > 0) activeAccounts += 1;
    }
    json({
      ...stats,
      foreman: foremanAddress,
      brain: usingRealBrain() ? config.groqModel : "mock",
      creditExtended: Number(creditExtended.toFixed(4)),
      accounts: activeAccounts,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/crew") {
    json({ members: crewSnapshot() });
    return;
  }
  // User feedback: 👍/👎 on an agent's work moves its rating (and can delist it).
  if (req.method === "POST" && url.pathname === "/crew/rate") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { agent, vote } = JSON.parse(body || "{}");
        if (vote !== "like" && vote !== "dislike") return json({ error: "vote must be 'like' or 'dislike'" }, 400);
        const m = registry.rate(String(agent ?? ""), vote);
        if (!m) return json({ error: "agent not found (or already delisted)" }, 404);
        saveState();
        broadcast({ type: "crew", members: crewSnapshot() });
        broadcast({
          type: "log",
          msg: m.delisted
            ? `⬇️ ${m.name} was delisted — rating fell below 50 (now ${m.reputation}). The "${m.skill}" skill is open again.`
            : `${vote === "like" ? "👍" : "👎"} ${m.name} rated — reputation now ${m.reputation}`,
          ts: Date.now(),
        });
        json({ ok: true, agent: { name: m.name, skill: m.skill, reputation: m.reputation, delisted: !!m.delisted, likes: m.likes ?? 0, dislikes: m.dislikes ?? 0 } });
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
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
  // Verify a payment: returns the live Circle Gateway settlement record (from →
  // to → amount → status) for a transfer UUID. This is the on-chain proof.
  if (req.method === "GET" && url.pathname === "/transfer") {
    const id = url.searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "valid transfer id required" }, 400);
    if (!gatewayClient) return json({ error: "verification is only available on the gateway rail" }, 400);
    void (async () => {
      try {
        const t = await gatewayClient!.getTransferById(id);
        json({
          id: t.id, status: t.status, from: t.fromAddress, to: t.toAddress,
          amountUsdc: Number(t.amount) / 1e6, createdAt: t.createdAt, updatedAt: t.updatedAt,
          explorer: `https://testnet.arcscan.app/address/${t.toAddress}`,
        });
      } catch (e) {
        json({ error: (e as Error).message }, 502);
      }
    })();
    return;
  }
  // ── Portable credit attestations (EIP-712) ──────────────────────────────────
  // The attester identity + schema, so anyone can verify a signature offline.
  if (req.method === "GET" && url.pathname === "/credit/attester") {
    json({
      attester: attester.address,
      stable: attester.stable,
      domain: attestationDomain(),
      types: ATTESTATION_TYPES,
      primaryType: ATTESTATION_PRIMARY_TYPE,
      note: "EIP-712 signer of Foreman credit attestations. Verify signatures against this address.",
    });
    return;
  }
  // A wallet's current credit score as a signed, independently-verifiable EIP-712
  // attestation. Read-only and unauthenticated — a score is not a secret, and the
  // signature is what makes it trustworthy without querying this server.
  if (req.method === "GET" && url.pathname === "/credit/attestation") {
    const user = url.searchParams.get("user") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) return json({ error: "valid user address required" }, 400);
    const v = accountView(user);
    void (async () => {
      try {
        const message = buildAttestation(user as `0x${string}`, v.creditScore, v.creditLimit, v.creditBand);
        const signature = await attester.sign(message);
        json({
          attester: attester.address,
          signature,
          attestation: {
            subject: message.subject,
            score: Number(message.score),
            creditLimit: Number(message.creditLimit) / 1e6,
            band: message.band,
            issuedAt: Number(message.issuedAt),
            expiry: Number(message.expiry),
          },
          // The exact EIP-712 payload to feed a verifier (uint256 as strings).
          eip712: {
            domain: attestationDomain(),
            types: ATTESTATION_TYPES,
            primaryType: ATTESTATION_PRIMARY_TYPE,
            message: {
              subject: message.subject,
              score: message.score.toString(),
              creditLimit: message.creditLimit.toString(),
              band: message.band,
              issuedAt: message.issuedAt.toString(),
              expiry: message.expiry.toString(),
            },
          },
        });
      } catch (e) {
        json({ error: (e as Error).message }, 500);
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
  // ── Sign-In-With-Ethereum: prove wallet ownership before touching the account ──
  if (req.method === "GET" && url.pathname === "/auth/nonce") {
    const address = url.searchParams.get("address") ?? "";
    const ch = issueChallenge(address);
    if (!ch) return json({ error: "valid address required" }, 400);
    json(ch);
    return;
  }
  if (req.method === "POST" && url.pathname === "/auth/verify") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () =>
      void (async () => {
        try {
          const { address, signature } = JSON.parse(body || "{}");
          const session = await verifyAndMint(String(address ?? ""), String(signature ?? ""));
          if (!session) return json({ error: "signature did not verify (or challenge expired)" }, 401);
          broadcast({ type: "log", msg: `🔐 ${session.address.slice(0, 6)}…${session.address.slice(-4)} verified wallet ownership`, ts: Date.now() });
          json(session);
        } catch {
          json({ error: "bad json" }, 400);
        }
      })(),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/foreman/withdraw") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!gatewayClient) return json({ error: "withdraw is only available on the gateway rail" }, 400);
      void (async () => {
        try {
          const { user, amount } = JSON.parse(body || "{}");
          if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
          if (!ownsAccount(req, String(user))) return json({ error: "verify wallet ownership first" }, 401);
          const amt = Number(amount);
          if (!Number.isFinite(amt) || amt <= 0) return json({ error: "amount must be positive" }, 400);
          const a = acct(String(user));
          const balance = Math.max(0, Number((a.deposited - a.spent).toFixed(6)));
          if (amt > balance) return json({ error: `You can withdraw at most ${balance.toFixed(2)} USDC (your balance).` }, 400);
          if (!gatewayClient!.transferUsdc) return json({ error: "withdraw is not supported on this rail" }, 400);
          // Real USDC from the MPC treasury back to the owner's own wallet.
          const r = await gatewayClient!.transferUsdc(String(user), String(amt));
          // Debit the ledger so the balance drops by exactly what left the treasury.
          a.deposited = Number((a.deposited - amt).toFixed(6));
          saveState();
          broadcast({ type: "log", msg: `🏧 Withdrew ${r.formattedAmount} USDC → ${String(user).slice(0, 6)}…${String(user).slice(-4)}`, ts: Date.now() });
          broadcast({ type: "account", account: accountView(String(user)), ts: Date.now() });
          json({ ok: true, withdrew: r.formattedAmount, tx: r.hash });
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
          // Unproven newcomers are capped — you earn the right to charge more by delivering.
          if (!Number.isFinite(price) || price < 0.001 || price > config.maxAgentPriceUsdc)
            return json({ error: `price must be between 0.001 and ${config.maxAgentPriceUsdc} USDC (new agents are capped until they build a track record)` }, 400);
          if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "a valid wallet address is required to receive earnings" }, 400);

          const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

          // 1) Skill uniqueness: you can't list an agent that does what an existing
          //    live agent already does. Each capability has exactly one provider —
          //    to replace it, the incumbent has to be delisted (rating < 50) first.
          if (registry.hasSkill(skill))
            return json({ error: `the "${skill}" skill is already covered by a live agent — that capability is taken until its rating drops below 50` }, 409);
          // 2) Anti-spam: cap how many agents one wallet can list.
          if (registry.members.filter((m) => m.registered && !m.delisted && m.walletAddress.toLowerCase() === wallet.toLowerCase()).length >= 5)
            return json({ error: "this wallet has reached the limit of 5 listed agents" }, 409);
          // 3) No copy-paste: a near-identical system prompt already exists.
          if (systemPrompt && registry.members.some((m) => !m.delisted && m.systemPrompt && norm(m.systemPrompt) === norm(systemPrompt)))
            return json({ error: "an agent with an identical prompt already exists — make yours distinct" }, 409);

          let reputationSeed: number | undefined;
          let status: "pending" | "approved" = "approved";
          let auditMeta: CrewMember["audit"];
          if (endpointUrl) {
            if (!/^https?:\/\//.test(endpointUrl)) return json({ error: "endpoint must be a valid http(s) URL" }, 400);
            // Proof-of-realness: a genuine x402 agent answers 402 when unpaid.
            if (!(await probeX402(endpointUrl)))
              return json({ error: "endpoint did not return HTTP 402 — not a verifiable x402 paid agent" }, 400);
            // A verified external endpoint still goes through admin review before listing.
            status = "pending";
            auditMeta = { score: 60, reason: "verified x402 endpoint (answered 402) — pending admin review", sample: "", at: Date.now() };
          } else {
            if (systemPrompt.length < 15) return json({ error: "hosted agents need a system prompt of at least 15 characters" }, 400);
            // 5) AI audition: run the agent on a sample task and judge its genuineness.
            broadcast({ type: "log", msg: `🎧 Auditioning "${name}" (${skill})…`, ts: Date.now() });
            const audit = await auditionHostedAgent(skill, systemPrompt);
            if (!audit.pass)
              return json({ error: `audition failed — ${audit.reason}`, sample: audit.sample }, 422);
            reputationSeed = audit.score;
            auditMeta = { score: audit.score, reason: audit.reason, sample: audit.sample, at: Date.now() };
            // AI triage: clearly-excellent agents skip the queue; the rest await an admin.
            status = audit.score >= config.autoApproveScore ? "approved" : "pending";
            broadcast({
              type: "log",
              msg: status === "approved"
                ? `✅ "${name}" passed audition (score ${audit.score}) — auto-approved, now hireable`
                : `🕐 "${name}" passed audition (score ${audit.score}) — queued for admin review`,
              ts: Date.now(),
            });
          }

          const m = registry.register(
            {
              name,
              skill,
              priceUsdc: price,
              walletAddress: wallet,
              systemPrompt: systemPrompt || undefined,
              endpointUrl: endpointUrl || undefined,
            },
            { reputationSeed, status, audit: auditMeta },
          );
          saveRegistered();
          if (isLive(m)) broadcast({ type: "crew", members: crewSnapshot() });
          json(
            { ok: true, status: m.status, agent: { id: m.id, name: m.name, skill: m.skill, priceUsdc: m.priceUsdc, walletAddress: m.walletAddress, reputation: m.reputation, auditScore: auditMeta?.score } },
            201,
          );
        } catch {
          json({ error: "bad json" }, 400);
        }
      })(),
    );
    return;
  }
  // ── Admin moderation (marketplace curation) ─────────────────────────────────
  // Is the admin panel enabled, and is the caller the moderator?
  if (req.method === "GET" && url.pathname === "/admin/status") {
    json({ configured: !!config.adminAddress, admin: isAdmin(req) });
    return;
  }
  // Full agent list for the moderator: pending queue + live + delisted, with the AI verdict.
  if (req.method === "GET" && url.pathname === "/admin/agents") {
    if (!isAdmin(req)) return json({ error: config.adminAddress ? "not authorized — admin only" : "admin panel not configured (set ADMIN_ADDRESS)" }, 403);
    const agents = registry.members.map(adminAgentView).sort((a, b) => {
      // Pending first (needs attention), then by reputation.
      if ((a.status === "pending") !== (b.status === "pending")) return a.status === "pending" ? -1 : 1;
      return b.reputation - a.reputation;
    });
    json({ agents, autoApproveScore: config.autoApproveScore });
    return;
  }
  // Approve / reject / delete / delist / relist / re-audition a specific agent.
  if (req.method === "POST" && url.pathname === "/admin/agent") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () =>
      void (async () => {
        try {
          if (!isAdmin(req)) return json({ error: config.adminAddress ? "not authorized — admin only" : "admin panel not configured (set ADMIN_ADDRESS)" }, 403);
          const { id, action } = JSON.parse(body || "{}");
          const m = registry.byId(String(id ?? ""));
          if (!m) return json({ error: "agent not found" }, 404);
          const name = m.name;
          switch (String(action)) {
            case "approve": {
              if (registry.members.some((x) => x.id !== m.id && x.skill === m.skill && isLive(x)))
                return json({ error: `the "${m.skill}" skill is already served by a live agent — delist that one first` }, 409);
              registry.setStatus(m.id, "approved");
              broadcast({ type: "log", msg: `🟢 admin approved ${name} (${m.skill}) — now hireable`, ts: Date.now() });
              break;
            }
            case "reject":
            case "delete": {
              if (!registry.remove(m.id)) return json({ error: "only registered agents can be removed (seeded crew can be delisted)" }, 400);
              broadcast({ type: "log", msg: `🗑️ admin removed ${name} (${m.skill})`, ts: Date.now() });
              break;
            }
            case "delist": {
              m.delisted = true;
              broadcast({ type: "log", msg: `⬇️ admin delisted ${name} — "${m.skill}" is open again`, ts: Date.now() });
              break;
            }
            case "relist": {
              m.delisted = false;
              if (m.registered) m.status = "approved";
              broadcast({ type: "log", msg: `⬆️ admin relisted ${name} (${m.skill})`, ts: Date.now() });
              break;
            }
            case "reaudition": {
              if (m.endpointUrl || !m.systemPrompt) return json({ error: "re-audition only applies to hosted (prompt) agents" }, 400);
              broadcast({ type: "log", msg: `🎧 re-auditioning ${name} (${m.skill})…`, ts: Date.now() });
              const audit = await auditionHostedAgent(m.skill, m.systemPrompt);
              m.audit = { score: audit.score, reason: audit.reason, sample: audit.sample, at: Date.now() };
              if (!audit.pass) { m.status = "pending"; m.delisted = false; }
              broadcast({ type: "log", msg: `${audit.pass ? "✅" : "❌"} re-audition of ${name}: score ${audit.score} — ${audit.reason}`, ts: Date.now() });
              break;
            }
            default:
              return json({ error: `unknown action "${action}"` }, 400);
          }
          saveRegistered();
          broadcast({ type: "crew", members: crewSnapshot() });
          const agents = registry.members.map(adminAgentView).sort((a, b) => {
            if ((a.status === "pending") !== (b.status === "pending")) return a.status === "pending" ? -1 : 1;
            return b.reputation - a.reputation;
          });
          json({ ok: true, agents });
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
        if (u && !ownsAccount(req, u)) return json({ error: "verify wallet ownership first" }, 401);
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
          const requested = typeof user === "string" && /^0x[0-9a-fA-F]{40}$/.test(user) ? user.toLowerCase() : undefined;
          // Spending from an account requires proof: an API key (headless agents)
          // or a SIWE session. Only anonymous, account-less runs are unauthenticated.
          const owner = agentOwner(req);
          let u: string | undefined;
          if (owner) {
            if (requested && requested !== owner) return json({ error: "your API key does not own that account" }, 403);
            u = owner;
          } else if (requested) {
            return json({ error: "an API key is required to delegate on behalf of an account — mint one in the Foreman app" }, 401);
          }
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
  // Resolve the account behind an API key / session (so a headless agent holding
  // only a key can discover its own account address).
  if (req.method === "GET" && url.pathname === "/whoami") {
    const owner = agentOwner(req);
    if (!owner) return json({ error: "no valid API key or session" }, 401);
    json({ owner });
    return;
  }
  // ── Agent API keys (owner-only, SIWE-gated) ─────────────────────────────────
  // List the active keys for an account (metadata only — never the secret).
  if (req.method === "GET" && url.pathname === "/account/apikeys") {
    const user = url.searchParams.get("user") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) return json({ error: "valid user address required" }, 400);
    if (!ownsAccount(req, user)) return json({ error: "verify wallet ownership first" }, 401);
    json({ keys: apiKeys.get(user.toLowerCase()) ?? [] });
    return;
  }
  // Mint a new key. Returned ONCE — the caller must copy it now.
  if (req.method === "POST" && url.pathname === "/account/apikey") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, label } = JSON.parse(body || "{}");
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
        if (!ownsAccount(req, String(user))) return json({ error: "verify wallet ownership first" }, 401);
        const issued = issueApiKey(String(user));
        if (!issued) return json({ error: "could not issue key" }, 400);
        const owner = String(user).toLowerCase();
        const list = apiKeys.get(owner) ?? [];
        list.push({ id: issued.keyId, createdAt: Date.now(), label: typeof label === "string" ? label.slice(0, 40) : undefined });
        apiKeys.set(owner, list);
        saveState();
        broadcast({ type: "log", msg: `🔑 Agent API key minted for ${owner.slice(0, 6)}…${owner.slice(-4)}`, ts: Date.now() });
        json({ apiKey: issued.apiKey, keyId: issued.keyId }, 201);
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  // Revoke a key by id.
  if (req.method === "POST" && url.pathname === "/account/apikey/revoke") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, keyId } = JSON.parse(body || "{}");
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
        if (!ownsAccount(req, String(user))) return json({ error: "verify wallet ownership first" }, 401);
        const owner = String(user).toLowerCase();
        const list = (apiKeys.get(owner) ?? []).filter((m) => m.id !== String(keyId));
        apiKeys.set(owner, list);
        saveState();
        json({ ok: true, keys: list });
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/account/controls") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, suspended, perJobCap, dailyCap } = JSON.parse(body || "{}");
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
        if (!ownsAccount(req, String(user))) return json({ error: "verify wallet ownership first" }, 401);
        const a = acct(String(user));
        if (typeof suspended === "boolean") a.suspended = suspended;
        if (perJobCap !== undefined && Number.isFinite(Number(perJobCap))) a.perJobCap = Math.max(0, Number(perJobCap));
        if (dailyCap !== undefined && Number.isFinite(Number(dailyCap))) a.dailyCap = Math.max(0, Number(dailyCap));
        broadcast({ type: "log", msg: a.suspended ? `🛑 Agent suspended (kill switch ON)` : `🎛️ Controls updated — per-job $${a.perJobCap}, daily $${a.dailyCap}`, ts: Date.now() });
        broadcast({ type: "account", account: accountView(String(user)), ts: Date.now() });
        saveState();
        json(accountView(String(user)));
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/account/deposit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, amount } = JSON.parse(body || "{}");
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
        if (!ownsAccount(req, String(user))) return json({ error: "verify wallet ownership first" }, 401);
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0) return json({ error: "amount must be positive" }, 400);
        const a = acct(String(user));
        const wasOwed = Math.max(0, a.spent - a.deposited);
        a.deposited = Number((a.deposited + amt).toFixed(6));
        // Any portion that covers outstanding credit counts as a repayment — the
        // single strongest input to the credit score.
        const repaid = Math.min(amt, wasOwed);
        if (repaid > 0) {
          a.repayments += 1;
          a.repaidTotal = Number((a.repaidTotal + repaid).toFixed(6));
          a.lastRepayAt = Date.now();
        }
        broadcast({ type: "log", msg: repaid > 0 ? `💵 Repaid $${repaid.toFixed(2)} of credit (+ deposit) — credit score improving` : `💵 Deposited ${amt} USDC to your Foreman`, ts: Date.now() });
        broadcast({ type: "account", account: accountView(String(user)), ts: Date.now() });
        saveState();
        json(accountView(String(user)));
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  // ── Standing orders (autonomous recurring jobs) ──
  if (req.method === "GET" && url.pathname === "/orders") {
    const user = url.searchParams.get("user") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) return json({ error: "valid user address required" }, 400);
    json({ orders: orders.filter((o) => o.user.toLowerCase() === user.toLowerCase()) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/orders") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, goal, budget, everyMinutes } = JSON.parse(body || "{}");
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(user ?? ""))) return json({ error: "valid user address required" }, 400);
        if (!ownsAccount(req, String(user))) return json({ error: "verify wallet ownership first" }, 401);
        const g = String(goal || "").trim();
        if (g.length < 4) return json({ error: "goal required" }, 400);
        const b = Number(budget);
        if (!Number.isFinite(b) || b <= 0 || b > 50) return json({ error: "budget must be between 0 and 50" }, 400);
        const mins = Math.max(1, Math.round(Number(everyMinutes) || 10));
        if (orders.filter((o) => o.user.toLowerCase() === String(user).toLowerCase()).length >= 10)
          return json({ error: "standing order limit reached (10)" }, 409);
        const o: StandingOrder = {
          id: randomUUID(), user: String(user), goal: g, budget: b, everyMinutes: mins,
          active: true, createdAt: Date.now(), lastRunAt: 0, runs: 0, totalSpent: 0,
        };
        orders.push(o);
        broadcast({ type: "log", msg: `🗓️ Standing order created: "${g}" every ${mins}m ($${b.toFixed(2)}/run)`, ts: Date.now() });
        saveState();
        json({ ok: true, order: o }, 201);
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && (url.pathname === "/orders/toggle" || url.pathname === "/orders/delete")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { user, id } = JSON.parse(body || "{}");
        if (!ownsAccount(req, String(user ?? ""))) return json({ error: "verify wallet ownership first" }, 401);
        const i = orders.findIndex((o) => o.id === id && o.user.toLowerCase() === String(user ?? "").toLowerCase());
        if (i < 0) return json({ error: "order not found" }, 404);
        if (url.pathname === "/orders/delete") {
          orders.splice(i, 1);
        } else {
          orders[i]!.active = !orders[i]!.active;
          if (orders[i]!.active) orders[i]!.lastRunAt = 0; // resume → run soon
        }
        saveState();
        json({ ok: true, orders: orders.filter((o) => o.user.toLowerCase() === String(user).toLowerCase()) });
      } catch {
        json({ error: "bad json" }, 400);
      }
    });
    return;
  }
  json({ error: "not found" }, 404);
});

/**
 * The autonomous loop: every tick, run the next due standing order. Each run is
 * gated by checkSpend, so a tripped kill switch or a hit cap pauses the agent
 * automatically — exactly like a real card declining.
 */
function startScheduler() {
  setInterval(() => {
    // Reputation decay runs every tick (independent of the job lock): idle agents
    // drift toward neutral, so the leaderboard reflects RECENT delivery. Only
    // broadcasts when an integer rating actually moved, so it never spams.
    const { changed, delisted } = registry.decay();
    if (changed.length) {
      broadcast({ type: "crew", members: crewSnapshot() });
      for (const id of delisted) {
        const m = registry.members.find((x) => x.id === id);
        if (m) broadcast({ type: "log", msg: `⬇️ ${m.name} decayed below the bar (idle too long) — delisted; "${m.skill}" is open again.`, ts: Date.now() });
      }
      saveState();
    }

    if (running) return; // respect the single-job lock
    const now = Date.now();
    const due = orders.find((o) => o.active && now - o.lastRunAt >= o.everyMinutes * 60_000);
    if (!due) return;
    due.lastRunAt = now;
    void (async () => {
      broadcast({ type: "log", msg: `⏰ Standing order firing: "${due.goal}"`, ts: Date.now() });
      const out = await delegate(due.goal, due.budget, due.user);
      if (out.receipt) {
        due.runs += 1;
        due.totalSpent = Number((due.totalSpent + out.receipt.spentUsdc).toFixed(6));
        due.lastNote = `ran ${new Date().toLocaleTimeString()} · spent $${out.receipt.spentUsdc.toFixed(2)}`;
      } else {
        // declined (kill switch, cap, or insufficient credit) → auto-pause so it stops retrying.
        due.active = false;
        due.lastNote = `paused — ${out.error}`;
        broadcast({ type: "log", msg: `⏸️ Standing order paused: ${out.error}`, ts: Date.now() });
      }
      saveState();
    })();
  }, 15_000);
}

async function start() {
  loadRegistered();
  loadState();
  // Flush state on shutdown so nothing in the debounce window is lost.
  const flush = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(stateSnapshot(), null, 2));
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  if (RAIL !== "gateway") mockSettlement = new MockSettlement();

  startScheduler();
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  ⚠  Port ${PORT} is already in use — the Foreman engine is probably already running.`);
      console.error(`     Stop the old one first:  lsof -ti:${PORT} -ti:${PORT + 1} | xargs kill\n`);
      process.exit(1);
    }
    throw err;
  });
  // Open the port FIRST so the deploy health check (/stats) answers immediately.
  // The gateway rail is brought up afterwards — so a Circle/RPC/key hiccup can
  // never stop the process from binding and passing the health check.
  server.listen(PORT, () => {
    const custody = config.walletCustody === "circle" ? "circle-MPC" : "local-key";
    console.log(`\n  🟢 Foreman engine API → http://localhost:${PORT}   rail: ${RAIL} · custody: ${custody}`);
    console.log(`     crew: ${registry.members.length} · credit: score-based 10–50% · standing orders: on · persist: on · auth: SIWE`);
    console.log(`     credit attestations: EIP-712 signer ${attester.address} (${attester.source})`);
    console.log(`     GET /stats /crew /activity /history /account /orders /events /credit/attestation   POST /run /delegate /orders /account/* /auth/*\n`);
  });

  if (RAIL === "gateway") {
    // Bring the payment rail up in the background. If it throws (bad key, RPC
    // down, Circle misconfig), the API stays up and payments are simply disabled
    // until it's fixed — the deploy no longer dies on a rail-init error.
    try {
      const { startCrewServer } = await import("./gateway/crewServer");
      const { createForemanGateway } = await import("./gateway/foreman");
      const { createForemanGatewayMPC } = await import("./gateway/foremanMpc");
      const { circleCustodyReady } = await import("./gateway/circleSigner");
      const { gatewayHire } = await import("./gateway/hirer");
      const { generatePrivateKey } = await import("viem/accounts");

      const CREW_PORT = PORT + 1;
      await startCrewServer(registry, CREW_PORT);
      // Custody switch: Circle MPC treasury (no raw key) when configured, else the
      // local raw-key wallet. Both satisfy ForemanGateway, so the rail is identical.
      const useMpc = config.walletCustody === "circle" && circleCustodyReady();
      const gateway = useMpc
        ? createForemanGatewayMPC()
        : createForemanGateway((config.foremanPrivateKey || generatePrivateKey()) as `0x${string}`);
      if (useMpc) console.log("  🔐 treasury custody: Circle MPC (no raw key signs payments)");
      foremanAddress = gateway.address as `0x${string}`;
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
      console.log(`  💸 gateway rail ready · treasury ${foremanAddress}`);
    } catch (e) {
      console.error(`  ⚠ gateway rail init failed — API is up, payments disabled until fixed: ${(e as Error).message}`);
    }
  }
}

void start();
