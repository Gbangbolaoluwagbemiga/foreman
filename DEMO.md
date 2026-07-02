# Foreman — 3-minute demo script

**One story, told once:** an AI agent with no cash works on the credit it earned, pays
real specialists in USDC on Arc, and stays completely under your control.

**Tagline to land twice (open + close):** *"The first AI agent with a credit score —
MCP-native on Arc."*

**Setup before recording**
- Engine on the gateway rail **under MPC custody**: `WALLET_CUSTODY=circle` in `.env`, then
  `ENGINE_RAIL=gateway npm run serve:gateway`. Confirm the console shows
  `🔐 treasury custody: Circle MPC` and the banner reads `custody: circle-MPC` — worth a
  quick capture; it proves no raw key is in play.
- Treasury funded on Arc (so deposit + payments settle) + web app running (or deployed URLs).
- Clean baseline (5 house agents, one funded account).
- Two windows ready: **Claude Code** (MCP) and the **Foreman web app** (Run a job page).
- Wallet connected; account has a small balance so the credit arc is visible.

---

### 0:00–0:20 — The hook
> "AI agents can think and act — but they can't pay for anything, and you can't control
> what they spend. Foreman fixes both. It's a spending account, a hiring desk, and a
> **credit line** for AI agents — settled in USDC on Arc. The first AI agent with a
> credit score."

**On screen:** Foreman landing / dashboard, "engine live", volume + payments ticking.

### 0:20–0:50 — Plug it into a real agent (MCP)
**On screen:** Claude Code. Run `foreman_account` → shows balance + earned credit line.
> "This is Claude Code with Foreman as an MCP tool. Its agent now has an account — a
> balance, and a credit line it *earned* from its track record."

Run `foreman_discover` → the crew list with skills, USDC prices, reputation.
> "It can see specialists it can hire — each with a price and an on-chain reputation."

### 0:50–1:30 — Delegate → real payment → verify on-chain
**On screen:** `foreman_delegate` a real goal (e.g. "research + copy for a coffee-shop
launch, budget $1"). Result comes back with the crew it paid.
> "I delegate a job. Foreman plans it, hires the right specialists, and pays each one in
> real USDC on Arc — then hands back the finished work."

Switch to the web app → connect wallet → click **"Verify ownership"** → sign once → the
green **✓ verified owner** badge appears.
> "In the dashboard I prove I own this wallet — one signature, Sign-In-With-Ethereum. Now
> only I can fund this account, run jobs on it, or flip its kill switch. The credit score
> belongs to an identity you can actually verify, not a spoofable address."

Then **On-chain payments** → click **"✓ verify on-chain."**
> "And every payment is real and verifiable. This isn't a mock — here's the settlement on
> Circle's rail. Nothing on this screen is faked."

**(Custody punch line — point at the `🔐 Circle MPC` banner / console.)**
> "And here's the part that makes this real infrastructure: **no private key ever signs
> these payments.** The treasury is a **Circle Programmable Wallet** — MPC. Circle holds the
> key shares; Foreman authorizes every payment, deposit, and withdrawal through Circle. Even
> if someone owned our whole server, they couldn't move a cent. That's the difference
> between a demo and a bank."

### 1:30–2:00 — The self-healing marketplace
**On screen:** Run a job in the web app, then 👎 **downvote** a weak agent in the receipt.
Its reputation drops below 50 → **delisted**; the skill frees up and a better agent covers it.
> "Users rate the work. An agent that underdelivers gets downvoted, and below the bar it's
> automatically delisted — the skill reopens for a better agent. The marketplace heals itself."

### 2:00–2:30 — Control: the DECLINED moment
**On screen:** Operator controls → flip the **kill switch ON** (or set a low cap) → run a
job → the big red **DECLINED — no payment** banner.
> "You're always in control. Flip the kill switch, or set a per-job or daily cap. Over the
> line? The spend is **declined before any USDC moves** — even when the agent runs
> autonomously at 3am on a standing order."

### 2:30–2:55 — Credit is earned: repay → score jumps
**On screen:** The account has drawn on credit (owed > 0). Repay → the **credit score
climbs** live (e.g. 37 → 58), the band moves up, the credit line grows.
> "And the credit is real. When the agent repays what it drew, its score climbs and its
> line grows — trust it *earned*, on-chain, that survives restarts. Here's the methodology,
> published."  *(flash CREDIT.md)*

### 2:55–3:00 — Close
> "Foreman: a spending account, control plane, and credit line for AI agents. The first AI
> agent with a credit score — MCP-native on Arc."

**On screen:** the tagline + the live dashboard.

---

## Do / Don't
- **Do** click "verify on-chain" on camera — the verifiability is the whole pitch.
- **Do** let the DECLINED banner and the score jump sit on screen for a beat.
- **Don't** fake anything — no ticking-balance animations, no mock data. Every number is
  real and reproducible; that's the differentiator, don't undercut it.
- **Don't** over-explain the formula on camera — say "earned from its track record," point
  at CREDIT.md, move on.

## The one-liner (for the submission form)
> Foreman is the spending account, control plane, and credit line for AI agents —
> MCP-native on Arc. Agents discover and pay specialists in real USDC from a **Circle MPC
> treasury (no raw key)**, earn a credit score from their on-chain track record, and spend
> only inside your kill switch and caps.
