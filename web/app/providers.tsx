"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiProvider, type Config } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiAdapter, wagmiConfig, projectId, networks } from "@/lib/wagmi";

// Reown AppKit — provides the wallet modal + account view (copy / disconnect /
// switch network). Initialised once on the client.
createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: networks[0],
  metadata: {
    name: "Foreman",
    description: "Agents that hire and pay agents on Arc",
    url: typeof window !== "undefined" ? window.location.origin : "https://foreman.app",
    icons: [],
  },
  features: { analytics: false, email: false, socials: [] },
  themeMode: "dark",
  themeVariables: { "--w3m-accent": "#3ee08f", "--w3m-border-radius-master": "8px" },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig as unknown as Config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
