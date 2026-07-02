import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { config } from "./config";

/**
 *   npm run circle:register
 *
 * One-time: generate a 32-byte entity secret (if you don't have one) and register
 * it with Circle. Circle stores only a rotating ciphertext of it; every signing
 * request is authorized with a fresh ciphertext derived from the secret you hold.
 * Prints the secret to add to .env and saves the recovery file. Needs CIRCLE_API_KEY.
 */
async function main() {
  const apiKey = config.circleApiKey;
  if (!apiKey) {
    console.error("✗ Set CIRCLE_API_KEY in Foreman/.env first (see CIRCLE_SETUP.md).");
    process.exit(1);
  }

  const existing = config.circleEntitySecret;
  const entitySecret = existing || randomBytes(32).toString("hex");
  const generated = !existing;

  // recoveryFileDownloadPath is a DIRECTORY — the SDK writes recovery_file_<uuid>.dat inside it.
  const recoveryDir = path.join(process.cwd(), "data");
  fs.mkdirSync(recoveryDir, { recursive: true });

  // Print (and persist) the secret BEFORE the network call so a mid-flight crash can never
  // leave a secret registered with Circle that we never captured.
  if (generated) {
    console.log("\n── Add this to Foreman/.env (save it NOW, before anything else) ──");
    console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}\n`);
    const stash = path.join(recoveryDir, "entity-secret.txt");
    fs.writeFileSync(stash, entitySecret + "\n", { mode: 0o600 });
    console.log(`   (also stashed → ${stash} — gitignored; move to .env then delete)\n`);
  }

  console.log("→ Registering entity secret with Circle…");
  await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: recoveryDir });

  console.log("\n✅ Entity secret registered with Circle.");
  if (!generated) {
    console.log("   (used your existing CIRCLE_ENTITY_SECRET from .env)");
  }
  console.log(`\n   Recovery file saved under → ${recoveryDir}/recovery_file_*.dat`);
  console.log("   Keep it safe (it's gitignored) — it recovers access if you lose the entity secret.\n");
  console.log("Next: add CIRCLE_ENTITY_SECRET to .env, then run  npm run circle:setup");
}

main().catch((e) => {
  const msg = e?.response?.data ?? e?.message ?? e;
  console.error("✗ circle:register failed:", typeof msg === "string" ? msg : JSON.stringify(msg));
  if (String(JSON.stringify(msg)).toLowerCase().includes("already")) {
    console.error("\n  An entity secret is already registered for this API key.");
    console.error("  • Have that secret? Put it in CIRCLE_ENTITY_SECRET and skip this step.");
    console.error("  • Lost it? Reset in Circle console → Configurator → Entity Secret, then re-run.");
  }
  process.exit(1);
});
