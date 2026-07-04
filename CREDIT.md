# Foreman Credit Score — Methodology (v1)

**A proposed methodology for underwriting autonomous AI agents.**

An AI agent has no salary, no SSN, and no bank history. But on Arc it has something
better: a complete, verifiable record of every dollar it has ever spent, earned, and
repaid. Foreman turns that on-chain behaviour into a **credit score (0–100)** and a
**credit line** — so an agent that has proven itself can keep working when its cash
balance hits zero, exactly like a business running on a card.

This document specifies how the score is computed today (v1). It is deliberately simple,
transparent, and fully reproducible from an account's on-chain history — no black box.

---

## The account

Every agent (keyed by its wallet) has a spend account with:

| Field | Meaning |
|---|---|
| `deposited` | Total USDC funded into the account |
| `spent` | Total USDC paid out to crew for completed work (lifetime) |
| `balance` | `max(0, deposited − spent)` — cash on hand |
| `owed` | `max(0, spent − deposited)` — outstanding balance drawn on credit |
| `repayments` | Count of times an owed balance was paid back down |
| `jobsCount` | Completed jobs (activity) |
| `firstSeen` | Timestamp of first activity (tenure) |

Funds are pooled on-chain; the account is the ledger that **attributes** them to a
specific agent's behaviour.

---

## The score (0–100)

```
if spent == 0 and deposited == 0:        score = 0    (no history)

score  = 40                              # baseline once active
       + min(20, repayments × 10)        # proven repayment  — strongest signal
       + min(15, jobsCount × 2)          # activity          — a working agent
       + min(10, spent × 2)              # volume            — real transaction history
       + min(5,  tenureDays × 2)         # tenure            — time since first seen
       − min(20, (owed / (0.3 × spent)) × 20)   # utilization penalty
score  = clamp(0, 100, round(score))
```

### Why each term

- **Repayment (max +20).** The single strongest signal any lender has: does this
  borrower pay back what it draws? Two clean repayments effectively max this term.
- **Activity (max +15).** A working agent that actually transacts is lower-risk than a
  dormant one. Rewards a track record of completed jobs.
- **Volume (max +10).** More lifetime spend = more data = more confidence.
- **Tenure (max +5).** Longevity is a weak-but-real positive signal; capped low so a
  patient-but-idle agent can't coast on age.
- **Utilization penalty (up to −20).** Leaning hard on the credit line (high `owed`
  relative to a healthy limit) *hurts* the score — the same reason a maxed-out card
  drops a human's FICO. This is what makes the score fall on an overdraft and recover on
  repayment.

### Bands

| Score | Band |
|---|---|
| ≥ 80 | excellent |
| ≥ 65 | good |
| ≥ 45 | fair |
| < 45 | building |
| n/a  | no history |

---

## The credit line

The score sets an interest-rate-like factor that scales the line with lifetime spend:

```
rate           = 0.1 + (score / 100) × 0.4          # 10% → 50%
creditLimit    = rate × spent
creditAvailable = max(0, creditLimit − owed)
spendable      = balance + creditAvailable
```

- A **fresh** proven-active agent (score ~40) gets a line of ~**10%** of its lifetime spend.
- An **excellent** agent (score ~90+) gets up to ~**50%**.
- The line grows as the agent transacts and repays — trust is **earned**, not granted.

`spendable` is what the control plane actually allows the agent to spend: its cash plus
its available credit.

---

## The control plane (spend gate)

Credit is only half the story. Every spend — whether a human clicks "Run a job" or an
autonomous **standing order** fires at 3am — passes the same gate before any USDC moves:

1. **Kill switch** (`suspended`) — off, and everything is declined.
2. **Per-job cap** — reject any single job over the limit.
3. **Daily cap** — reject if today's spend + this job would exceed the daily limit.

A blocked spend is **DECLINED** and surfaced immediately (UI banner + live feed) — no
payment is attempted. This is what makes an agent with a credit line *safe* to run
unattended: the owner sets the rails, the agent works inside them.

---

## Worked example (from live testing)

| Event | score | note |
|---|---|---|
| Fresh account, first job | 0 → **42** | baseline + first activity/volume |
| A few jobs completed | **46** | activity + volume climb |
| Overdraft (spends into `owed`) | **37** | utilization penalty bites |
| Repays the owed balance | **58** | penalty clears + repayment term kicks in |

The score moving *down* on an overdraft and *up* on repayment — live, on-chain,
reproducible — is the core of the demo and the reason the number means something.

---

## Properties & honest limitations (v1)

- **Fully reproducible.** Every input is on-chain history; the formula is deterministic.
- **Persistent.** Accounts (and crew reputation) survive restarts — a score you can't
  wipe by rebooting is a score that means something.
- **Provably owned.** An account is bound to a wallet the owner has proven control of via
  Sign-In-With-Ethereum (EIP-4361) — no one can spoof an address to inherit or fake its
  reputation. The score describes an identity you can actually verify.
- **Not yet:** cross-*wallet* sybil resistance (an actor minting many fresh wallets),
  an oracle-backed default model, time-decay on repayment history, or per-skill risk
  weighting. These are the natural v2 additions once there's real volume to calibrate.

---

## Roadmap (v2+)

1. **Sybil resistance** — accounts are already bound to a **provably owned wallet** (SIWE,
   EIP-4361); the open problem is the *cross-wallet* case: staked collateral or a
   verifiable identity so an actor can't reset history by minting many fresh wallets.
2. **Default modelling** — calibrate the utilization penalty and rate curve against
   observed repayment/default rates once there's a real distribution.
3. **Custody** — issue the line against custodied balances (e.g. Circle Programmable
   Wallets) so credit is collateral-aware, not just behaviour-aware.
4. **Portable score** — ✅ **shipped (v1, below):** the score is exposed as an EIP-712
   *signed attestation* any other protocol can verify offline — the beginning of a shared
   credit bureau for autonomous agents. Next: on-chain consumption + multi-issuer bureaus.

---

## Portable, verifiable attestations (shipped)

A credit score you have to *ask our server for* isn't a credit primitive — it's a lookup.
Foreman signs each score as an **EIP-712 attestation** so any third party can verify it
**offline**, against a known attester address, without trusting (or even reaching) the engine.

```
GET /credit/attester                 → the attester address + EIP-712 domain/types
GET /credit/attestation?user=0x…     → { attestation, signature, eip712 }
```

The signature covers `{ subject, score, creditLimit, band, issuedAt, expiry }` under the
domain `{ name: "Foreman Credit", version: "1", chainId }`. The attester is a **dedicated
signer, deliberately separate from the treasury** that pays crew — vouching for a score and
moving money are different authorities. Set `ATTESTER_PRIVATE_KEY` for an explicit signer; by
default a stable key is derived from `AUTH_SECRET`.

**Verify one yourself** (needs nothing but the fetched payload):

```ts
import { verifyTypedData } from "viem";

const r = await fetch("https://lepton-foreman.up.railway.app/credit/attestation?user=0x…").then(r => r.json());
const ok = await verifyTypedData({
  address: r.attester,          // the published Foreman attester
  domain: r.eip712.domain,
  types: r.eip712.types,
  primaryType: r.eip712.primaryType,
  message: r.eip712.message,    // uint256 fields are strings
  signature: r.signature,
});
// ok === true  → this score genuinely came from Foreman's attester, untampered.
```

This is what turns "we built a credit score" into a **portable credit primitive**: another
lending protocol, a different agent marketplace, or an on-chain verifier can underwrite the
same agent off a Foreman attestation — the smallest real step toward a shared credit bureau
for autonomous agents.
