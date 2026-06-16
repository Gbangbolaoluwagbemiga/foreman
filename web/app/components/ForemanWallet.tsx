"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { Wallet, Plus, ArrowDownToLine } from "lucide-react";
import { ARCSCAN, getForeman, getAccount, reportDeposit, withdrawForeman, type ForemanInfo, type Account } from "@/lib/engine";
import { USDC, arcTestnet } from "@/lib/wagmi";

/**
 * Your Foreman account: what you deposited, spent, and have left — plus an
 * overdraft (a % of your lifetime spend) the agent extends when your balance is 0.
 */
export function ForemanWallet() {
  const [info, setInfo] = useState<ForemanInfo | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [amount, setAmount] = useState("1");
  const [mounted, setMounted] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState("");
  const fundedAmt = useRef(0);
  const reportedTx = useRef<string | null>(null);

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
  const walletUsdc = rawBal !== undefined ? Number(formatUnits(rawBal as bigint, 6)).toFixed(2) : null;

  const refreshAccount = () => {
    if (address) getAccount(address).then(setAccount).catch(() => {});
  };
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const load = () => {
      getForeman().then(setInfo).catch(() => setInfo(null));
      refreshAccount();
    };
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // On a confirmed fund tx, credit the user's Foreman account once.
  useEffect(() => {
    if (isSuccess && txHash && address && reportedTx.current !== txHash && fundedAmt.current > 0) {
      reportedTx.current = txHash;
      reportDeposit(address, fundedAmt.current).then(setAccount).catch(() => {});
    }
  }, [isSuccess, txHash, address]);

  const agentAddr = info?.address;
  const connected = mounted && isConnected;
  const owed = account?.owed ?? 0;
  // Derive the credit rate from the engine so the label never drifts from the logic.
  const creditRate = account && account.spent > 0 ? Math.round((account.creditLimit / account.spent) * 100) : 30;

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
      fundedAmt.current = Number(amount || 0);
      writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [agentAddr as `0x${string}`, parseUnits(amount || "0", 6)], chainId: arcTestnet.id });
    } catch (e) {
      setNote(((e as Error).message.split("\n")[0] ?? "error").slice(0, 80));
    }
  };

  const withdraw = async () => {
    setNote("");
    const amt = Number(amount || 0);
    const max = account?.balance ?? 0;
    if (amt <= 0) return setNote("Enter an amount.");
    if (amt > max) return setNote(`You can withdraw at most ${max.toFixed(2)} USDC (your balance).`);
    setWithdrawing(true);
    try {
      const r = await withdrawForeman(String(amt));
      setNote(`Withdrew ${r.withdrew} USDC → your wallet`);
      refreshAccount();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Your Foreman balance */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
            <Wallet size={17} />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">Your balance</div>
            <div className="font-mono text-ink">
              {connected ? (account ? account.balance.toFixed(2) : "…") : "—"} <span className="text-xs text-muted">USDC</span>
            </div>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-edge sm:block" />

        {/* Ledger: deposited / spent / credit */}
        <div className="text-sm">
          {connected && account ? (
            <>
              <div className="font-mono text-muted">
                deposited {account.deposited.toFixed(2)} <span className="text-edge">·</span> spent {account.spent.toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs">
                {owed > 0 ? (
                  <span className="text-warn">overdraft ${owed.toFixed(2)} / ${account.creditLimit.toFixed(2)} — repay anytime</span>
                ) : (
                  <span className="text-muted">
                    credit available <span className="text-accent">${(account.creditAvailable ?? 0).toFixed(2)}</span> <span className="opacity-60">({creditRate}% of spend)</span>
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted">
              {connected ? "loading account…" : "connect to see your balance"}
              {info?.rail && <span className="ml-2 font-mono">· engine {info.rail}</span>}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          {connected ? (
            <>
              <span className="hidden text-xs text-muted md:inline">wallet {walletUsdc ?? "…"}</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-16 rounded-lg border border-edge bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              />
              <button onClick={fund} disabled={isPending} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50">
                <Plus size={13} /> {isPending ? "Confirm…" : owed > 0 ? "Repay/Fund" : "Fund"}
              </button>
              <button onClick={withdraw} disabled={withdrawing || (account?.balance ?? 0) <= 0} title={(account?.balance ?? 0) <= 0 ? "No balance to withdraw" : `Up to ${(account?.balance ?? 0).toFixed(2)}`} className="inline-flex items-center gap-1 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs hover:border-accent/40 disabled:opacity-40">
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
          {agentAddr && <span className="ml-2 text-muted">agent {agentAddr.slice(0, 6)}…{agentAddr.slice(-4)}</span>}
        </div>
      )}
    </div>
  );
}
