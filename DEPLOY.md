# Deploying Foreman

Three pieces: the **engine** (Railway), the **web app** (Vercel), and the **MCP package**
(npm). Do them in that order — the web app and MCP both point at the engine's public URL.

---

## 1. Engine → Railway

The engine is a long-running Node server (HTTP API on `$PORT`, internal crew server on
`$PORT+1`). It runs the **gateway rail** (real USDC settlement on Arc). No build step —
`tsx` runs the TypeScript directly. Ships as a `Dockerfile`; `railway.toml` sets the
health check.

1. New Railway project → **Deploy from GitHub repo** (the `Foreman` repo). Railway
   auto-detects the `Dockerfile`.
2. **Variables** (Service → Variables) — set the secrets (never commit these):

   | Variable | Value |
   |---|---|
   | `GROQ_API_KEY` | your Groq key (planning + agent LLM) |
   | `FOREMAN_PRIVATE_KEY` | the agent wallet that settles USDC (`0x…`) |
   | `RPC` | Arc authenticated RPC (from `~/.arc-canteen/env`) |
   | `SETTLEMENT_RAIL` | `arc-usdc` |
   | `ENGINE_RAIL` | `gateway` (already set in the Dockerfile) |
   | `AUTH_SECRET` | any long random string — keeps SIWE sessions valid across restarts (optional; a per-boot random is used if unset, which just means users re-verify after a redeploy) |

   `PORT` is injected by Railway automatically — don't set it.
3. **Volume** — add a volume mounted at `/app/data` so state (credit scores, crew
   reputation, ledger) survives redeploys. Without it, the filesystem is ephemeral.
4. **Networking** → Generate a public domain. Note the URL, e.g.
   `https://foreman-engine.up.railway.app`.
5. Verify: open `https://…/stats` — you should get JSON.

CORS is already open (`Access-Control-Allow-Origin: *`), so the Vercel web app can call it.

---

## 2. Web → Vercel

1. New Vercel project → import the repo → **Root Directory: `web`**. Framework: Next.js
   (auto-detected).
2. **Environment Variables**:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_ENGINE_URL` | your Railway engine URL (from step 1.4) |

   The web app reads this at build time (`web/lib/engine.ts`). Redeploy after changing it.
3. Deploy. The **Connect** page auto-detects it's hosted (non-localhost engine) and shows
   the `npx -y foreman-mcp` setup — no "run the engine locally" step.

---

## 3. MCP → npm (`foreman-mcp`)

Standalone, dependency-light package in `packages/mcp/` (plain ESM JS, no build). Verified
locally with a real MCP handshake.

```bash
cd packages/mcp
npm login                 # your npm account (you, not Claude)
npm publish --access public
```

- Publishing under the `@foreman` scope requires you to own that npm org/scope. If it's
  taken, either create the org, or rename to your own scope (`@yourname/foreman-mcp`) or an
  unscoped name (`foreman-mcp`) in `packages/mcp/package.json` — then update the Connect
  page snippet and this doc to match.
- After publish, anyone runs it with `npx -y foreman-mcp` (see `packages/mcp/README.md`).

---

## Post-deploy smoke test

1. `https://…/stats` returns JSON (engine up).
2. Web app loads; **Run a job** settles a real payment; "✓ verify on-chain" resolves.
3. Fresh Claude Code with the hosted `.mcp.json` (URL = Railway, USER = a funded wallet) →
   `foreman_discover` lists the crew, `foreman_delegate` runs a job.
4. Kill switch ON → a delegate returns **DECLINED** (HTTP 402) before any USDC moves.
