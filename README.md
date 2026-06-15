# 🏗️ Foreman

**Give your AI a budget and a goal. It hires a crew of other AIs, pays each one per task in USDC on Arc, and brings you the finished work plus an itemized receipt.**

Built for the **Lepton Agents Hackathon** (Canteen × Circle on Arc) — targeting **RFB 03: Agent-to-Agent Nanopayment Networks**.

---

## The idea in one picture

Think of a **general contractor**. You hand them one job and a budget; they hire the
electrician, the carpenter, the painter, pay each for their piece, and hand you the
finished result plus the receipts. Now shrink the contractor to an **AI**, the crew to
**other AIs**, and the money to **fractions of a cent in USDC, moving in seconds on Arc**.

That's Foreman: an autonomous economic actor that discovers specialists, pays them
nano-amounts, and is held together by **reputation** — because at sub-cent prices,
escrow is too heavy, so *reputation is the escrow*.

## Why it fits the hackathon
- **Nano-native:** payments are per-task, sub-cent, USDC-settled on Arc.
- **Agent-to-agent (RFB 03):** a Foreman hires multiple crew; multi-hop work + payment splitting.
- **Reputation as trust:** who-delivered is remembered and compounds in real time.
- **Adoption wedge:** a crew member is just a wallet + a prompt, so the marketplace is
  cheap to seed — and any external x402 service (including other teams' submissions) can
  become crew.

## Architecture (swappable seams)
| Seam | Today | Next | Hackathon target |
|------|-------|------|------------------|
| `AgentSigner` | local viem keypair | — | **Circle Programmable Wallet** |
| `Settlement` | `MockSettlement` | `ArcUsdcSettlement` (real on-chain) | **Circle Gateway nanopayment batching + x402** |
| Brain | Groq `llama-3.3-70b-versatile` (mock fallback) | context-chaining between crew | tool-calling agent loop |
| Reputation | in-memory, persistent per node | on-chain | staking / slashing |

Nothing in the agent logic changes when we flip a seam — that's the whole design.

### Key files
- `src/config.ts` — Arc chain + env
- `src/signer.ts` — `AgentSigner` (local now, Circle later)
- `src/settlement.ts` — payment rails (mock / arc-usdc / Gateway later)
- `src/crew.ts` — crew marketplace + reputation + seeded specialists
- `src/brain.ts` — Foreman planning (decompose goal → subtasks) + crew selection
- `src/orchestrator.ts` — the autonomous hire → pay → assemble loop + receipt
- `src/server.ts` — **live node**: browser dashboard + real-time SSE event stream
- `src/demo.ts` — one-shot CLI demo

## Run it

```bash
cd Foreman
npm install
cp .env.example .env        # optional: add GROQ_API_KEY for the real brain

npm run demo                # one-shot job in the terminal
npm run serve               # live node at http://localhost:8799
```

The live node streams every decision and payment as it happens. Type a goal, set a
budget, hit **Hire a crew →**, and watch the economy run.

Runs fully **offline and free** by default (mock brain + mock settlement). Add a Groq
key for real reasoning; fund a wallet and set `SETTLEMENT_RAIL=arc-usdc` for real USDC on Arc.

---

## 📍 Milestone log

- **2026-06-15 — Project chosen & scaffolded.** Picked RFB 03; "Foreman" framing locked. Fresh TypeScript project (viem + groq-sdk), `AgentSigner` / `Settlement` seams in place.
- **2026-06-15 — First autonomous job end-to-end (mock).** Foreman plans → hires 4 crew → pays each → assembles deliverable → returns itemized receipt with change. Caught & fixed a budget bug that starved the core task.
- **2026-06-15 — Real Groq brain online.** Crew produce real work (research, copy, etc.); reputation persists and compounds across jobs.
- **2026-06-15 — Live node shipped.** `npm run serve` → browser dashboard with real-time SSE stream of decisions, payments, and the crew/reputation table.
- **2026-06-15 — Crew collaborate.** Deliverables chain as context: the proofreader edits the copywriter's actual lines and SEO builds on the refined copy. A real multi-agent pipeline, not isolated workers.
- **2026-06-15 — Published to GitHub.** Repo live (private during build); each milestone committed.
- **2026-06-16 — Real x402 payments.** Crew are now x402 sellers (`HTTP 402 Payment Required`); the Foreman pays per call by signing an **EIP-3009 USDC authorization**, verified cryptographically by the seller before work is released. Run it: `npm run x402`.
- **2026-06-16 — Circle Gateway settlement wired.** Crew run as live x402 sellers behind **Circle Gateway** (`createGatewayMiddleware`, testnet facilitator); the Foreman pays via `GatewayClient` (`deposit` → `pay`), settling real sub-cent USDC on Arc through **Gateway batching**. Compiles against `@circle-fin/x402-batching` v3.1.2. Run: `npm run gateway` (needs a faucet-funded wallet). Using Canteen's authenticated Arc RPC.

### Next up
- Fund a wallet from the Circle faucet → first real on-chain USDC nanopayment.
- Circle Programmable Wallets for the agent fleet.
- Report progress via ARC-cli (`update traction` / `update product`) throughout the event.
- Report progress via ARC-cli (`update traction` / `update product`) throughout the event.
- Recursive subcontracting (crew that hire crew) + an always-on swarm for continuous on-chain volume.
- On-chain reputation; staking/slashing; self-serve crew listing.
