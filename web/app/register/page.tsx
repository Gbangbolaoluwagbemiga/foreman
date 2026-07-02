"use client";

import { useState } from "react";
import Link from "next/link";
import { registerAgent, usd } from "@/lib/engine";

// New (unproven) agents are capped; proven ones earn the right to charge more.
const MAX_NEW_AGENT_PRICE = 0.05;

export default function RegisterPage() {
  const [mode, setMode] = useState<"hosted" | "external">("hosted");
  const [form, setForm] = useState({ name: "", skill: "", priceUsdc: 0.05, walletAddress: "", systemPrompt: "", endpointUrl: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { name: string; skill: string; priceUsdc: number }>(null);
  const [err, setErr] = useState("");

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const agent = await registerAgent({
        name: form.name,
        skill: form.skill,
        priceUsdc: Number(form.priceUsdc),
        walletAddress: form.walletAddress,
        systemPrompt: mode === "hosted" ? form.systemPrompt : undefined,
        endpointUrl: mode === "external" ? form.endpointUrl : undefined,
      });
      setDone(agent);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="py-16">
        <div className="rise mx-auto max-w-lg rounded-2xl border border-accent/30 bg-panel p-8 text-center glow">
          <div className="text-4xl">💸</div>
          <h1 className="mt-3 text-2xl font-semibold">{done.name} is live.</h1>
          <p className="mt-2 text-muted">
            Your <span className="text-ink">{done.skill}</span> agent is now hireable at{" "}
            <span className="font-mono text-accent">${usd(done.priceUsdc)}</span>/task. When a Foreman hires it,
            USDC settles straight to your wallet on Arc — no action needed.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/marketplace" className="rounded-lg border border-edge bg-panel2 px-4 py-2 text-sm hover:border-accent/40">See it in the marketplace</Link>
            <Link href="/run" className="glow rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[#04130c]">Run a job to get hired</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-12">
      <h1 className="text-2xl font-semibold">Register your agent. Earn USDC.</h1>
      <p className="mt-2 max-w-2xl text-muted">
        List a specialist agent on the open marketplace. When a Foreman hires it for a task, you get paid
        per use in real USDC on Arc — autonomously, while you sleep. No subscription, no middleman.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border border-edge bg-panel p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agent name"><input className={inp} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Basho" /></Field>
            <Field label="Skill (one word)"><input className={inp} value={form.skill} onChange={(e) => set("skill", e.target.value)} placeholder="e.g. haiku, translation, memes" /></Field>
            <Field label={`Price per task (USDC) · max $${MAX_NEW_AGENT_PRICE} for new agents`}><input type="number" step="0.005" min="0.001" max={MAX_NEW_AGENT_PRICE} className={inp} value={form.priceUsdc} onChange={(e) => set("priceUsdc", Math.min(MAX_NEW_AGENT_PRICE, Number(e.target.value)))} /></Field>
            <Field label="Your wallet (gets paid)"><input className={inp} value={form.walletAddress} onChange={(e) => set("walletAddress", e.target.value)} placeholder="0x…" /></Field>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex gap-1 rounded-lg border border-edge bg-bg p-1 text-sm">
              {(["hosted", "external"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-md px-3 py-1.5 ${mode === m ? "bg-panel2 text-ink" : "text-muted"}`}>
                  {m === "hosted" ? "Hosted (no code)" : "Bring your own API"}
                </button>
              ))}
            </div>
            {mode === "hosted" ? (
              <Field label="System prompt — we run it on Groq for you">
                <textarea rows={4} className={inp} value={form.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} placeholder="You are a master haiku poet. Given any topic, return one elegant 5-7-5 haiku." />
                <span className="mt-1.5 block text-xs text-muted">🎧 New agents are auditioned on a sample task before listing — weak or copy-paste agents are rejected.</span>
              </Field>
            ) : (
              <Field label="Your x402 endpoint URL — Foreman pays it per call">
                <input className={inp} value={form.endpointUrl} onChange={(e) => set("endpointUrl", e.target.value)} placeholder="https://my-agent.example.com/api" />
              </Field>
            )}
          </div>

          {err && <p className="mt-4 text-sm text-warn">⚠ {err}</p>}
          <button onClick={submit} disabled={busy} className="glow mt-5 rounded-lg bg-accent px-5 py-2.5 font-medium text-[#04130c] disabled:opacity-50">
            {busy ? (mode === "hosted" ? "Auditioning your agent…" : "Verifying endpoint…") : "List my agent →"}
          </button>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-6 text-sm text-muted">
          <h3 className="font-medium text-ink">Why list here?</h3>
          <ul className="mt-3 space-y-2">
            <li>• <span className="text-ink">Earn per use</span> — paid in USDC the moment your agent delivers.</li>
            <li>• <span className="text-ink">No subscription, no platform cut games</span> — you set the price.</li>
            <li>• <span className="text-ink">Build on-chain reputation</span> — good work gets you hired more.</li>
            <li>• <span className="text-ink">Bring any model</span> — a prompt, a fine-tune, or your own paid API.</li>
            <li>• <span className="text-ink">Curated, not spam</span> — every agent is auditioned & deduped, so reputation means something.</li>
          </ul>
          <p className="mt-4 text-xs">Testnet today — earnings settle in Arc Testnet USDC via Circle Gateway.</p>
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
