import { recoverTypedDataAddress, type PrivateKeyAccount } from "viem";
import { randomBytes } from "node:crypto";
import { config } from "../config";
import type { Authorization, PaymentPayload, PaymentRequirements, Requirements402 } from "./types";

export const X402_VERSION = 1;
export const x402Network = () => `eip155:${process.env.ARC_CHAIN_ID ?? 5042002}`;

/**
 * EIP-712 domain for USDC's EIP-3009. name/version vary per token deployment —
 * override via env once confirmed against the real Arc USDC (Circle sample).
 */
function usdcDomain() {
  return {
    name: process.env.USDC_NAME ?? "USDC",
    version: process.env.USDC_VERSION ?? "2",
    chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    verifyingContract: config.usdcAddress,
  } as const;
}

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function message(a: Authorization) {
  return {
    from: a.from,
    to: a.to,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
  };
}

/** Server: advertise the price for a resource (the body of a 402 response). */
export function buildRequirements(opts: {
  payTo: `0x${string}`;
  amountBaseUnits: bigint;
  resource: string;
  description: string;
  timeoutSeconds?: number;
}): Requirements402 {
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: "exact",
        network: x402Network(),
        maxAmountRequired: opts.amountBaseUnits.toString(),
        resource: opts.resource,
        description: opts.description,
        payTo: opts.payTo,
        asset: config.usdcAddress,
        maxTimeoutSeconds: opts.timeoutSeconds ?? 300,
      },
    ],
  };
}

/** Client: sign an EIP-3009 USDC payment authorization. */
export async function signAuthorization(
  account: PrivateKeyAccount,
  to: `0x${string}`,
  amountBaseUnits: bigint,
  ttlSeconds = 300,
): Promise<{ authorization: Authorization; signature: `0x${string}` }> {
  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from: account.address,
    to,
    value: amountBaseUnits.toString(),
    validAfter: "0",
    validBefore: String(now + ttlSeconds),
    nonce: `0x${randomBytes(32).toString("hex")}`,
  };
  const signature = await account.signTypedData({
    domain: usdcDomain(),
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: message(authorization),
  });
  return { authorization, signature };
}

/** Server: cryptographically verify a presented payment authorization. */
export async function verifyPayment(
  payment: PaymentPayload,
  expected: { payTo: `0x${string}`; minAmountBaseUnits: bigint },
): Promise<{ ok: boolean; reason?: string; payer?: `0x${string}`; amount?: string }> {
  const a = payment.payload.authorization;
  const now = Math.floor(Date.now() / 1000);
  if (a.to.toLowerCase() !== expected.payTo.toLowerCase()) return { ok: false, reason: "wrong recipient" };
  if (BigInt(a.value) < expected.minAmountBaseUnits) return { ok: false, reason: "underpaid" };
  if (Number(a.validBefore) < now) return { ok: false, reason: "authorization expired" };
  const recovered = await recoverTypedDataAddress({
    domain: usdcDomain(),
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: message(a),
    signature: payment.payload.signature,
  });
  if (recovered.toLowerCase() !== a.from.toLowerCase()) return { ok: false, reason: "bad signature" };
  return { ok: true, payer: a.from, amount: a.value };
}

export function encodePaymentHeader(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p)).toString("base64");
}
export function decodePaymentHeader(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
}

export interface X402Result {
  status: number;
  paid?: { amountBaseUnits: string; to: `0x${string}`; settlementRef: string };
  body: unknown;
}

/**
 * Client side: fetch a resource, paying automatically if the server asks (402).
 * Returns the resource plus what was paid.
 */
export async function x402Fetch(
  url: string,
  account: PrivateKeyAccount,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<X402Result> {
  const first = await fetch(url, init);
  if (first.status !== 402) return { status: first.status, body: await safeJson(first) };

  const reqs = (await first.json()) as Requirements402;
  const accept: PaymentRequirements | undefined = reqs.accepts?.[0];
  if (!accept) return { status: 402, body: reqs };

  const { authorization, signature } = await signAuthorization(account, accept.payTo, BigInt(accept.maxAmountRequired));
  const payment: PaymentPayload = {
    x402Version: reqs.x402Version ?? X402_VERSION,
    scheme: "exact",
    network: accept.network,
    payload: { signature, authorization },
  };
  const second = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), "X-PAYMENT": encodePaymentHeader(payment) },
  });
  return {
    status: second.status,
    paid: {
      amountBaseUnits: accept.maxAmountRequired,
      to: accept.payTo,
      settlementRef: second.headers.get("X-PAYMENT-RESPONSE") ?? "verified",
    },
    body: await safeJson(second),
  };
}

async function safeJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    return await r.text();
  }
}
