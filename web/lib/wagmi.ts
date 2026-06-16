import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "viem";
import type { AppKitNetwork } from "@reown/appkit/networks";

/** Arc Testnet — USDC is the native currency (6 decimals). */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.drpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

const arcTestnetReown = arcTestnet as unknown as AppKitNetwork;
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [arcTestnetReown];

export const USDC = (process.env.NEXT_PUBLIC_USDC || "0x3600000000000000000000000000000000000000") as `0x${string}`;
export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "ce936f0ca615ee7d294082866c0d945a";

export const wagmiAdapter = new WagmiAdapter({ projectId, networks });
export const wagmiConfig = wagmiAdapter.wagmiConfig;
