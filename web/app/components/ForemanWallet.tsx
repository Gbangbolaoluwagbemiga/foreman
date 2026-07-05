"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { Wallet, Plus, ArrowDownToLine, ShieldCheck } from "lucide-react";
import { ARCSCAN, getForeman, getAccount, reportDeposit, withdrawForeman, getCreditAttestation, verifyCreditAttestation, type ForemanInfo, type Account } from "@/lib/engine";
import { USDC, arcTestnet } from "@/lib/wagmi";
import { VerifyOwnership } from "./VerifyOwnership";
import { useVerified } from "./useSession";

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
  const [withdrawTx, setWithdrawTx] = useState<string | null>(null);
  const [att, setAtt] = useState<{ state: "idle" | "checking" | "ok" | "fail"; attester?: string }>({ state: "idle" });
  const fundedAmt = useRef(0);
  const reportedTx = useRef<string | null>(null);

  const { address, isConnected } = useAccount();
  const verified = useVerified(address);
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
      reportDeposit(address, fundedAmt.current)
        .then(setAccount)
        .catch((e) => {
          const msg = (e as Error).message;
          // On-chain transfer already succeeded; only the ledger credit failed.
          setNote(
            /ownership|verify/i.test(msg)
              ? "Funds sent on-chain ✓ but your session expired — click “verify” again, then Fund once more to credit your balance."
              : `Funds sent on-chain, but crediting failed: ${msg}`,
          );
        });
    }
  }, [isSuccess, txHash, address]);

  const agentAddr = info?.address;
  const connected = mounted && isConnected;
  const owed = account?.owed ?? 0;
  // Credit rate + score come straight from the engine so labels never drift from the logic.
  const creditRate = account?.creditRate ? Math.round(account.creditRate * 100) : 10;
  const score = account?.creditScore ?? 0;
  const band = account?.creditBand ?? "no history";
  const scoreColor = score >= 80 ? "text-accent" : score >= 65 ? "text-accent/80" : score >= 45 ? "text-ink" : "text-muted";

  // Fetch a signed attestation of this score and verify its EIP-712 signature
  // right here in the browser — proof the score is real without trusting the API.
  const verifyScore = async () => {
    if (!address) return;
    setAtt({ state: "checking" });
    try {
      const a = await getCreditAttestation(address);
      const ok = await verifyCreditAttestation(a);
      setAtt({ state: ok ? "ok" : "fail", attester: a.attester });
    } catch {
      setAtt({ state: "fail" });
    }
  };

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
    if (!address) return setNote("Connect your wallet first.");
    setWithdrawing(true);
    try {
      const r = await withdrawForeman(address, String(amt));
      setWithdrawTx(r.tx ?? null);
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

        {/* Credit score — the headline metric, and it moves */}
        <div className="flex items-center gap-2.5" title="Credit score: repayment history + activity + tenure. Sets your credit line (10–50% of lifetime spend).">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">Credit score</div>
            <div className="font-mono">
              {connected && account ? (
                <span className={scoreColor}>
                  {score} <span className="text-xs text-muted">/ 100 · {band}</span>
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>
            {connected && account && (
              <div className="mt-0.5 leading-tight">
                <button
                  onClick={verifyScore}
                  disabled={att.state === "checking"}
                  title="Fetch an EIP-712-signed attestation of this score and verify the signature in your browser — no trust in our server."
                  className={`inline-flex items-center gap-1 text-[10px] hover:underline ${att.state === "ok" ? "text-accent" : att.state === "fail" ? "text-warn" : "text-muted hover:text-accent"}`}
                >
                  <ShieldCheck size={11} />
                  {att.state === "checking" ? "verifying…" : att.state === "ok" ? "signature verified" : att.state === "fail" ? "verify failed — retry" : "verify score"}
                </button>
                {att.state === "ok" && att.attester && (
                  <a href={`${ARCSCAN}/address/${att.attester}`} target="_blank" rel="noreferrer" className="ml-1.5 text-[10px] text-accent/70 hover:underline">
                    attester {att.attester.slice(0, 6)}…{att.attester.slice(-4)} ↗
                  </a>
                )}
              </div>
            )}
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
              <VerifyOwnership />
              <span className="hidden text-xs text-muted md:inline">wallet {walletUsdc ?? "…"}</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-16 rounded-lg border border-edge bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              />
              <button onClick={fund} disabled={isPending || !verified} title={!verified ? "Verify wallet ownership first" : ""} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50">
                <Plus size={13} /> {isPending ? "Confirm…" : owed > 0 ? "Repay/Fund" : "Fund"}
              </button>
              <button onClick={withdraw} disabled={withdrawing || !verified || (account?.balance ?? 0) <= 0} title={!verified ? "Verify wallet ownership first" : (account?.balance ?? 0) <= 0 ? "No balance to withdraw" : `Up to ${(account?.balance ?? 0).toFixed(2)}`} className="inline-flex items-center gap-1 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs hover:border-accent/40 disabled:opacity-40">
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
      {withdrawTx && (
        <div className="mt-1 text-xs text-accent">
          withdrawn ✓ <a href={`${ARCSCAN}/tx/${withdrawTx}`} target="_blank" rel="noreferrer" className="hover:underline">view on Arcscan ↗</a>
        </div>
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
