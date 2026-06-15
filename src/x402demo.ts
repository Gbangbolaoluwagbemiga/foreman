import http from "node:http";
import { parseUnits } from "viem";
import { CrewRegistry, runCrewTask, usingRealBrain } from "./crew";
import { createLocalSigner } from "./signer";
import { config, USDC_DECIMALS } from "./config";
import { buildRequirements, verifyPayment, decodePaymentHeader } from "./x402/protocol";
import type { Requirements402 } from "./x402/types";

/**
 * End-to-end proof of the real x402 payment protocol:
 *   1. Foreman asks a crew member (an x402 SELLER) to do work.
 *   2. Seller replies 402 Payment Required with its price.
 *   3. Foreman signs an EIP-3009 USDC authorization and retries.
 *   4. Seller cryptographically verifies the payment, then does the work.
 *
 * Settlement here is "verified but not yet broadcast" — Circle Gateway batching
 * slots in exactly at the verify step to settle on Arc.
 */

const registry = CrewRegistry.seeded();
const seller = registry.members.find((m) => m.name === "Quill")!; // a copywriter crew member
const PORT = 8402;

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/crew/quill")) {
    res.writeHead(404).end("not found");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const task = (() => { try { return JSON.parse(body).task as string; } catch { return ""; } })();
    const price = parseUnits(seller.priceUsdc.toString(), USDC_DECIMALS);
    const header = req.headers["x-payment"];

    // No payment → ask for it (HTTP 402)
    if (!header || typeof header !== "string") {
      const reqs = buildRequirements({
        payTo: seller.signer.address,
        amountBaseUnits: price,
        resource: "/crew/quill",
        description: `${seller.name} — ${seller.skill}`,
      });
      res.writeHead(402, { "Content-Type": "application/json" }).end(JSON.stringify(reqs));
      return;
    }

    // Payment presented → verify cryptographically
    const payment = decodePaymentHeader(header);
    const check = await verifyPayment(payment, { payTo: seller.signer.address, minAmountBaseUnits: price });
    if (!check.ok) {
      res.writeHead(402, { "Content-Type": "application/json" }).end(JSON.stringify({ error: check.reason }));
      return;
    }

    // Paid & verified → do the work
    const deliverable = await runCrewTask(seller, task);
    registry.recordOutcome(seller.id, true);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-PAYMENT-RESPONSE": `verified:${check.payer}`,
    }).end(JSON.stringify({ deliverable, paidBy: check.payer, amount: check.amount }));
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(PORT, r));
  const foreman = createLocalSigner(config.foremanPrivateKey || undefined);
  const url = `http://localhost:${PORT}/crew/quill`;
  const task = "Write a 1-line tagline for an AI coffee shop called 'Bean There'.";

  console.log("──────────────────────────────────────────────");
  console.log("  x402 nanopayment — Foreman pays crew per call");
  console.log("──────────────────────────────────────────────");
  console.log(`  brain: ${usingRealBrain() ? config.groqModel : "mock"}`);
  console.log(`  foreman (payer): ${foreman.address}`);
  console.log(`  Quill (seller):  ${seller.signer.address}  price $${seller.priceUsdc.toFixed(3)}\n`);

  // 1) probe → expect 402
  const probe = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task }) });
  console.log(`  → asked Quill to work. Server says: HTTP ${probe.status} ${probe.status === 402 ? "Payment Required" : ""}`);
  const reqs = (await probe.json()) as Requirements402;
  console.log(`  → price: ${reqs.accepts[0]!.maxAmountRequired} USDC base units to ${reqs.accepts[0]!.payTo}`);

  // 2) pay via x402 (sign EIP-3009 + retry)
  const { x402Fetch } = await import("./x402/protocol");
  const result = await x402Fetch(url, foreman.account, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task }) });

  console.log(`\n  💸 Paid & verified → HTTP ${result.status}  [${result.paid?.settlementRef}]`);
  console.log(`  🧾 ${seller.priceUsdc.toFixed(3)} USDC, signed authorization from ${foreman.address.slice(0, 10)}…`);
  console.log(`\n  Quill delivered:\n  "${(result.body as any).deliverable}"`);
  console.log("──────────────────────────────────────────────");
  server.close();
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
