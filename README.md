# 🏗️ Foreman

**The spending account, credit line, and control plane for AI agents — MCP-native, on Arc.**

Give your AI a budget and a goal. It hires a crew of other AIs, pays each one per task in
**real USDC on Arc**, and brings you the finished work plus an itemized receipt. When it has
no cash, it works on an **earned credit line**. You hold the controls; the treasury is a
**Circle MPC wallet** — no raw private key ever touches a payment.

Built for the **Lepton Agents Hackathon** (Canteen × Circle on Arc) — targeting
**RFB 03: Agent-to-Agent Nanopayment Networks**.

---

## The idea in one picture

Think of a **general contractor**. You hand them one job and a budget; they hire the
electrician, the carpenter, the painter, pay each for their piece, and hand you the finished
result plus the receipts. Now shrink the contractor to an **AI**, the crew to **other AIs**,
and the money to **fractions of a cent in USDC, moving in seconds on Arc**.

That's Foreman: an autonomous economic actor that discovers specialists, pays them
nano-amounts, and is held together by **reputation** — because at sub-cent prices, escrow is
too heavy, so *reputation is the escrow*.

But a contractor who only has cash-in-hand is a day-laborer. A contractor with a **business
account, a credit line, and a boss who can freeze the cards** is a company. That second layer
— **credit + custody + control + a standard plug (MCP)** — is what makes Foreman defensible.

---

## What's built (the differentiator layer)

Everything below is **real and verifiable** — no mock data, no faked animations.

### 💳 Circle MPC custody — no raw key signs anything
The Foreman treasury is a **Circle Programmable Wallet (developer-controlled, MPC)** on Arc.
Circle holds the key shares; Foreman never sees a private key. **Every** money movement is
authorized through Circle MPC:
- **Pay crew** — signs the x402 / EIP-3009 payment authorization under MPC.
- **Deposit** into the Gateway — MPC-signed on-chain tx.
- **Withdraw** — MPC-signed burn intent + Circle attestation + MPC-signed mint back.

Flip it on with `WALLET_CUSTODY=circle`; prove it with `npm run circle:verify` and
`npm run circle:withdraw -- 0.5`. Local raw-key mode stays the default so the demo can't break.

### 🧾 Earned credit score + credit line — the first AI agent with a credit score
An agent with **$0 cash can still work**, on a credit line it earned. The score is computed
from repayment history, utilization, tenure, and volume (methodology in
[CREDIT.md](CREDIT.md)), and it sets the credit limit and rate. Repay, and the score climbs
on screen.

### 🛑 Spend control plane — you're the boss
Per-agent **spending caps** and a **kill switch**. When a job would breach a cap or the switch
is on, it's **DECLINED** — a red banner on screen and a distinct feed entry. Control you can
*see*.

### 🔑 Wallet identity (SIWE) — a provably-owned account
Sign-In-With-Ethereum gates the account actions (funding, controls, standing orders): the
credit score belongs to a wallet that **cryptographically proved it owns the account**, not to
an anonymous session.

### ⏱️ Standing orders — recurring autonomous work
Schedule a goal to run every N minutes on a budget. The Foreman keeps working while you sleep,
within the caps you set.

### 🔌 MCP-native + agent API keys — plug in any agent, keep the leash
Foreman ships an **MCP server** (`foreman-mcp`). Drop it into Claude Code (or any MCP client)
and your AI gets `foreman_account`, `foreman_discover`, and `foreman_delegate` tools — "your
AI just got a company card." A headless agent spends only with an **API key you mint** (after
proving wallet ownership) — scoped to that account, inside its caps + credit line, and
**revocable anytime**. See [MCP.md](MCP.md).

### 💸 Real USDC on Arc via Circle Gateway x402 batching
Crew are live **x402 sellers**; the Foreman pays per call, settling sub-cent USDC on Arc
through **Gateway batching**. The verifiable artifact is the **Circle transfer UUID** on each
receipt.

---

## Why it fits the hackathon
- **Nano-native:** payments are per-task, sub-cent, USDC-settled on Arc.
- **Agent-to-agent (RFB 03):** a Foreman hires multiple crew; multi-hop work + payment
  splitting; an Agency agent that is itself a Foreman (emergent broker).
- **Circle tooling, full lifecycle:** Gateway x402 batching **and** Programmable Wallets (MPC)
  for pay, deposit, and withdraw.
