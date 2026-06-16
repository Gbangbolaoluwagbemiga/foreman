"use client";

import { useState } from "react";
import { ARCSCAN, isTransferId, verifyTransfer, type TransferProof } from "@/lib/engine";

/**
 * Turns a payment reference into verifiable on-chain proof.
 *  • Circle transfer UUID → live "Verify" that fetches the settlement record.
 *  • 0x… tx hash         → direct Arcscan transaction link.
 *  • gw:/mock fallback   → link to the recipient wallet on Arcscan (real inflows).
 */
export function VerifyLink({ paymentRef, recipient }: { paymentRef: string; recipient?: string }) {
  const [proof, setProof] = useState<TransferProof | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  if (paymentRef?.startsWith("0x") && paymentRef.length > 20) {
    return (
      <a href={`${ARCSCAN}/tx/${paymentRef}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {paymentRef.slice(0, 12)}… ↗
      </a>
    );
  }

  if (!isTransferId(paymentRef)) {
    // gw:/mock — still link to the payee's on-chain page if we have it.
    return recipient ? (
      <a href={`${ARCSCAN}/address/${recipient}`} target="_blank" rel="noreferrer" className="text-muted hover:text-ink hover:underline">
        payee ↗
      </a>
    ) : (
      <span className="text-muted">[{paymentRef}]</span>
    );
  }

  async function check() {
    setState("loading");
    try {
      setProof(await verifyTransfer(paymentRef));
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (proof) {
    return (
      <a
        href={proof.explorer}
        target="_blank"
        rel="noreferrer"
        title={`Circle transfer ${proof.id}`}
        className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent hover:bg-accent/20"
      >
        ✓ {proof.status} · ${proof.amountUsdc.toFixed(2)} → {proof.to.slice(0, 6)}…{proof.to.slice(-4)} ↗
      </a>
    );
  }

  return (
    <button
      onClick={check}
      disabled={state === "loading"}
      className="inline-flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 hover:border-accent/50 hover:text-ink disabled:opacity-50"
      title={`Verify Circle settlement ${paymentRef}`}
    >
      {state === "loading" ? "checking…" : state === "error" ? "retry verify" : "✓ verify on-chain"}
    </button>
  );
}
