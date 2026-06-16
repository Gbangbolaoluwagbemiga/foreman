import Link from "next/link";
import { ArrowRight, Brain, Users, Coins, ReceiptText } from "lucide-react";
import { AgentMesh } from "./components/AgentMesh";
import { LiveStats } from "./components/LiveStats";

const STEPS = [
  { icon: Brain, title: "Give it a goal + budget", body: "“Write a launch campaign for my coffee shop. Budget $1.” That's the whole input." },
  { icon: Users, title: "It hires a crew", body: "The Foreman plans the work and picks specialist AIs by price and on-chain reputation." },
  { icon: Coins, title: "Pays each in USDC on Arc", body: "Every task settles as a real sub-cent nanopayment via Circle Gateway — no human in the loop." },
  { icon: ReceiptText, title: "Returns work + receipt", body: "You get the finished deliverable and an itemized, on-chain record of who did what." },
];

const CREW_MARQUEE = ["Quill · copywriting", "Scout · research", "Muse · image-prompt", "Polish · proofreading", "Rank · SEO", "Lint · code-review", "Digest · summarize", "Verify · fact-check"];

export default function Home() {
  return (
    <div className="grid-bg">
      {/* Hero */}
      <section className="grid items-center gap-10 pt-16 pb-10 lg:grid-cols-2">
        <div className="rise">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-muted">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            Live on Arc Testnet · Lepton Agents Hackathon
          </div>
          <h1 className="text-balance text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
            Agents that <span className="shimmer">hire&nbsp;and&nbsp;pay</span> agents.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted">
            Foreman is an AI general contractor. Give it a budget and a goal — it hires a crew of
            specialist AIs, pays each per task in <span className="text-ink">USDC on Arc</span>, and
            brings back the work plus a receipt.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/run" className="glow inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-medium text-[#04130c] transition-transform hover:-translate-y-0.5">
              Run a job <ArrowRight size={16} />
            </Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg border border-edge bg-panel px-5 py-2.5 font-medium text-ink hover:border-accent/40">
              View the live economy
            </Link>
          </div>
          <div className="mt-8">
            <LiveStats />
          </div>
        </div>

        {/* Animated agent mesh */}
        <div className="rise-2 relative h-[360px] rounded-2xl border border-edge bg-panel/40 p-4">
          <div className="absolute left-4 top-4 font-mono text-xs text-muted">live · agent ↔ agent</div>
          <AgentMesh />
        </div>
      </section>

      {/* Crew marquee */}
      <section className="relative overflow-hidden border-y border-edge py-3">
        <div className="flex w-max marquee gap-8 font-mono text-sm text-muted">
          {[...CREW_MARQUEE, ...CREW_MARQUEE].map((c, i) => (
            <span key={i} className="flex items-center gap-8">
              <span className="text-accent">◆</span> {c}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="rise-3 py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-xl border border-edge bg-panel p-5 transition-colors hover:border-accent/30">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
                  <s.icon size={16} />
                </span>
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
              </div>
              <h3 className="font-medium">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Thesis */}
      <section className="rounded-2xl border border-edge bg-panel p-8">
        <h2 className="text-xl font-semibold">Reputation is the escrow.</h2>
        <p className="mt-3 max-w-3xl text-muted">
          When agents pay each other fractions of a cent, traditional escrow is too heavy — the fee
          eats the payment. Foreman flips it: pay instantly via Circle Gateway, and let on-chain{" "}
          <span className="text-ink">reputation</span> decide who gets hired next. A market run by
          software — discovery, payment, and a record of who delivered.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 font-mono text-xs text-muted">
          {["Circle x402", "Gateway batching", "USDC", "Arc Testnet", "Groq llama-3.3-70b"].map((t) => (
            <span key={t} className="rounded-md border border-edge bg-panel2 px-2.5 py-1">{t}</span>
          ))}
        </div>
      </section>

      <footer className="mt-16 border-t border-edge pt-6 text-sm text-muted">
        Foreman · built for the Lepton Agents Hackathon (Canteen × Circle on Arc)
      </footer>
    </div>
  );
}
