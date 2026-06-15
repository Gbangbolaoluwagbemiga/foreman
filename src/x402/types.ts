/**
 * Minimal x402 ("HTTP 402 Payment Required") types for the EVM "exact" scheme,
 * which pays USDC via an EIP-3009 `transferWithAuthorization` signature.
 *
 * Flow: client requests → server replies 402 + PaymentRequirements → client signs
 * an Authorization and retries with an X-PAYMENT header → server verifies + serves.
 */

export interface Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string; // USDC base units (6 decimals), stringified
  validAfter: string; // unix seconds
  validBefore: string; // unix seconds
  nonce: `0x${string}`; // 32-byte hex
}

export interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string; // CAIP-2, e.g. "eip155:5042002"
  payload: { signature: `0x${string}`; authorization: Authorization };
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string; // USDC base units
  resource: string;
  description: string;
  payTo: `0x${string}`;
  asset: `0x${string}`; // USDC contract
  maxTimeoutSeconds: number;
}

export interface Requirements402 {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
}
