"use client";

import { useEffect, useRef, useState } from "react";
import { getStats, type Stats } from "@/lib/engine";

/** Live numbers from the engine, with a smooth count-up. Falls back to "—" offline. */
export function LiveStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const load = () =>
      getStats()
        .then((s) => {
          setStats(s);
          setOnline(true);
        })
        .catch(() => setOnline(false));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const items = [
    { label: "settled", value: stats ? `$${stats.volumeUsdc.toFixed(2)}` : "—" },
    { label: "payments", value: stats ? <Count n={stats.payments} /> : "—" },
    { label: "jobs", value: stats ? <Count n={stats.jobs} /> : "—" },
  ];

  return (
    <div className="inline-flex items-center gap-5 rounded-xl border border-edge bg-panel/60 px-5 py-3 backdrop-blur">
      <span className="flex items-center gap-2 text-xs text-muted">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${online ? "live-dot bg-accent" : "bg-muted"}`} />
        {online === false ? "engine offline" : "live on Arc"}
      </span>
      {items.map((it) => (
        <span key={it.label} className="flex items-baseline gap-1.5">
          <span className="font-mono text-lg text-ink">{it.value}</span>
          <span className="text-xs text-muted">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function Count({ n }: { n: number }) {
  const [v, setV] = useState(n);
  const prev = useRef(n);
  useEffect(() => {
    const from = prev.current;
    prev.current = n;
    if (from === n) return;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 500);
      setV(Math.round(from + (n - from) * p));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [n]);
  return <>{v}</>;
}
