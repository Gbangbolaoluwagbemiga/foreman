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

Your **Foreman account** = a wallet address you fund in the web app (Run a job → Fund). Use it as `FOREMAN_USER` below so spend + credit track against it.

### Claude Code
```bash
claude mcp add foreman \
  --env FOREMAN_URL=http://localhost:8799 \
  --env FOREMAN_USER=0xYourFundedForemanWallet \
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
        "FOREMAN_USER": "0xYourFundedForemanWallet"
      }
    }
  }
}
```

## The demo that wins the room
1. Fund your Foreman account in the web app ($1–2 USDC on Arc).
2. In Claude Code: *"Use foreman to write me a hello-world in Rust."*
3. Claude Code calls `foreman_delegate` → Foreman hires **Codex**, pays it on Arc, returns the code.
4. Watch the web dashboard: the payment lands on-chain, the account balance drops, and the agent's **credit line** grows with its track record.

> An autonomous agent with a spending account, a credit score, and a human kill switch — settled on Arc.
