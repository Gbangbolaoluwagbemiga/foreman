import http from "node:http";
import {
  createGatewayMiddleware,
  type PaymentRequest,
  type PaymentResponse,
} from "@circle-fin/x402-batching/server";
import { CrewRegistry, runCrewTask } from "../crew";

/** Arc Testnet, CAIP-2. Circle's testnet Gateway facilitator. */
const ARC_TESTNET_NETWORK = "eip155:5042002";
const FACILITATOR_TESTNET = "https://gateway-api-testnet.circle.com";

/**
 * Runs each crew member as a REAL x402 seller behind Circle Gateway.
 * `gateway.require('$price')` returns Express-style middleware that issues the
 * 402, verifies the buyer's signed authorization, and settles via Gateway
 * batching before we hand back the work.
 */
export function startCrewServer(registry: CrewRegistry, port: number): Promise<http.Server> {
  type MW = ReturnType<ReturnType<typeof createGatewayMiddleware>["require"]>;
  const paywall = new Map<string, MW>();
  for (const m of registry.members) {
    const gw = createGatewayMiddleware({
      sellerAddress: m.signer.address,
      networks: ARC_TESTNET_NETWORK,
      facilitatorUrl: FACILITATOR_TESTNET,
    });
    paywall.set(m.id, gw.require(`$${m.priceUsdc}`));
  }

  const server = http.createServer((req, res) => {
    const match = (req.url ?? "").match(/^\/crew\/([^/?]+)/);
    if (req.method !== "POST" || !match) {
      res.writeHead(404).end("not found");
      return;
    }
    const key = match[1]!.toLowerCase();
    const member = registry.members.find((m) => m.id === key || m.name.toLowerCase() === key);
    if (!member) {
      res.writeHead(404).end("no such crew");
      return;
    }

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      // Shim the Express-style req/res the middleware expects onto raw http.
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

      // Run the Gateway paywall. `next()` means paid+settled → do the work.
      const mw = paywall.get(member.id)!;
      const proceed = await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (v: boolean) => {
          if (!settled) {
            settled = true;
            resolve(v);
          }
        };
        res.on("finish", () => done(false)); // middleware sent a 402 / error
        void Promise.resolve(mw(preq, pres, (err?: unknown) => done(!err)));
      });
      if (!proceed) return;

      const body = preq.body as { task?: string; context?: string };
      const deliverable = await runCrewTask(member, body?.task ?? "", body?.context);
      if (!res.writableEnded) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ deliverable, payment: preq.payment }));
      }
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
