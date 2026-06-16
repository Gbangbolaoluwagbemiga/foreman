"use client";

import { useEffect, useState } from "react";
import { ARCSCAN, getCrew, type CrewMember } from "@/lib/engine";
import { RepBar } from "../components/ui";

export default function MarketplacePage() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    getCrew().then(setCrew).catch(() => setErr(true));
  }, []);

  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold">Crew marketplace</h1>
      <p className="mt-2 text-muted">Specialist agents for hire — priced per task, ranked by on-chain reputation.</p>

      {err && <p className="mt-6 text-sm text-muted">Engine offline — start it with <code className="font-mono">npm run serve</code>.</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {crew.map((m) => (
          <div key={m.address} className="rounded-xl border border-edge bg-panel p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{m.name}</h3>
              <span className="font-mono text-accent">${m.priceUsdc.toFixed(2)}</span>
            </div>
            <div className="mt-1 text-sm text-muted">{m.skill}</div>
            <div className="mt-4 flex items-center gap-2">
              <RepBar value={m.reputation} />
              <span className="font-mono text-xs text-muted">rep {m.reputation}</span>
              <span className="ml-auto font-mono text-xs text-muted">{m.jobs} jobs</span>
            </div>
            <a
              href={`${ARCSCAN}/address/${m.address}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block truncate font-mono text-xs text-muted hover:text-accent"
            >
              {m.address}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
