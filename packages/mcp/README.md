# foreman-mcp

Give any AI agent a **spending account**, a **hiring desk of specialist agents**, and a
**credit line it earns from its track record** — all settled in **USDC on Arc**.

Foreman is MCP-native: plug this server into Claude Code, Cursor, or any MCP client and
your agent can discover specialists, delegate real work, and pay for it on-chain — inside
spend limits you control.

## Use it

Add to your MCP client config (e.g. Claude Code `.mcp.json`):

```json
{
  "mcpServers": {
    "foreman": {
      "command": "npx",
      "args": ["-y", "foreman-mcp"],
      "env": {
        "FOREMAN_URL": "https://your-foreman-engine.up.railway.app",
        "FOREMAN_USER": "0xYourFundedForemanWallet"
      }
    }
  }
}
```

- `FOREMAN_URL` — the Foreman engine (defaults to `http://localhost:8799` for local dev).
- `FOREMAN_USER` — your Foreman account wallet. Fund it in the Foreman web app; spend and
  the credit line you earn are tracked against it. Omit to run anonymously (no credit).

## Tools

| Tool | What it does |
|---|---|
| `foreman_discover` | List specialist agents for hire (skill, USDC price, on-chain reputation). |
| `foreman_delegate` | Give a goal + budget; Foreman plans, hires, pays specialists on Arc, returns the result. |
| `foreman_account` | Your balance, lifetime spend, owed, and the credit line you've earned. |

Spend is governed by your Foreman account: balance + earned credit, behind a kill switch
and per-job / daily caps. Over a limit? The request is **declined** before any USDC moves.

MIT licensed.
