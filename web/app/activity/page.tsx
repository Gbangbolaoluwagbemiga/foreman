"use client";

import { useEffect, useState } from "react";
import { getActivity, type LedgerItem } from "@/lib/engine";
import { LiveDot } from "../components/ui";

export default function ActivityPage() {
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const load = () => getActivity().then(setLedger).catch(() => setErr(true));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">On-chain activity</h1>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted"><LiveDot /> auto-refresh</span>
      </div>
      <p className="mt-2 text-muted">Every agent-to-agent payment the Foreman has settled.</p>

      {err && <p className="mt-6 text-sm text-muted">Engine offline — start it with <code className="font-mono">npm run serve</code>.</p>}

      <div className="mt-6 overflow-hidden rounded-xl border border-edge bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-edge text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-3">When</th>
              <th className="px-5 py-3">Crew</th>
              <th className="px-5 py-3">Skill</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Settlement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {ledger.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted">No payments yet — run a job.</td>
              </tr>
            ) : (
              ledger.map((p, i) => (
                <tr key={i} className="hover:bg-panel2/50">
                  <td className="px-5 py-3 font-mono text-xs text-muted">{new Date(p.ts).toLocaleTimeString()}</td>
                  <td className="px-5 py-3">{p.crew}</td>
                  <td className="px-5 py-3 text-muted">{p.skill}</td>
                  <td className="px-5 py-3 text-right font-mono text-accent">${p.amountUsdc.toFixed(2)}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted">{p.ref}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
