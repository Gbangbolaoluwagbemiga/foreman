import "dotenv/config";
import { defineChain } from "viem";

/** Arc Testnet — Circle's stablecoin-native L1. USDC is the native currency (6 decimals). */
export const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.drpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const config = {
  groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  settlementRail: (process.env.SETTLEMENT_RAIL?.trim() || "mock") as "mock" | "arc-usdc",
  usdcAddress: (process.env.USDC_ADDRESS?.trim() ||
    "0x3600000000000000000000000000000000000000") as `0x${string}`,
  foremanPrivateKey: (process.env.FOREMAN_PRIVATE_KEY?.trim() || "") as `0x${string}` | "",
};

/** USDC on Arc Testnet has 6 decimals. */
export const USDC_DECIMALS = 6;
