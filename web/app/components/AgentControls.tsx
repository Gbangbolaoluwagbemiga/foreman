"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ShieldCheck, Power } from "lucide-react";
import { getAccount, setControls, type Account } from "@/lib/engine";
import { useVerified } from "./useSession";

/** Operator control plane: kill switch + spending caps for your agent. */
export function AgentControls() {
  const { address, isConnected } = useAccount();
  const verified = useVerified(address);
  const [acct, setAcct] = useState<Account | null>(null);
  const [perJob, setPerJob] = useState("");
  const [daily, setDaily] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!address) return;
    const load = () =>
      getAccount(address).then((a) => {
        setAcct(a);
        setPerJob(a.perJobCap ? String(a.perJobCap) : "");
        setDaily(a.dailyCap ? String(a.dailyCap) : "");
      }).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [address]);

  if (!mounted || !isConnected || !acct) return null;

  // setControls is auth-gated — only apply a real Account back (ignore 401 error bodies).
  const apply = (a: Account | { error: string }) => {
    if ("user" in a) setAcct(a);
  };
  const toggleKill = async () => apply(await setControls(address!, { suspended: !acct.suspended }));
  const saveCaps = async () => apply(await setControls(address!, { perJobCap: Number(perJob) || 0, dailyCap: Number(daily) || 0 }));

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck size={16} className="text-accent" />
          <span className="font-medium">Agent controls</span>
          {acct.suspended && <span className="rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] uppercase text-warn">suspended</span>}
          {!verified && <span className="text-[11px] text-amber-300/80">verify ownership to edit</span>}
        </div>

        {/* Kill switch */}
        <button
          onClick={toggleKill}
          disabled={!verified}
          title={!verified ? "Verify wallet ownership first" : ""}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50 ${
            acct.suspended ? "border-accent/40 bg-accent/10 text-accent" : "border-warn/40 bg-warn/10 text-warn"
          }`}
        >
          <Power size={13} /> {acct.suspended ? "Resume agent" : "Kill switch"}
        </button>

        {/* Caps */}
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>per-job $</span>
          <input value={perJob} onChange={(e) => setPerJob(e.target.value)} disabled={!verified} placeholder="∞" className="w-14 rounded-lg border border-edge bg-bg px-2 py-1 text-ink outline-none focus:border-accent/50 disabled:opacity-50" />
          <span>daily $</span>
          <input value={daily} onChange={(e) => setDaily(e.target.value)} disabled={!verified} placeholder="∞" className="w-14 rounded-lg border border-edge bg-bg px-2 py-1 text-ink outline-none focus:border-accent/50 disabled:opacity-50" />
          <button onClick={saveCaps} disabled={!verified} title={!verified ? "Verify wallet ownership first" : ""} className="rounded-lg border border-edge bg-panel2 px-3 py-1 hover:border-accent/40 disabled:opacity-50">Set caps</button>
        </div>

        <span className="ml-auto font-mono text-xs text-muted">
          spent today ${(acct.spentToday ?? 0).toFixed(2)}{acct.dailyCap ? ` / $${acct.dailyCap.toFixed(2)}` : ""}
        </span>
      </div>
    </div>
  );
}
