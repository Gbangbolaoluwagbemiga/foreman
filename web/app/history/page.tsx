"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { getHistory, type HistoryJob } from "@/lib/engine";
import { Rendered } from "../components/Rendered";

export default function HistoryPage() {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (address) getHistory(address).then(setJobs).catch(() => setJobs([]));
  }, [address]);

  if (mounted && !isConnected) {
    return (
      <div className="py-16">
        <h1 className="text-2xl font-semibold">Your history</h1>
        <p className="mt-2 text-muted">Connect your wallet to see the jobs your Foreman has run for you.</p>
        <button onClick={() => open()} className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[#04130c]">Connect wallet</button>
      </div>
    );
  }

  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold">Your history</h1>
      <p className="mt-2 text-muted">Every job your Foreman has run — what it cost, who it hired, and what came back.</p>

      {jobs.length === 0 ? (
        <div className="mt-8 rounded-xl border border-edge bg-panel p-8 text-sm text-muted">No jobs yet — run one and it'll show up here.</div>
      ) : (
        <div className="mt-6 space-y-3">
          {jobs.map((j, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-edge bg-panel">
              <button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-panel2/40">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{j.goal}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {new Date(j.ts).toLocaleString()} · {j.lineItems.length} crew · <span className="font-mono text-accent">${j.spentUsdc.toFixed(2)}</span> spent
                  </div>
                </div>
                <span className="font-mono text-xs text-muted">{openIdx === i ? "▲" : "▼"}</span>
              </button>
              {openIdx === i && (
                <div className="border-t border-edge px-5 py-4">
                  <div className="mb-3 flex flex-wrap gap-2 font-mono text-xs text-muted">
                    {j.lineItems.map((li, k) => (
                      <span key={k} className="rounded-md border border-edge bg-panel2 px-2 py-0.5">
                        {li.crew} · {li.skill} · ${li.priceUsdc.toFixed(2)}
                      </span>
                    ))}
                  </div>
                  <Rendered text={j.result} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
