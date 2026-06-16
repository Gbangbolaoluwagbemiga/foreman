"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ARCSCAN, ENGINE, runJob } from "@/lib/engine";
import { LiveDot } from "../components/ui";
import { Rendered } from "../components/Rendered";
import { ForemanWallet } from "../components/ForemanWallet";

interface LineItem {
  crew: string;
  skill: string;
  priceUsdc: number;
  paymentRef: string;
  reputationAfter: number;
  deliverable: string;
}
interface Receipt {
  goal: string;
  budgetUsdc: number;
  spentUsdc: number;
  changeUsdc: number;
  rail: string;
  lineItems: LineItem[];
  result: string;
}

export default function RunPage() {
  const [goal, setGoal] = useState("Write a launch campaign for my coffee shop 'Bean There' — research, copy, and a header image concept.");
  const [budget, setBudget] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const { address } = useAccount();

  useEffect(() => {
    const es = new EventSource(`${ENGINE}/events`);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "log") setLogs((l) => [...l, e.msg]);
      else if (e.type === "job-start") {
        setLogs([`▶ new job: ${e.goal}`]);
        setReceipt(null);
      } else if (e.type === "receipt") {
        setReceipt(e.receipt);
        setBusy(false);
      }
    };
    es.onerror = () => setLogs((l) => [...l, "⚠ engine offline — start it with `npm run serve` (or ENGINE_RAIL=gateway)"]);
    return () => es.close();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  async function go() {
    setBusy(true);
    setReceipt(null);
    setLogs(["⏳ sending job to the Foreman…"]);
    try {
      const r = await runJob(goal, budget, address);
      if (!r.ok) {
        setBusy(false);
        const body = await r.json().catch(() => null);
        const msg = body?.error ?? r.status;
        setLogs((l) => [...l, `❌ ${msg}`]);
      }
    } catch {
      setBusy(false);
      setLogs((l) => [...l, "❌ could not reach the engine"]);
    }
  }

  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold">Run a job</h1>
      <p className="mt-2 text-muted">Give the Foreman a goal and a budget. Watch it hire and pay a crew, live.</p>

      {/* Compact balance + fund bar */}
      <div className="mt-6">
        <ForemanWallet />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Input */}
        <div className="rounded-xl border border-edge bg-panel p-5">
          <label className="text-xs uppercase tracking-wide text-muted">Goal</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            className="mt-2 w-full resize-none rounded-lg border border-edge bg-bg p-3 text-sm outline-none focus:border-accent/50"
          />
          <div className="mt-3 flex items-center gap-3">
            <label className="text-xs uppercase tracking-wide text-muted">Budget $</label>
            <input
              type="number"
              step="0.1"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-24 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent/50"
            />
            <button
              onClick={go}
              disabled={busy}
              className="glow ml-auto rounded-lg bg-accent px-5 py-2 font-medium text-[#04130c] disabled:opacity-50"
            >
              {busy ? "Working…" : "Hire a crew →"}
            </button>
          </div>
        </div>

        {/* Live log */}
        <div className="rounded-xl border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-5 py-3 text-sm">
            <LiveDot /> Live
          </div>
          <div ref={logRef} className="h-56 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {logs.length === 0 ? (
              <span className="text-muted">waiting for a job…</span>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="text-ink/90">
                  {l}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Receipt */}
      {receipt && (
        <div className="rise mt-6 rounded-xl border border-edge bg-panel">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-edge px-5 py-3 text-sm">
            <span className="font-medium">🧾 Receipt</span>
            <span className="text-muted">spent <span className="font-mono text-ink">${receipt.spentUsdc.toFixed(2)}</span> / ${receipt.budgetUsdc.toFixed(2)}</span>
            <span className="text-muted">change <span className="font-mono text-ink">${receipt.changeUsdc.toFixed(2)}</span></span>
            <span className="rounded-md border border-edge bg-panel2 px-2 py-0.5 font-mono text-xs text-accent">{receipt.rail}</span>
          </div>
          {/* Final stitched deliverable */}
          <div className="border-b border-edge bg-panel2/40 px-5 py-5">
            <div className="mb-3 text-xs uppercase tracking-wide text-muted">Final deliverable</div>
            <Rendered text={receipt.result} />
          </div>

          {/* How it was made — the crew breakdown */}
          <div className="px-5 py-3 text-xs uppercase tracking-wide text-muted">How it was made</div>
          <div className="divide-y divide-edge">
            {receipt.lineItems.map((li, i) => (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{li.crew}</span>
                  <span className="text-muted">{li.skill}</span>
                  <span className="font-mono text-accent">${li.priceUsdc.toFixed(2)}</span>
                  <span className="ml-auto font-mono text-xs text-muted">
                    {li.paymentRef.startsWith("0x") ? (
                      <a href={`${ARCSCAN}/tx/${li.paymentRef}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {li.paymentRef.slice(0, 10)}… ↗
                      </a>
                    ) : (
                      `[${li.paymentRef}]`
                    )}{" "}
                    · rep {li.reputationAfter}
                  </span>
                </div>
                <div className="mt-2">
                  <Rendered text={li.deliverable} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
