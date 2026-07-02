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
  // Reputation half-life: how long an idle agent takes to drift halfway back to
  // the neutral baseline (50). Lower = a more aggressive "what have you done lately"
  // signal. Default 3h; override with REP_DECAY_HALF_LIFE_MIN.
  repDecayHalfLifeMs: Math.max(1, Number(process.env.REP_DECAY_HALF_LIFE_MIN) || 180) * 60_000,

  // Max price a NEWLY-registered (unproven) agent may charge. Kept moderate on
  // purpose: an untested agent shouldn't be able to list itself at a high price.
  // Proven agents earn the right to charge more over time. Override with MAX_AGENT_PRICE.
  maxAgentPriceUsdc: Math.max(0.005, Number(process.env.MAX_AGENT_PRICE) || 0.05),

  // ── Custody: where the Foreman treasury key lives ──
  //   local  → a raw private key in this process (FOREMAN_PRIVATE_KEY). Fine for a demo.
  //   circle → a Circle Programmable Wallet (MPC). Circle holds the key shares; Foreman
  //            never sees a raw key and authorizes spends via the Circle API. See CIRCLE_SETUP.md.
  walletCustody: (process.env.WALLET_CUSTODY?.trim() || "local") as "local" | "circle",
  circleApiKey: process.env.CIRCLE_API_KEY?.trim() || "",
  circleEntitySecret: process.env.CIRCLE_ENTITY_SECRET?.trim() || "",
  circleWalletId: process.env.CIRCLE_WALLET_ID?.trim() || "",
  circleWalletAddress: (process.env.CIRCLE_WALLET_ADDRESS?.trim() || "") as `0x${string}` | "",
  // Circle Blockchain code for the treasury wallet (the SDK enum includes ARC-TESTNET).
  circleBlockchain: process.env.CIRCLE_BLOCKCHAIN?.trim() || "ARC-TESTNET",
};

/** USDC on Arc Testnet has 6 decimals. */
export const USDC_DECIMALS = 6;
