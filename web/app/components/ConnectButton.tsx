"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const cls = "rounded-md border border-edge bg-panel2 px-3 py-1.5 text-sm hover:border-accent/40";
  if (!mounted) return <span className={cls + " text-muted"}>Wallet</span>;

  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} className={cls + " font-mono text-accent"}>
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  const injected = connectors[0];
  return (
    <button onClick={() => injected && connect({ connector: injected })} disabled={!injected || isPending} className={cls}>
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
