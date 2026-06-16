import "dotenv/config";
import { defineChain } from "viem";

/**
 * Resolve the Arc RPC, preferring Canteen's authenticated endpoint ($RPC, set by
 * `arc-canteen login` → `source ~/.arc-canteen/env`). The token is a secret and
 * lives only in ~/.arc-canteen/env — never commit it.
 */
export const rpcUrl =
  process.env.RPC ?? process.env.ARC_RPC_URL ?? "https://rpc.drpc.testnet.arc.network";

/** Arc Testnet — Circle's stablecoin-native L1. USDC is the native currency (6 decimals). */
export const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const config = {
  groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  // Tried automatically when the primary model is rate-limited (separate daily quota).
  groqFallbackModel: process.env.GROQ_FALLBACK_MODEL?.trim() || "llama-3.1-8b-instant",
  settlementRail: (process.env.SETTLEMENT_RAIL?.trim() || "mock") as "mock" | "arc-usdc",
  usdcAddress: (process.env.USDC_ADDRESS?.trim() ||
    "0x3600000000000000000000000000000000000000") as `0x${string}`,
  foremanPrivateKey: (process.env.FOREMAN_PRIVATE_KEY?.trim() || "") as `0x${string}` | "",
};

/** USDC on Arc Testnet has 6 decimals. */
export const USDC_DECIMALS = 6;
