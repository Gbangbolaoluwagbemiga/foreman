#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Foreman MCP server — lets ANY real agent (Claude Code, Cursor, Codex, …) use
 * Foreman as its spending account + hiring desk. The agent discovers specialists,
 * delegates work, and pays for it in USDC on Arc — all governed by the agent's
 * Foreman account (balance + reputation-earned credit line).
 *
 *   FOREMAN_URL      the engine (default http://localhost:8799)
 *   FOREMAN_API_KEY  the agent's key (mint it in the Foreman web app after verifying
 *                    wallet ownership). Authorizes spend from — and only from — that
 *                    account, inside its caps + credit line.
 *   FOREMAN_USER     optional: the account address for read-only display; derived
 *                    from the API key if omitted.
 *
 * NOTE: the canonical source is ../../src/mcp.ts. Keep this JS copy in sync — it is
 * the standalone, dependency-light artifact published to npm as @foreman/mcp.
 */
const FOREMAN_URL = process.env.FOREMAN_URL || "http://localhost:8799";
const FOREMAN_API_KEY = process.env.FOREMAN_API_KEY || "";
let FOREMAN_USER = process.env.FOREMAN_USER || "";

function authHeaders() {
  return FOREMAN_API_KEY ? { Authorization: `Bearer ${FOREMAN_API_KEY}` } : {};
}

async function api(path, init) {
  const r = await fetch(`${FOREMAN_URL}${path}`, { ...init, headers: { ...(init?.headers ?? {}), ...authHeaders() } });
  return await r.json();
}

async function resolveUser() {
  if (FOREMAN_USER) return FOREMAN_USER;
  if (!FOREMAN_API_KEY) return "";
  try {
    const { owner } = await api("/whoami");
    if (owner) FOREMAN_USER = owner;
  } catch {
    /* stays anonymous */
  }
  return FOREMAN_USER;
}

const server = new McpServer({ name: "foreman", version: "1.0.0" });

server.registerTool(
  "foreman_discover",
  {
    title: "Discover specialist agents",
    description:
      "List specialist AI agents available for hire on Foreman — each with its skill, price in USDC, and on-chain reputation. Use this to see what you can delegate.",
    inputSchema: { skill: z.string().optional().describe("Optional: filter by skill, e.g. 'coding'") },
  },
  async ({ skill }) => {
    const { members } = await api("/crew");
    const list = (members ?? []).filter((m) => !skill || m.skill.includes(skill.toLowerCase()));
    const text =
      list.map((m) => `- ${m.name} · ${m.skill} · $${m.priceUsdc}/task · reputation ${m.reputation}${m.registered ? " (community)" : ""}`).join("\n") ||
      "No matching specialists.";
    return { content: [{ type: "text", text: `Specialists on Foreman:\n${text}` }] };
  },
);

server.registerTool(
  "foreman_delegate",
  {
    title: "Delegate a task — Foreman hires & pays specialists",
    description:
      "Give Foreman a goal and a max budget (USDC). It plans the work, hires the right specialist agents, pays each on Arc, and returns the finished result. Costs are charged to your Foreman account (uses your credit line if your balance runs low).",
    inputSchema: {
      goal: z.string().describe("What you want done, in plain language"),
      budget: z.number().optional().describe("Max USDC to spend (default 1.0)"),
    },
  },
  async ({ goal, budget }) => {
    const out = await api("/delegate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, budget: budget ?? 1 }),
    });
    if (out.error || !out.receipt) {
      return { content: [{ type: "text", text: `Foreman couldn't run this: ${out.error ?? "unknown error"}` }], isError: true };
    }
    const r = out.receipt;
    const crew = r.lineItems.map((li) => `  • ${li.crew} (${li.skill}) — $${li.priceUsdc} [${li.paymentRef}]`).join("\n");
    return {
      content: [{ type: "text", text: `${r.result}\n\n— Foreman paid $${r.spentUsdc.toFixed(2)} across ${r.lineItems.length} agent(s) on Arc:\n${crew}` }],
    };
  },
);

server.registerTool(
  "foreman_account",
  {
    title: "Foreman account status",
    description: "Show your Foreman spending account: balance, total spent, and the credit line you've earned from your track record.",
    inputSchema: {},
  },
  async () => {
    const user = await resolveUser();
    if (!user) {
      return { content: [{ type: "text", text: "Running anonymously (no FOREMAN_API_KEY set) — no account or credit line. Mint an API key in the Foreman app (after verifying wallet ownership) and set FOREMAN_API_KEY to spend from your account and earn credit." }] };
    }
    const a = await api(`/account?user=${user}`);
    return {
      content: [
        {
          type: "text",
          text: `Foreman account ${FOREMAN_USER}:\n- balance: $${a.balance.toFixed(2)}\n- spent (lifetime): $${a.spent.toFixed(2)}\n- credit available: $${a.creditAvailable.toFixed(2)} (earned from track record)\n- owed: $${a.owed.toFixed(2)}\n- spendable now: $${a.spendable.toFixed(2)}`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr only — stdout is the JSON-RPC channel.
console.error(`Foreman MCP server live · engine ${FOREMAN_URL} · auth ${FOREMAN_API_KEY ? "API key" : "(anonymous)"}`);
