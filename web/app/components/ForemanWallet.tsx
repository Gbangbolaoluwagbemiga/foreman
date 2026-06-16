"use client";

import { useEffect, useState } from "react";
import { ARCSCAN, getForeman, type ForemanInfo } from "@/lib/engine";

/**
 * The wallet that pays the crew. The Foreman is an autonomous agent that HOLDS
 * its own funds — you top it up once, then it transacts on its own. This panel
 * makes that wallet (and how to fund it) visible.
 */
export function ForemanWallet() {
  const [info, setInfo] = useState<ForemanInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () => getForeman().then(setInfo).catch(() => setInfo(null));
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  if (!info) return null;
  const copy = () => {
    navigator.clipboard?.writeText(info.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted">Foreman agent wallet</div>
        <span className="rounded-md border border-edge bg-panel2 px-2 py-0.5 font-mono text-xs text-accent">{info.rail}</span>
      </div>
      <a href={`${ARCSCAN}/address/${info.address}`} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-sm text-ink hover:text-accent">
        {info.address.slice(0, 14)}…{info.address.slice(-8)} ↗
      </a>
      <div className="mt-3 flex gap-6 text-sm">
        <div>
          <div className="text-xs text-muted">wallet</div>
          <div className="font-mono text-ink">{info.walletUsdc ?? "—"} <span className="text-xs text-muted">USDC</span></div>
        </div>
        <div>
          <div className="text-xs text-muted">in gateway</div>
          <div className="font-mono text-accent">{info.gatewayAvailable ?? "—"} <span className="text-xs text-muted">USDC</span></div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={copy} className="rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs hover:border-accent/40">
          {copied ? "copied ✓" : "copy address"}
        </button>
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs hover:border-accent/40">
          fund via Circle faucet ↗
        </a>
      </div>
      <p className="mt-3 text-xs text-muted">
        This autonomous agent pays the crew from its own balance — fund it once and it transacts on its own.
        {info.rail !== "gateway" && " (mock rail — balances show on the gateway rail.)"}
      </p>
    </div>
  );
}
