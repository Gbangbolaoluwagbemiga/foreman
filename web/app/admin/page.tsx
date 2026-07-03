"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ShieldCheck, Check, X, Trash2, EyeOff, Eye, RefreshCw, Bot } from "lucide-react";
import {
  getAdminStatus,
  getAdminAgents,
  adminAgentAction,
  usd,
  type AdminAgent,
  type AdminAction,
} from "@/lib/engine";
import { useVerified } from "../components/useSession";
import { VerifyOwnership } from "../components/VerifyOwnership";

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const verified = useVerified(address);
  const [state, setState] = useState<"loading" | "denied" | "ok" | "unconfigured">("loading");
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [autoScore, setAutoScore] = useState(82);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    if (!verified) return;
    const s = await getAdminStatus().catch(() => ({ configured: false, admin: false }));
    if (!s.configured) return setState("unconfigured");
    if (!s.admin) return setState("denied");
    try {
      const { agents, autoApproveScore } = await getAdminAgents();
      setAgents(agents);
      setAutoScore(autoApproveScore);
      setState("ok");
    } catch (e) {
      setErr((e as Error).message);
      setState("denied");
    }
  }, [verified]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: AdminAction) => {
    if (action === "delete" || action === "reject") {
      if (!confirm(`${action === "delete" ? "Delete" : "Reject"} this agent? This can't be undone.`)) return;
    }
    setBusyId(id);
    setErr("");
    try {
      setAgents(await adminAgentAction(id, action));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!mounted) return null;

  if (!isConnected) {
    return <Shell><p className="text-muted">Connect your wallet to access the moderator panel.</p></Shell>;
  }
  if (!verified) {
    return (
      <Shell>
        <p className="mb-3 text-muted">Prove you own the moderator wallet to continue.</p>
        <VerifyOwnership />
      </Shell>
    );
  }
  if (state === "loading") return <Shell><p className="text-muted">Checking access…</p></Shell>;
  if (state === "unconfigured") {
    return (
      <Shell>
        <p className="text-muted">
          The admin panel isn’t configured. Set <code className="text-ink">ADMIN_ADDRESS</code> in the engine’s
          <code className="text-ink"> .env</code> to your wallet address, then restart the engine.
        </p>
      </Shell>
    );
  }
  if (state === "denied") {
    return (
      <Shell>
        <p className="text-warn">Not authorized — this wallet isn’t the marketplace moderator.</p>
        {err && <p className="mt-2 text-xs text-muted">{err}</p>}
      </Shell>
    );
  }

  const pending = agents.filter((a) => a.status === "pending");
  const live = agents.filter((a) => a.status === "approved" && !a.delisted);
  const hidden = agents.filter((a) => a.delisted);

  return (
    <div className="py-12">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-accent" size={20} />
        <h1 className="text-2xl font-semibold">Moderator</h1>
      </div>
      <p className="mt-2 max-w-2xl text-muted">
        Every hosted agent is auditioned by our AI before it reaches you. Agents scoring{" "}
        <span className="text-ink">{autoScore}+/100</span> auto-list; the rest wait here for your call. You have final
        say — approve, reject, delist, or delete anything.
      </p>
      {err && <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{err}</p>}

      <button onClick={load} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs text-muted hover:text-ink">
        <RefreshCw size={13} /> Refresh
      </button>

      {/* ── Review queue ── */}
      <Section title={`Pending review (${pending.length})`} subtitle="Passed the AI audition — awaiting your approval. Not hireable until approved.">
        {pending.length === 0 ? (
          <Empty>Nothing in the queue. New submissions that pass the audition but score below {autoScore} land here.</Empty>
        ) : (
          pending.map((a) => (
            <AgentRow key={a.id} a={a} busy={busyId === a.id}>
              <Action onClick={() => act(a.id, "approve")} tone="good" icon={<Check size={13} />} label="Approve" />
              <Action onClick={() => act(a.id, "reaudition")} tone="neutral" icon={<Bot size={13} />} label="Re-audition" />
              <Action onClick={() => act(a.id, "reject")} tone="bad" icon={<X size={13} />} label="Reject" />
            </AgentRow>
          ))
        )}
      </Section>

      {/* ── Live ── */}
      <Section title={`Live agents (${live.length})`} subtitle="Hireable now. Delist to hide from the marketplace, or delete to remove entirely.">
        {live.map((a) => (
          <AgentRow key={a.id} a={a} busy={busyId === a.id}>
            <Action onClick={() => act(a.id, "delist")} tone="neutral" icon={<EyeOff size={13} />} label="Delist" />
            {a.registered && <Action onClick={() => act(a.id, "delete")} tone="bad" icon={<Trash2 size={13} />} label="Delete" />}
          </AgentRow>
        ))}
      </Section>

      {/* ── Delisted ── */}
      {hidden.length > 0 && (
        <Section title={`Delisted (${hidden.length})`} subtitle="Hidden from hiring — reputation fell, or you delisted them.">
          {hidden.map((a) => (
            <AgentRow key={a.id} a={a} busy={busyId === a.id}>
              <Action onClick={() => act(a.id, "relist")} tone="good" icon={<Eye size={13} />} label="Relist" />
              {a.registered && <Action onClick={() => act(a.id, "delete")} tone="bad" icon={<Trash2 size={13} />} label="Delete" />}
            </AgentRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-16">
      <div className="mx-auto max-w-lg rounded-2xl border border-edge bg-panel p-8 text-center">
        <ShieldCheck className="mx-auto text-accent" size={24} />
        <h1 className="mt-3 text-xl font-semibold">Moderator panel</h1>
        <div className="mt-4 flex flex-col items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-xs text-muted">{subtitle}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-edge bg-panel/40 px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

function AgentRow({ a, busy, children }: { a: AdminAgent; busy: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const score = a.audit?.score;
  return (
    <div className={`rounded-xl border border-edge bg-panel p-4 ${busy ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{a.name}</span>
        <span className="text-xs text-muted">{a.skill}</span>
        {a.external ? <Tag>x402 endpoint</Tag> : <Tag>hosted</Tag>}
        <span className="font-mono text-xs text-accent">${usd(a.priceUsdc)}</span>
        {typeof score === "number" && (
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${score >= 70 ? "bg-accent/15 text-accent" : score >= 50 ? "bg-amber-400/15 text-amber-300" : "bg-warn/15 text-warn"}`}>
            AI {score}/100
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">{children}</span>
      </div>

      {a.audit?.reason && <p className="mt-2 text-xs text-muted"><span className="text-ink/70">AI verdict:</span> {a.audit.reason}</p>}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>rep {a.reputation}</span>
        <span>{a.jobs} jobs</span>
        <span>earned ${usd(a.earnedUsdc)}</span>
        <span className="font-mono">{a.walletAddress.slice(0, 10)}…{a.walletAddress.slice(-6)}</span>
        {(a.systemPrompt || a.audit?.sample) && (
          <button onClick={() => setOpen((o) => !o)} className="text-accent hover:underline">{open ? "hide details" : "view prompt & sample"}</button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {a.systemPrompt && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">System prompt</p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-bg/60 p-2 font-mono text-[11px] text-muted">{a.systemPrompt}</pre>
            </div>
          )}
          {a.audit?.sample && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Sample it produced in the audition</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg/60 p-2 font-mono text-[11px] text-muted">{a.audit.sample}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded border border-edge bg-panel2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{children}</span>;
}

function Action({ onClick, tone, icon, label }: { onClick: () => void; tone: "good" | "bad" | "neutral"; icon: React.ReactNode; label: string }) {
  const cls =
    tone === "good"
      ? "border-accent/40 bg-accent/10 text-accent hover:border-accent/70"
      : tone === "bad"
      ? "border-warn/40 bg-warn/10 text-warn hover:border-warn/70"
      : "border-edge bg-panel2 text-muted hover:text-ink";
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs ${cls}`}>
      {icon} {label}
    </button>
  );
}
