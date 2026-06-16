"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Cpu } from "lucide-react";
import { getAccount, type Account } from "@/lib/engine";

/** The signature visual: an agent's spending card. Shows the connected wallet's
 *  REAL account when available; a labelled sample otherwise. */
export function AgentCard() {
  const { address, isConnected } = useAccount();
  const [acct, setAcct] = useState<Account | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!address) return;
    const load = () => getAccount(address).then(setAcct).catch(() => {});
    load();
    const t = setInterval(load, 7000);
    return () => clearInterval(t);
  }, [address]);

  const live = mounted && isConnected && !!acct;
  const addr = (mounted && address) || "0x3Be7fbBDbC73Fc4731D60EF09c4BA1A94DC58E41";
  const masked = `${addr.slice(0, 6)} ···· ···· ${addr.slice(-4)}`;
  const balance = live ? acct!.balance : 9.45;
  const credit = live ? acct!.creditAvailable : 2.84;
  const score = live ? acct!.creditScore ?? 0 : 74;
  const controls = live ? (acct!.suspended ? "off" : "on") : "on";

  return (
    <div className="floaty relative mx-auto aspect-[1.58/1] w-full max-w-md">
      <div className="sheen glow relative h-full overflow-hidden rounded-2xl border border-edge bg-gradient-to-br from-panel2 via-panel to-bg p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-accent/15 blur-3xl" />

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent">▦</span>
            Foreman
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted">{live ? "Agent Card" : "Sample"}</span>
        </div>

        <div className="mt-7 flex items-center gap-3">
          <div className="grid h-9 w-12 place-items-center rounded-md bg-gradient-to-br from-accent/70 to-accent/20">
            <Cpu size={14} className="text-[#04130c]" />
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" /> {live ? "live on Arc" : "connect to see yours"}
          </span>
        </div>

        <div className="mt-5 font-mono text-lg tracking-[0.2em] text-ink/90">{masked}</div>

        <div className="mt-6 flex items-end justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted">balance</div>
            <div className="font-mono text-ink">${balance.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted">credit line</div>
            <div className="font-mono text-accent">${credit.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted">score</div>
            <div className="font-mono text-ink">{score}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted">controls</div>
            <div className={`font-mono ${controls === "off" ? "text-warn" : "text-ink"}`}>{controls}</div>
          </div>
        </div>
        <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="mt-2 text-[10px] text-muted">USDC · settles on Arc · credit grows with reputation</div>
      </div>
    </div>
  );
}
