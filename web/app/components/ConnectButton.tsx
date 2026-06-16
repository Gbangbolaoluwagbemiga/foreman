"use client";

import { useEffect, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";

export function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { open } = useAppKit();
  const { address, isConnected } = useAccount();

  const cls = "rounded-md border border-edge bg-panel2 px-3 py-1.5 text-sm hover:border-accent/40";
  if (!mounted) return <span className={cls + " text-muted"}>Wallet</span>;

  if (isConnected && address) {
    // Opens the AppKit account view: copy address, switch network, disconnect, etc.
    return (
      <button onClick={() => open({ view: "Account" })} className={cls + " font-mono text-accent"}>
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  return (
    <button onClick={() => open()} className={cls}>
      Connect wallet
    </button>
  );
}
