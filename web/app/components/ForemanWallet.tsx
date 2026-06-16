"use client";

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { Wallet, Plus, ArrowDownToLine } from "lucide-react";
import { ARCSCAN, getForeman, withdrawForeman, type ForemanInfo } from "@/lib/engine";
import { USDC, arcTestnet } from "@/lib/wagmi";

/**
 * Compact wallet bar: your balance + fund/withdraw the autonomous Foreman agent.
 * The agent holds its own funds and pays the crew; you top it up once.
 */
export function ForemanWallet() {
  const [info, setInfo] = useState<ForemanInfo | null>(null);
  const [amount, setAmount] = useState("1");
  const [mounted, setMounted] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState("");

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { open } = useAppKit();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: rawBal } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: !!address, refetchInterval: 8000 },
  });
  const yourBalance = rawBal !== undefined ? Number(formatUnits(rawBal as bigint, 6)).toFixed(2) : null;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const load = () => getForeman().then(setInfo).catch(() => setInfo(null));
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  const agentAddr = info?.address;
  const gatewayAvail = Number(info?.gatewayAvailable ?? 0);
  const connected = mounted && isConnected;

  const fund = async () => {
    setNote("");
    if (!agentAddr) return setNote("Engine offline — start it to fund the agent.");
    if (chainId !== arcTestnet.id) {
      try {
        await switchChainAsync({ chainId: arcTestnet.id });
      } catch {
        open({ view: "Networks" });
        return setNote("Switch your wallet to Arc Testnet, then Fund again.");
      }
    }
    try {
      writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [agentAddr as `0x${string}`, parseUnits(amount || "0", 6)], chainId: arcTestnet.id });
    } catch (e) {
      setNote(((e as Error).message.split("\n")[0] ?? "error").slice(0, 80));
    }
  };

  const withdraw = async () => {
    setNote("");
    const amt = Number(amount || 0);
    if (amt <= 0) return setNote("Enter an amount.");
    if (amt > gatewayAvail) return setNote(`You can withdraw at most ${gatewayAvail.toFixed(2)} USDC (your Gateway balance).`);
    setWithdrawing(true);
    try {
      const r = await withdrawForeman(String(amt));
      setNote(`Withdrew ${r.withdrew} USDC → agent wallet`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* Your balance */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
            <Wallet size={17} />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">Your balance</div>
            <div className="font-mono text-ink">{connected ? (yourBalance ?? "…") : "—"} <span className="text-xs text-muted">USDC</span></div>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-edge sm:block" />

        {/* Agent wallet */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">
            Foreman agent · {info?.rail ?? "offline"}
            {agentAddr && (
              <a href={`${ARCSCAN}/address/${agentAddr}`} target="_blank" rel="noreferrer" className="ml-2 normal-case text-muted hover:text-accent">
                {agentAddr.slice(0, 6)}…{agentAddr.slice(-4)} ↗
              </a>
            )}
          </div>
          <div className="font-mono text-sm">
            <span className="text-muted">idle {info?.walletUsdc ?? "—"}</span>
            <span className="mx-2 text-edge">·</span>
            <span className="text-accent">gateway {info?.gatewayAvailable ?? "—"}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          {connected ? (
            <>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-16 rounded-lg border border-edge bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              />
              <button onClick={fund} disabled={isPending} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50">
                <Plus size={13} /> {isPending ? "Confirm…" : "Fund"}
              </button>
              <button onClick={withdraw} disabled={withdrawing || gatewayAvail <= 0} title={gatewayAvail <= 0 ? "Nothing to withdraw" : `Up to ${gatewayAvail.toFixed(2)}`} className="inline-flex items-center gap-1 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs hover:border-accent/40 disabled:opacity-40">
                <ArrowDownToLine size={13} /> {withdrawing ? "…" : "Withdraw"}
              </button>
            </>
          ) : mounted ? (
            <button onClick={() => open()} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-[#04130c]">
              Connect wallet to fund
            </button>
          ) : null}
        </div>
      </div>

      {(note || (error && isConnected)) && (
        <div className="mt-2 text-xs text-warn">⚠ {note || error?.message.split("\n")[0].slice(0, 80)}</div>
      )}
      {isSuccess && txHash && (
        <div className="mt-2 text-xs text-accent">
          funded ✓ <a href={`${ARCSCAN}/tx/${txHash}`} target="_blank" rel="noreferrer" className="hover:underline">view on Arcscan ↗</a>
        </div>
      )}
    </div>
  );
}
