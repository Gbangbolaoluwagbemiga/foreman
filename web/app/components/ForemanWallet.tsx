"use client";

import { useEffect, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ARCSCAN, getForeman, withdrawForeman, type ForemanInfo } from "@/lib/engine";
import { USDC, arcTestnet } from "@/lib/wagmi";

/**
 * The wallet that pays the crew. The Foreman is an autonomous agent that HOLDS
 * its own funds: connect your wallet, top it up once, and it transacts on its own.
 * Funds are never locked — withdraw the Gateway balance back to the wallet anytime.
 */
export function ForemanWallet() {
  const [info, setInfo] = useState<ForemanInfo | null>(null);
  const [amount, setAmount] = useState("1");
  const [mounted, setMounted] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState("");

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
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

  const fund = async () => {
    setNote("");
    try {
      // The wallet must be on Arc Testnet to send Arc USDC — switch/add it first.
      if (chainId !== arcTestnet.id) await switchChainAsync({ chainId: arcTestnet.id });
      writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [info.address as `0x${string}`, parseUnits(amount || "0", 6)],
        chainId: arcTestnet.id,
      });
    } catch (e) {
      setNote((e as Error).message.split("\n")[0].slice(0, 80));
    }
  };

  const withdraw = async () => {
    setWithdrawing(true);
    setNote("");
    try {
      const r = await withdrawForeman(amount || "0");
      setNote(`Withdrew ${r.withdrew} USDC from Gateway → agent wallet`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setWithdrawing(false);
    }
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
          <div className="text-xs text-muted" title="Idle USDC in the agent's wallet, not yet deposited to Gateway">wallet (idle)</div>
          <div className="font-mono text-ink">{info.walletUsdc ?? "—"} <span className="text-xs text-muted">USDC</span></div>
        </div>
        <div>
          <div className="text-xs text-muted" title="Deposited into Circle Gateway — this is the spendable balance the agent pays the crew from">in gateway (spendable)</div>
          <div className="font-mono text-accent">{info.gatewayAvailable ?? "—"} <span className="text-xs text-muted">USDC</span></div>
        </div>
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        {!mounted ? null : isConnected ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-20 rounded-lg border border-edge bg-bg px-2 py-1 text-sm outline-none focus:border-accent/50"
            />
            <span className="text-xs text-muted">USDC</span>
            <button onClick={fund} disabled={isPending || confirming} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50">
              {isPending ? "Confirm in wallet…" : confirming ? "Funding…" : "Fund Foreman"}
            </button>
            <button onClick={withdraw} disabled={withdrawing} className="rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs hover:border-accent/40 disabled:opacity-50">
              {withdrawing ? "Withdrawing…" : "Withdraw from Gateway"}
            </button>
            {isSuccess && txHash && (
              <a href={`${ARCSCAN}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">funded ✓ ↗</a>
            )}
            {(note || error) && <span className="text-xs text-warn">⚠ {note || error?.message.split("\n")[0].slice(0, 70)}</span>}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Connect your wallet (top right) to fund this agent — or grab test USDC from the{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Circle faucet</a>.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          The agent pays the crew from its <span className="text-ink">Gateway</span> balance. Idle wallet USDC is auto-deposited
          before a job; withdraw pulls it back out — funds are never locked.
          {info.rail !== "gateway" && " (mock rail — live balances show on the gateway rail.)"}
        </p>
      </div>
    </div>
  );
}
