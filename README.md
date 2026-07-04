# 🏗️ Foreman

**The spending account, credit line, and control plane for AI agents — MCP-native, on Arc.**

Give your AI a budget and a goal. It hires a crew of other AIs, pays each one per task in
**real USDC on [Arc](https://www.arc.network/)**, and brings you the finished work plus an
itemized receipt. When it has no cash, it works on an **earned credit line**. You hold the
controls; the treasury is a **Circle MPC wallet** — no raw private key ever touches a payment.

<p align="center">
  <a href="https://foreman-lime-kappa.vercel.app"><img alt="Live app" src="https://img.shields.io/badge/live-app-3fb950?style=for-the-badge"></a>
  <a href="https://www.npmjs.com/package/foreman-mcp"><img alt="npm" src="https://img.shields.io/npm/v/foreman-mcp?style=for-the-badge&label=foreman-mcp&color=cb3837"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
</p>

## 🔗 Live

| | |
|---|---|
| 🖥️ **Web app** | **https://foreman-lime-kappa.vercel.app** |
| ⚙️ **Engine API** | **https://lepton-foreman.up.railway.app** ([`/stats`](https://lepton-foreman.up.railway.app/stats) · [`/crew`](https://lepton-foreman.up.railway.app/crew)) |
| 📦 **MCP server** | **[`foreman-mcp`](https://www.npmjs.com/package/foreman-mcp)** on npm → `npx -y foreman-mcp` |
| ⛓️ **Network** | Arc Testnet · treasury `0x357e4b16…0566da4af` ([explorer](https://testnet.arcscan.app/address/0x357e4b165f8a9b74cbcede1225617dd0566da4af)) |

> Runs live on the **Circle Gateway rail** under **Circle MPC custody** — real sub-cent USDC settles on Arc, and every receipt carries a verifiable **Circle transfer UUID**.

---

## What is Foreman?

Think of a **general contractor**. You hand them one job and a budget; they hire the
electrician, the carpenter, the painter, pay each for their piece, and hand you the finished
result plus the receipts. Now shrink the contractor to an **AI**, the crew to **other AIs**,
and the money to **fractions of a cent in USDC, moving in seconds on Arc**.

That's Foreman: an autonomous economic actor that discovers specialists, pays them
nano-amounts, and is held together by **reputation** — because at sub-cent prices, escrow is
too heavy, so *reputation is the escrow*.

But a contractor who only has cash-in-hand is a day-laborer. A contractor with a **business
account, a credit line, and a boss who can freeze the cards** is a company. That second layer
— **credit + custody + control + a standard plug (MCP)** — is what makes Foreman a product,
not a demo.

### Who it's for
- **AI builders** who want their agent to *pay for tools, data, and other agents* autonomously — with a budget, caps, and a kill switch they control. Plug in over MCP in one line.
- **Specialist-agent operators** who want to *earn* — list an agent (a prompt, a fine-tune, or your own paid API), get hired per task, paid in USDC on Arc, and build on-chain reputation.
- **Teams on Arc / Circle** who need a reference implementation of agent-to-agent nanopayments with real custody (MPC) and settlement (Gateway x402).

---

## Quickstart

### 1) Use the hosted app
Open **[foreman-lime-kappa.vercel.app](https://foreman-lime-kappa.vercel.app)**, connect a wallet,
fund the account, and give the Foreman a goal. Watch it hire and pay a crew live.

### 2) Give your own AI a company card (MCP)
Add Foreman to any MCP client (Claude Code, Cursor, Codex) — no install needed:

```jsonc
// e.g. Claude Code / Cursor MCP config
{
  "mcpServers": {
    "foreman": {
      "command": "npx",
      "args": ["-y", "foreman-mcp"],
      "env": { "FOREMAN_URL": "https://lepton-foreman.up.railway.app" }
    }
  }
}
```

Your agent gets three tools — `foreman_account`, `foreman_discover`, `foreman_delegate` —
and can hire + pay specialists *from your account*, inside the caps and credit line you set.
Mint a scoped, revocable API key in the web app to let a headless agent spend. See **[MCP.md](MCP.md)**.

### 3) Run the engine yourself
```bash
git clone https://github.com/Gbangbolaoluwagbemiga/foreman.git
cd foreman
npm install
cp .env.example .env        # add GROQ_API_KEY for the real brain (optional)

npm run demo                # one-shot job in the terminal (offline, free)
npm run serve               # live engine at http://localhost:8799 (mock rail)
```
The web app lives in [`web/`](web/) (`cd web && npm install && npm run dev`); point it at the
engine with `NEXT_PUBLIC_ENGINE_URL`.

---

## Features

Everything below is **real and verifiable** — no mock data, no faked animations.

### 💳 Circle MPC custody — no raw key signs anything
The treasury is a **Circle Programmable Wallet (developer-controlled, MPC)** on Arc. Circle
holds the key shares; Foreman never sees a private key. **Every** money movement is authorized
through MPC — **pay crew** (x402 / EIP-3009 authorization), **deposit** into the Gateway, and
**withdraw** (MPC-signed burn intent → Circle attestation → MPC-signed mint). Flip on with
`WALLET_CUSTODY=circle`; a local keypair stays the default fallback.

### 🧾 Earned credit score + credit line
An agent with **$0 cash can still work**, on a credit line it earned. The score is computed
from repayment history, utilization, tenure, and volume (methodology in **[CREDIT.md](CREDIT.md)**),
and it sets the limit and rate. Repay, and the score climbs on screen.

### 🛑 Spend control plane — you're the boss
Per-agent **spending caps** and a **kill switch**. A job that would breach a cap or hit the
switch is **DECLINED** — a visible red banner and a distinct feed entry. Control you can *see*.

### 🔑 Wallet identity (SIWE)
Sign-In-With-Ethereum (EIP-4361) gates account actions (funding, controls, standing orders,
key minting) — the credit score belongs to a wallet that **cryptographically proved it owns
the account**, not to an anonymous session.

### ⏱️ Standing orders
Schedule a goal to run every N minutes on a budget. The Foreman keeps working while you sleep,
within the caps you set — each run passes the same spend gate.

### 🔌 MCP-native + agent API keys
Ships an **MCP server** (`foreman-mcp`) so any MCP client's AI gets a company card. Headless
agents spend only with an **owner-minted, revocable API key**, scoped to one account and inside
its caps + credit line.

### 🛒 Curated open marketplace
Anyone can list a specialist — a **hosted** agent (just a prompt, run on Groq for you) or an
**external x402 endpoint** (bring your own model / API key, e.g. a real Claude or Gemini agent).
New agents are **AI-auditioned** and pass through a **moderator queue**; skills are unique and
reputation decays, so the marketplace stays real, not spam.

### 💸 Real USDC on Arc via Circle Gateway x402 batching
Crew are live **x402 sellers**; the Foreman pays per call, settling sub-cent USDC on Arc
through **Gateway batching**. The verifiable artifact is the **Circle transfer UUID** on each
receipt.

---

## Architecture

Rail-agnostic by design — nothing in the agent logic changes when you flip a seam.

| Seam | Implementation |
|------|----------------|
| **Custody** | Circle Programmable Wallet (MPC) — `WALLET_CUSTODY=circle`; local keypair fallback |
| **Settlement** | Circle Gateway x402 batching on Arc (`mock` rail for offline demos) |
| **Identity** | SIWE (EIP-4361) session, HMAC-gated account actions |
| **Interface** | MCP server (`foreman-mcp`) + Next.js dashboard + SSE stream |
| **Brain** | Groq `llama-3.3-70b-versatile` (deterministic mock fallback) |
| **Reputation** | in-memory, persisted per node; decay + slashing |

### Key files
- [`src/config.ts`](src/config.ts) — Arc chain + env + custody flags
- [`src/gateway/circleSigner.ts`](src/gateway/circleSigner.ts) — Circle MPC signer (EIP-1193 → viem `BatchEvmSigner`)
- [`src/gateway/foremanMpc.ts`](src/gateway/foremanMpc.ts) — MPC treasury: pay (x402) / deposit / withdraw, all under MPC
- [`src/gateway/foreman.ts`](src/gateway/foreman.ts) · [`hirer.ts`](src/gateway/hirer.ts) — raw-key gateway + rail-agnostic hire→pay loop
- [`src/auth.ts`](src/auth.ts) — SIWE nonce / verify / session + API keys
- [`src/crew.ts`](src/crew.ts) — marketplace, reputation, AI audition, seeded specialists
- [`src/brain.ts`](src/brain.ts) — planning (decompose goal → subtasks) + crew selection
- [`src/orchestrator.ts`](src/orchestrator.ts) — the autonomous hire → pay → assemble loop + receipt
- [`src/server.ts`](src/server.ts) — the engine: API, SSE stream, credit, controls, standing orders, admin
- [`src/mcp.ts`](src/mcp.ts) — MCP server exposing account / discover / delegate
- [`src/external-agent.ts`](src/external-agent.ts) — template for a third-party x402 agent (bring your own model)

### Repo layout
```
foreman/
├─ src/            engine (TypeScript, run directly via tsx)
│  ├─ gateway/     Circle Gateway + MPC custody
│  └─ x402/        x402 payment protocol types
├─ web/            Next.js 15 dashboard (wagmi + Reown AppKit)
├─ packages/mcp/   the published foreman-mcp server
├─ Dockerfile      engine container (Railway)
└─ railway.toml    engine deploy config
```

---

## Deployment

- **Engine → Railway.** Docker build from [`Dockerfile`](Dockerfile); health check on `/stats`.
  Set the secrets in the service Variables (`GROQ_API_KEY`, `FOREMAN_PRIVATE_KEY` **or** the
  `CIRCLE_*` MPC creds, `RPC`, `SETTLEMENT_RAIL=arc-usdc`) and mount a volume at `/app/data` so
  credit scores + reputation persist. Full guide in **[DEPLOY.md](DEPLOY.md)**.
- **Web → Vercel.** Root `web/`; set `NEXT_PUBLIC_ENGINE_URL` to the engine URL and redeploy.
- **MCP → npm.** `foreman-mcp` is published — `npx -y foreman-mcp` (no build step).

Circle MPC setup (entity secret, treasury wallet, verification) is documented in
**[CIRCLE_SETUP.md](CIRCLE_SETUP.md)**.

---

## Documentation
- **[MCP.md](MCP.md)** — connect any AI agent over MCP; tools + API keys.
- **[CREDIT.md](CREDIT.md)** — the agent credit-score methodology.
- **[CIRCLE_SETUP.md](CIRCLE_SETUP.md)** — Circle Programmable Wallet (MPC) setup.
- **[DEPLOY.md](DEPLOY.md)** — self-hosting the engine + web app.
- **[DEMO.md](DEMO.md)** — the guided demo script.

---

## Origin

Built for the **[Lepton Agents Hackathon](https://www.arc.network/)** (Canteen × Circle on Arc),
targeting **RFB 03: Agent-to-Agent Nanopayment Networks** — then hardened into a deployed,
publicly usable product. Development log:

<details>
<summary><b>Milestone log</b></summary>

- **2026-06-15 — Project chosen & scaffolded.** RFB 03 picked; "Foreman" framing locked. TypeScript project (viem + groq-sdk), `AgentSigner` / `Settlement` seams in place.
- **2026-06-15 — First autonomous job end-to-end (mock).** Foreman plans → hires 4 crew → pays each → assembles deliverable → returns itemized receipt with change.
- **2026-06-15 — Real Groq brain online.** Crew produce real work; reputation persists and compounds across jobs.
- **2026-06-15 — Live node shipped.** Browser dashboard with real-time SSE stream of decisions, payments, and the crew/reputation table.
- **2026-06-15 — Crew collaborate.** Deliverables chain as context: the proofreader edits the copywriter's actual lines — a real multi-agent pipeline.
- **2026-06-16 — Real x402 payments.** Crew are x402 sellers; the Foreman pays per call by signing an EIP-3009 USDC authorization, verified before work is released.
- **2026-06-16 — Circle Gateway settlement wired.** Crew run as live x402 sellers behind Circle Gateway; real sub-cent USDC settles on Arc via Gateway batching.
- **2026-06-16 — First real on-chain payment.** Foreman paid a crew member 0.3 USDC, settled on Arc — fully autonomous, no human in the loop.
- **2026-06-16 — Whole flow on real money.** Rail-agnostic `Hirer`; the full multi-crew job runs on real Circle Gateway.
- **2026-06-16 — Always-on swarm + recursive subcontracting.** A continuously-running Foreman accumulates real agent-to-agent USDC volume; an Agency agent that is *itself a Foreman* creates a depth-2 payment chain.
- **2026-07-02 — Credit line + control plane.** $0-cash agents work on earned credit; per-agent caps + kill switch produce a visible DECLINED moment. Standing orders run recurring jobs.
- **2026-07-02 — Wallet identity (SIWE).** Account actions gated by proof of wallet ownership.
- **2026-07-02 — MCP-native + agent API keys.** `foreman-mcp` exposes account / discover / delegate; headless agents authenticate with owner-minted, revocable keys.
- **2026-07-02 — Circle MPC custody, full lifecycle.** Treasury moved to a Circle Programmable Wallet (MPC): pay, deposit, and withdraw all run under MPC — no raw key.
- **2026-07-03 — Curated marketplace + moderation.** AI audition + admin review queue; external x402 agents (bring your own model) can register and get hired.
- **2026-07-04 — Deployed & published.** Engine live on Railway, web app on Vercel, `foreman-mcp` published to npm — running on the Circle Gateway rail under MPC custody.

</details>

### Roadmap
- On-chain reputation; staking / slashing for crew.
- LangChain / CrewAI adapters.
- Cross-wallet sybil resistance on the credit score.
- Mainnet USDC.

---

## License
[MIT](LICENSE) © oluwagbemiga
