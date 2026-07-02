"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ShieldCheck, Shield } from "lucide-react";
import { getSiweChallenge, verifySiwe, clearSession } from "@/lib/engine";
import { useVerified } from "./useSession";

/**
 * Sign-In-With-Ethereum: prove you own the connected wallet before the app will
 * touch your Foreman account (fund, controls, run a job, standing orders). One
 * signature mints a session; the engine rejects account actions without it.
 */
export function VerifyOwnership() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const verified = useVerified(address);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!isConnected || !address) return null;

  const verify = async () => {
    setErr("");
    setBusy(true);
    try {
      const { message } = await getSiweChallenge(address);
      const signature = await signMessageAsync({ message });
      await verifySiwe(address, signature);
    } catch (e) {
      setErr((e as Error).message?.split("\n")[0]?.slice(0, 90) || "verification failed");
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs text-accent">
        <ShieldCheck size={13} /> verified owner
        <button onClick={() => clearSession()} title="Sign out" className="ml-1 text-accent/60 hover:text-accent">
          ✕
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={verify}
        disabled={busy}
        title="Sign a message to prove you own this wallet"
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:border-amber-400/80 disabled:opacity-50"
      >
        <Shield size={13} /> {busy ? "Sign in wallet…" : "Verify ownership"}
      </button>
      {err && <span className="text-xs text-warn">⚠ {err}</span>}
    </span>
  );
}
