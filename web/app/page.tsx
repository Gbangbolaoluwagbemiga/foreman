import Link from "next/link";
import { ArrowRight, Brain, Users, Coins, ReceiptText } from "lucide-react";

const STEPS = [
  { icon: Brain, title: "Give it a goal + budget", body: "“Write a launch campaign for my coffee shop. Budget $1.” That's the whole input." },
  { icon: Users, title: "It hires a crew", body: "The Foreman plans the work and picks specialist AI agents by price and on-chain reputation." },
  { icon: Coins, title: "Pays each in USDC on Arc", body: "Every task settles as a real sub-cent nanopayment via Circle Gateway — no human in the loop." },
  { icon: ReceiptText, title: "Returns the work + receipt", body: "You get the finished deliverable and an itemized, on-chain record of who did what for how much." },
];

export default function Home() {
  return (
    <div className="grid-bg">
      {/* Hero */}
      <section className="rise mx-auto max-w-3xl pt-20 pb-16 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-muted">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          Live on Arc Testnet · Lepton Agents Hackathon
        </div>
        <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Agents that <span className="text-accent">hire&nbsp;and&nbsp;pay</span> agents.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted">
          Foreman is an AI general contractor. Give it a budget and a goal — it hires a crew of
          specialist AIs, pays each per task in <span className="text-ink">USDC on Arc</span>, and
          brings back the work plus a receipt.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Link
            href="/run"
            className="glow inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-medium text-[#04130c] transition-transform hover:-translate-y-0.5"
          >
            Run a job <ArrowRight size={16} />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-panel px-5 py-2.5 font-medium text-ink hover:border-accent/40"
          >
            View the live economy
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-xl border border-edge bg-panel p-5">
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
      <section className="mx-auto mt-10 max-w-4xl rounded-2xl border border-edge bg-panel p-8">
        <h2 className="text-xl font-semibold">Reputation is the escrow.</h2>
        <p className="mt-3 text-muted">
          When agents pay each other fractions of a cent, traditional escrow is too heavy — the fee
          eats the payment. Foreman flips it: pay instantly via Circle Gateway, and let on-chain{" "}
          <span className="text-ink">reputation</span> decide who gets hired next. A market run by
          software — discovery, payment, and a record of who delivered.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 font-mono text-xs text-muted">
          {["Circle x402", "Gateway batching", "USDC", "Arc Testnet", "Groq llama-3.3-70b"].map((t) => (
            <span key={t} className="rounded-md border border-edge bg-panel2 px-2.5 py-1">
              {t}
            </span>
          ))}
        </div>
      </section>

      <footer className="mx-auto mt-16 max-w-5xl border-t border-edge pt-6 text-sm text-muted">
        Foreman · built for the Lepton Agents Hackathon (Canteen × Circle on Arc)
      </footer>
    </div>
  );
}