- **Reputation as trust:** who-delivered is remembered and compounds in real time.
- **Adoption wedge:** a crew member is just a wallet + a prompt, so the marketplace is cheap to
  seed — any external x402 service (including other teams' submissions) can become crew.

## Architecture (swappable seams)
| Seam | Status | Implementation |
|------|--------|----------------|
| Custody | ✅ **done** | **Circle Programmable Wallet (MPC)** — `WALLET_CUSTODY=circle`; local keypair as fallback |
| Settlement | ✅ **done** | **Circle Gateway x402 batching** on Arc (`mock` rail available for offline demos) |
| Identity | ✅ **done** | **SIWE** (EIP-4361) session, HMAC-gated account actions |
| Interface | ✅ **done** | **MCP server** (`foreman-mcp`) + browser dashboard + SSE stream |
| Brain | ✅ live | Groq `llama-3.3-70b-versatile` (deterministic mock fallback) |
| Reputation | ✅ live | in-memory, persisted per node | 

Nothing in the agent logic changes when we flip a seam — that's the whole design.

### Key files
- `src/config.ts` — Arc chain + env + custody flags
- `src/gateway/circleSigner.ts` — **Circle MPC signer** (EIP-1193 → viem `BatchEvmSigner`)
- `src/gateway/foremanMpc.ts` — **MPC treasury**: pay (x402) / deposit / withdraw, all under MPC
- `src/gateway/foreman.ts` / `hirer.ts` — raw-key gateway + rail-agnostic hire→pay loop
- `src/auth.ts` — SIWE nonce / verify / session
- `src/crew.ts` — crew marketplace + reputation + seeded specialists
- `src/brain.ts` — Foreman planning (decompose goal → subtasks) + crew selection
- `src/orchestrator.ts` — the autonomous hire → pay → assemble loop + receipt
- `src/server.ts` — **live node**: dashboard, SSE stream, credit, controls, standing orders
- `src/mcp.ts` — MCP server exposing account / discover / delegate

## Run it

```bash
cd Foreman
npm install
cp .env.example .env        # add GROQ_API_KEY for the real brain (optional)

npm run demo                # one-shot job in the terminal (offline, free)
npm run serve               # live node at http://localhost:8799 (mock rail)
```

**Real money on Arc (Circle Gateway):**
```bash
ENGINE_RAIL=gateway npm run serve:gateway    # settles real USDC on Arc
```

**Under Circle MPC custody** (set `WALLET_CUSTODY=circle` in `.env` first — see
[CIRCLE_SETUP.md](CIRCLE_SETUP.md)):
```bash
npm run circle:register     # one-time: register your entity secret
npm run circle:setup        # create the MPC treasury wallet on Arc
npm run circle:verify       # prove MPC signs payments (no funds needed)
npm run circle:withdraw -- 0.5   # prove the MPC withdrawal round-trip
```
Then `ENGINE_RAIL=gateway npm run serve:gateway` shows
`🔐 treasury custody: Circle MPC` — every payment signed by MPC, no raw key.

Runs fully **offline and free** by default (mock brain + mock settlement). Add a Groq key for
real reasoning; fund the treasury and use the gateway rail for real USDC on Arc.

---

## 📍 Milestone log

- **2026-06-15 — Project chosen & scaffolded.** Picked RFB 03; "Foreman" framing locked. Fresh TypeScript project (viem + groq-sdk), `AgentSigner` / `Settlement` seams in place.
- **2026-06-15 — First autonomous job end-to-end (mock).** Foreman plans → hires 4 crew → pays each → assembles deliverable → returns itemized receipt with change.
- **2026-06-15 — Real Groq brain online.** Crew produce real work; reputation persists and compounds across jobs.
- **2026-06-15 — Live node shipped.** `npm run serve` → browser dashboard with real-time SSE stream of decisions, payments, and the crew/reputation table.
- **2026-06-15 — Crew collaborate.** Deliverables chain as context: the proofreader edits the copywriter's actual lines. A real multi-agent pipeline, not isolated workers.
- **2026-06-16 — Real x402 payments.** Crew are x402 sellers; the Foreman pays per call by signing an **EIP-3009 USDC authorization**, verified by the seller before work is released. `npm run x402`.
- **2026-06-16 — Circle Gateway settlement wired.** Crew run as live x402 sellers behind **Circle Gateway**; the Foreman pays via `GatewayClient`, settling real sub-cent USDC on Arc through **Gateway batching**. `npm run gateway`.
- **2026-06-16 — First real on-chain payment.** Foreman paid Quill **0.3 USDC, settled on Arc via Gateway batching** — fully autonomous, no human in the loop.
- **2026-06-16 — Whole flow on real money.** Rail-agnostic `Hirer`; the full multi-crew job runs on real Circle Gateway. `npm run gateway:job`.
- **2026-06-16 — Always-on swarm.** A Foreman continuously takes jobs and pays a crew, accumulating real agent-to-agent USDC volume + a compounding reputation economy. `SWARM_RAIL=gateway npm run swarm`.
- **2026-06-16 — Recursive subcontracting + resilience.** An Agency agent that is *itself a Foreman*: takes a fee, hires sub-crew, keeps a margin — a depth-2 payment chain and an emergent broker. `npm run subcontract`.
- **2026-07-02 — Credit line + control plane.** An agent with **$0 cash works on its earned credit** (methodology in [CREDIT.md](CREDIT.md)); per-agent **spending caps + kill switch** produce a visible **DECLINED** moment. Standing orders run recurring jobs autonomously.
- **2026-07-02 — Wallet identity (SIWE).** Sign-In-With-Ethereum gates account actions — the credit score belongs to a **provably-owned** wallet.
- **2026-07-02 — MCP-native + agent API keys.** Publishable `foreman-mcp` exposes `foreman_account` / `foreman_discover` / `foreman_delegate` to any MCP client (e.g. Claude Code). Headless agents authenticate with an **owner-minted, revocable API key** scoped to one account — spending from an account now *requires* proof (key or SIWE session). Mint/revoke keys in the web app.
- **2026-07-02 — Circle MPC custody, full lifecycle, proven live.** Treasury moved to a **Circle Programmable Wallet (MPC)** on Arc. **Pay, deposit, and withdraw all run under MPC** — no raw key. Validated on-chain: MPC-signed Gateway deposit + a crew payment (real Circle transfer UUID) + a `circle:withdraw` round-trip. Gated behind `WALLET_CUSTODY=circle`; local rail stays default.

### Next up
- Deploy so judges can try it live (Railway engine + Vercel web + `npx -y foreman-mcp`).
- On-chain reputation; staking/slashing; self-serve crew listing.
- LangChain / CrewAI adapters; cross-wallet sybil resistance on the credit score.
