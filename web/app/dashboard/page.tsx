"use client";

import { useEffect, useState } from "react";
import { ENGINE, getStats, paymentsPerMin, type CrewMember, type Stats } from "@/lib/engine";
import { StatCard, Panel, RepBar, LiveDot } from "../components/ui";

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [feed, setFeed] = useState<string[]>([]);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
    const es = new EventSource(`${ENGINE}/events`);
    es.onopen = () => setOnline(true);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      // `stats` events carry only the running numbers — keep rail/brain/foreman.
      if (e.type === "stats") setStats((s) => ({ ...(s ?? ({} as Stats)), ...e.stats }));
      if (e.type === "crew") setCrew(e.members);
      if (e.type === "log") setFeed((f) => [e.msg, ...f].slice(0, 40));
      if (e.type === "job-start") setFeed((f) => [`▶ ${e.goal}`, ...f].slice(0, 40));
    };
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, []);

  return (
    <div className="py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Live economy</h1>
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-xs ${online ? "text-accent" : "text-muted"}`}>
          {online ? <LiveDot /> : <span className="h-2 w-2 rounded-full bg-muted" />}
          {online ? "engine live" : "engine offline"}
        </span>
        {stats && <span className="font-mono text-xs text-muted">rail: {stats.rail} · brain: {stats.brain}</span>}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Volume settled" value={`$${(stats?.volumeUsdc ?? 0).toFixed(2)}`} sub="USDC on Arc" />
        <StatCard label="Payments" value={String(stats?.payments ?? 0)} sub="agent → agent" />
        <StatCard label="Jobs" value={String(stats?.jobs ?? 0)} sub="completed" />
        <StatCard label="Throughput" value={stats ? `${paymentsPerMin(stats)}/min` : "—"} sub="payments / min" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Reputation leaderboard">
          {crew.length === 0 ? (
            <p className="text-sm text-muted">waiting for the engine…</p>
          ) : (
            <div className="space-y-3">
              {crew.slice(0, 8).map((m) => (
                <div key={m.address} className="flex items-center gap-3 text-sm">
                  <span className="w-20 font-medium">{m.name}</span>
                  <span className="w-28 text-muted">{m.skill}</span>
                  <RepBar value={m.reputation} />
                  <span className="font-mono text-xs text-muted">{m.reputation}</span>
                  <span className="ml-auto font-mono text-xs text-muted">{m.jobs} jobs</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Live feed" right={<LiveDot />}>
          <div className="h-64 overflow-auto font-mono text-xs leading-relaxed">
            {feed.length === 0 ? (
              <span className="text-muted">no activity yet — run a job</span>
            ) : (
              feed.map((l, i) => (
                <div key={i} className="text-ink/85">
                  {l}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
