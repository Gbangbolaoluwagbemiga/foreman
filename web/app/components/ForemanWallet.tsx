"use client";

import { useEffect, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ARCSCAN, getForeman, type ForemanInfo } from "@/lib/engine";
import { USDC, arcTestnet } from "@/lib/wagmi";

/**
 * The wallet that pays the crew. The Foreman is an autonomous agent that HOLDS
 * its own funds — connect your wallet and top it up once, then it transacts on
 * its own. (No MetaMask per payment — that's the whole point of agentic payments.)
 */
export function ForemanWallet() {
  const [info, setInfo] = useState<ForemanInfo | null>(null);
  const [amount, setAmount] = useState("1");
  const [mounted, setMounted] = useState(false);

  const { isConnected } = useAccount();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const load = () => getForeman().then(setInfo).catch(() => setInfo(null));
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  if (!info) return null;

  const fund = () => {
    writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "transfer",
      args: [info.address as `0x${string}`, parseUnits(amount || "0", 6)],
      chainId: arcTestnet.id,
    });
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

      {/* Fund from your connected wallet */}
      <div className="mt-4 border-t border-edge pt-4">
        {!mounted ? null : isConnected ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Top up this agent:</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-20 rounded-lg border border-edge bg-bg px-2 py-1 text-sm outline-none focus:border-accent/50"
            />
            <span className="text-xs text-muted">USDC</span>
            <button onClick={fund} disabled={isPending || confirming} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50">
              {isPending ? "Confirm in wallet…" : confirming ? "Sending…" : "Fund Foreman"}
            </button>
            {isSuccess && txHash && (
              <a href={`${ARCSCAN}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                funded ✓ ↗
              </a>
            )}
            {error && <span className="text-xs text-warn">⚠ {error.message.split("\n")[0].slice(0, 60)}</span>}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Connect your wallet (top right) to fund this agent — or grab test USDC from the{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Circle faucet</a>.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          This autonomous agent pays the crew from its own balance.
          {info.rail !== "gateway" && " (mock rail — live balances show on the gateway rail.)"}
        </p>
      </div>
    </div>
  );
}
