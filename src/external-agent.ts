import http from "node:http";
import {
  createGatewayMiddleware,
  type PaymentRequest,
  type PaymentResponse,
} from "@circle-fin/x402-batching/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { groqComplete } from "./crew";

/**
 * A REAL third-party agent — a standalone service with its OWN wallet that sells a
 * skill over x402/Circle Gateway and auto-registers with the Foreman marketplace.
 *
 * This is the open-economy proof: the Foreman discovers and pays an agent it didn't
 * build, across process boundaries, and USDC settles to that agent's own wallet.
 * It's also the "this is all it takes to plug in and earn" template for other builders.
 *
 *   AGENT_NAME, AGENT_SKILL, AGENT_PRICE, AGENT_PORT, AGENT_SYSTEM_PROMPT
 *   AGENT_PRIVATE_KEY  — this agent's wallet (earnings settle here). Auto-generated if unset.
 *   FOREMAN_URL        — engine to register with (default http://localhost:8799)
 */
const NAME = process.env.AGENT_NAME || "Lingo";
const SKILL = process.env.AGENT_SKILL || "translation";
const PRICE = process.env.AGENT_PRICE || "0.08";
const PORT = Number(process.env.AGENT_PORT) || 8500;
const FOREMAN = process.env.FOREMAN_URL || "http://localhost:8799";
const SYSTEM =
  process.env.AGENT_SYSTEM_PROMPT ||
  "You are Lingo, a professional translator. Translate the user's text into fluent French; reply with only the translation.";

const ARC_TESTNET_NETWORK = "eip155:5042002";
const FACILITATOR_TESTNET = "https://gateway-api-testnet.circle.com";

// This agent's OWN wallet — completely separate from the Foreman.
const key = (process.env.AGENT_PRIVATE_KEY || generatePrivateKey()) as `0x${string}`;
const account = privateKeyToAccount(key);

const paywall = createGatewayMiddleware({
  sellerAddress: account.address,
  networks: ARC_TESTNET_NETWORK,
  facilitatorUrl: FACILITATOR_TESTNET,
}).require(`$${PRICE}`);

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/agent")) {
    res.writeHead(404).end("not found");
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    const preq = req as unknown as PaymentRequest;
    try {
      preq.body = raw ? JSON.parse(raw) : {};
    } catch {
      preq.body = {};
    }
    const pres = res as unknown as PaymentResponse;
    pres.status = (code: number) => {
      res.statusCode = code;
      return pres;
    };
    pres.json = (data: unknown) => {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    };

    const proceed = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      res.on("finish", () => done(false));
      void Promise.resolve(paywall(preq, pres, (err?: unknown) => done(!err)));
    });
    if (!proceed) return;

    const body = preq.body as { task?: string; context?: string };
    const out =
      (await groqComplete(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: body?.task ?? "" },
        ],
        { maxTokens: 400 },
      )) ?? `[${NAME}] delivered (offline)`;
    if (!res.writableEnded) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ deliverable: out }));
    }
  });
});

server.listen(PORT, async () => {
  const endpoint = `http://localhost:${PORT}/agent`;
  console.log(`\n  🌐 External agent "${NAME}" (${SKILL}, $${PRICE}/task) live → ${endpoint}`);
  console.log(`     earnings settle to its OWN wallet: ${account.address}`);
  try {
    const r = await fetch(`${FOREMAN}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: NAME,
        skill: SKILL,
        priceUsdc: Number(PRICE),
        walletAddress: account.address,
        endpointUrl: endpoint,
      }),
    });
    if (r.ok) console.log(`     ✓ registered with Foreman (${FOREMAN}) — now hireable by any job needing "${SKILL}"\n`);
    else console.log(`     ⚠ Foreman rejected registration (${r.status}) — is the engine running on the gateway rail?\n`);
  } catch {
    console.log(`     ⚠ couldn't reach the Foreman engine at ${FOREMAN} — start it first (npm run serve:gateway)\n`);
  }
});
