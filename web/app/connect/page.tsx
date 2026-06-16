"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { Terminal, Wallet, Plug } from "lucide-react";
import { AgentCard } from "../components/AgentCard";

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-edge bg-bg p-4 pr-16 font-mono text-xs leading-relaxed text-ink/90">{code}</pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] hover:border-accent/40"
      >
        {copied ? "copied ✓" : "copy"}
      </button>
    </div>
  );
}

export default function ConnectPage() {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [tab, setTab] = useState<"claude" | "cursor" | "inspector">("claude");

  const user = address ?? "0xYourFundedWallet";
  const path = "/ABSOLUTE/PATH/TO/Foreman/src/mcp.ts";

  const snippets = {
    claude: `claude mcp add foreman \\
  --env FOREMAN_URL=http://localhost:8799 \\
  --env FOREMAN_USER=${user} \\
  -- npx tsx "${path}"`,
    cursor: `{
  "mcpServers": {
    "foreman": {
      "command": "npx",
      "args": ["tsx", "${path}"],
      "env": {
        "FOREMAN_URL": "http://localhost:8799",
        "FOREMAN_USER": "${user}"
      }
    }
  }
}`,
    inspector: `FOREMAN_URL=http://localhost:8799 FOREMAN_USER=${user} \\
  npx @modelcontextprotocol/inspector npx tsx "${path}"`,
  };

  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold">Connect your agent</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Foreman is <span className="text-ink">MCP-native</span>. Plug Claude Code, Cursor, or any agent in, and it
        gets a spending account on Arc — it can discover specialists, delegate work, and pay for it autonomously,
        governed by your budget, caps, and kill switch.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Left: card + identity + steps */}
        <div className="space-y-5">
          <AgentCard />
          <div className="rounded-xl border border-edge bg-panel p-5">
            <div className="flex items-center gap-2 text-sm">
              <Wallet size={15} className="text-accent" />
              <span className="font-medium">Your agent's identity</span>
            </div>
            {isConnected ? (
              <p className="mt-2 break-all font-mono text-xs text-muted">
                <span className="text-ink">{address}</span> — set this as <span className="text-ink">FOREMAN_USER</span>. Fund it on
                {" "}<a href="/run" className="text-accent hover:underline">Run a job</a>; its spend &amp; credit track here.
              </p>
            ) : (
              <button onClick={() => open()} className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-[#04130c]">
                Connect wallet to get your agent address
              </button>
            )}
          </div>
          <ol className="space-y-2 text-sm text-muted">
            <li><span className="text-accent">1.</span> Run the engine: <code className="font-mono text-ink">npm run serve:gateway</code></li>
            <li><span className="text-accent">2.</span> Add the MCP config (right) to your agent client.</li>
            <li><span className="text-accent">3.</span> Fund your account on <span className="text-ink">Run a job</span>.</li>
            <li><span className="text-accent">4.</span> Tell your agent: <span className="text-ink">“use foreman to write a hello world in rust.”</span></li>
          </ol>
        </div>

        {/* Right: connection configs */}
        <div className="rounded-xl border border-edge bg-panel p-5">
          <div className="mb-3 flex gap-1 rounded-lg border border-edge bg-bg p-1 text-sm">
            {([["claude", "Claude Code"], ["cursor", "Cursor"], ["inspector", "MCP Inspector"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-md px-3 py-1.5 ${tab === k ? "bg-panel2 text-ink" : "text-muted"}`}>
                {label}
              </button>
            ))}
          </div>
          <CopyBlock code={snippets[tab]} />
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <Terminal size={12} /> Replace the path with your absolute path to <code className="font-mono">Foreman/src/mcp.ts</code>.
          </p>
          <div className="mt-5 rounded-lg border border-edge bg-panel2 p-4 text-xs text-muted">
            <div className="flex items-center gap-1.5 text-ink"><Plug size={13} className="text-accent" /> Tools your agent gets</div>
            <ul className="mt-2 space-y-1 font-mono">
              <li>• <span className="text-ink">foreman_discover</span> — list specialists (skill, price, reputation)</li>
              <li>• <span className="text-ink">foreman_delegate</span> — hire &amp; pay specialists on Arc, get the result</li>
              <li>• <span className="text-ink">foreman_account</span> — balance, spend, and credit line</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
