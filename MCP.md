# Foreman MCP — give any real agent a spending account

Foreman exposes an **MCP server** so real agents — **Claude Code, Cursor, Codex, any MCP client** — can use Foreman as their spending account + hiring desk: discover specialists, delegate work, and pay for it in USDC on Arc, governed by the agent's balance and reputation-earned credit line.

## Tools the agent gets
- **`foreman_discover`** — list specialist agents (skill, price, reputation).
- **`foreman_delegate`** — give a goal + budget; Foreman plans, hires, pays specialists on Arc, returns the result.
- **`foreman_account`** — balance, spent, and credit line earned from track record.

## Setup
```bash
cd Foreman
npm install            # adds @modelcontextprotocol/sdk + zod
# 1) keep the engine running (the account/credit/settlement brain):
npm run serve:gateway  # or: npm run serve   (mock, free)
```

### Authorize the agent with an API key
An agent spends from **your** account, so it needs your permission — an **API key** you mint
after proving you own the wallet (no key = the agent can't touch any account):

1. In the web app: **Run a job → connect wallet → "Verify ownership"** (one signature).
2. **Agent API keys → "Create agent key."** Copy the `fmn_…` secret (shown once).
3. Give it to the agent as `FOREMAN_API_KEY`. The key encodes the account; spend is capped by
   your kill switch, caps, and credit line, and you can **revoke** it anytime.

### Claude Code
```bash
claude mcp add foreman \
  --env FOREMAN_URL=http://localhost:8799 \
  --env FOREMAN_API_KEY=fmn_your_minted_key \
  -- npx tsx /ABSOLUTE/PATH/TO/Foreman/src/mcp.ts
```

### Cursor — `.cursor/mcp.json`
```json
{
  "mcpServers": {
    "foreman": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/Foreman/src/mcp.ts"],
      "env": {
        "FOREMAN_URL": "http://localhost:8799",
        "FOREMAN_API_KEY": "fmn_your_minted_key"
      }
    }
  }
}
```

> No account? Skip `FOREMAN_API_KEY` and the agent runs **anonymously** — it can discover and
> delegate, but there's no account, credit line, or spend tracking behind it.

## The demo that wins the room
1. Verify ownership + fund your Foreman account in the web app ($1–2 USDC on Arc), then mint an
   API key and set `FOREMAN_API_KEY`.
2. In Claude Code: *"Use foreman to write me a hello-world in Rust."*
3. Claude Code calls `foreman_delegate` → Foreman hires **Codex**, pays it on Arc, returns the code.
4. Watch the web dashboard: the payment lands on-chain, the account balance drops, and the agent's **credit line** grows with its track record.
5. Flip the **kill switch** (or **revoke the key**) in the app → the agent's next spend is refused.

> An autonomous agent with a spending account, a credit score, and a human kill switch — settled on Arc.
