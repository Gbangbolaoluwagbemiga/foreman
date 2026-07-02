import "dotenv/config";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { config } from "./config";

/**
 * One-time setup for Circle Programmable Wallets (MPC custody).
 *
 *   npm run circle:setup
 *
 * Creates a wallet set + one MPC treasury wallet on Arc Testnet and prints the
 * env lines to paste into Foreman/.env. Circle holds the key shares — no raw key
 * ever exists in Foreman. Prerequisite: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET set
 * and the entity secret registered with Circle (see CIRCLE_SETUP.md).
 */
async function main() {
  const apiKey = config.circleApiKey;
  const entitySecret = config.circleEntitySecret;
  if (!apiKey || !entitySecret) {
    console.error("✗ Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in Foreman/.env first.\n  See CIRCLE_SETUP.md for how to get them.");
    process.exit(1);
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  console.log("→ Creating wallet set 'Foreman Treasury'…");
  const wsRes: any = await client.createWalletSet({ name: "Foreman Treasury" });
  const walletSetId: string | undefined = wsRes?.data?.walletSet?.id;
  if (!walletSetId) throw new Error("no wallet set id returned");

  console.log(`→ Creating an MPC wallet on ${config.circleBlockchain}…`);
  const wRes: any = await client.createWallets({
    walletSetId,
    blockchains: [config.circleBlockchain as never],
    count: 1,
    accountType: "EOA",
  });
  const wallet = wRes?.data?.wallets?.[0];
  if (!wallet?.address) throw new Error("no wallet returned");

  console.log("\n✅ Circle MPC treasury wallet created — key shares held by Circle, no raw key in Foreman.\n");
  console.log("   wallet id : " + wallet.id);
  console.log("   address   : " + wallet.address);
  console.log("   chain     : " + (wallet.blockchain ?? config.circleBlockchain));
  console.log("\n── Add these to Foreman/.env ──");
  console.log("WALLET_CUSTODY=circle");
  console.log(`CIRCLE_WALLET_ID=${wallet.id}`);
  console.log(`CIRCLE_WALLET_ADDRESS=${wallet.address}`);
  console.log("\nNext: fund that address with testnet USDC on Arc, then start the engine with");
  console.log("      ENGINE_RAIL=gateway — Foreman will deposit + pay crew via MPC.\n");
}

main().catch((e) => {
  console.error("✗ circle:setup failed:", e?.response?.data ?? e?.message ?? e);
  process.exit(1);
});
