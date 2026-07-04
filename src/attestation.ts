import { keccak256, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "./config";

/**
 * Signed credit-score attestations — a portable, independently-verifiable credit
 * primitive for autonomous agents.
 *
 * The engine already computes a real, behaviour-based credit score per wallet.
 * This turns that from "a number you have to trust our server for" into an
 * EIP-712 signature anyone can verify offline against a known attester address —
 * the smallest useful version of CREDIT.md roadmap item 4.
 *
 * Nothing here touches money movement; it only reads the score and signs it.
 */

// How long a fresh attestation is considered valid.
const TTL_SECONDS = 3600;

// EIP-712 type of a credit attestation. `creditLimit` is micro-USDC (6 decimals)
// so it's an integer that on-chain verifiers can consume directly.
export const ATTESTATION_TYPES = {
  CreditAttestation: [
    { name: "subject", type: "address" },
    { name: "score", type: "uint256" },
    { name: "creditLimit", type: "uint256" },
    { name: "band", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const ATTESTATION_PRIMARY_TYPE = "CreditAttestation" as const;

/** EIP-712 domain — no verifyingContract (this is an off-chain attestation). */
export function attestationDomain() {
  return { name: "Foreman Credit", version: "1", chainId: arcTestnet.id } as const;
}

export interface CreditAttestationMessage {
  subject: `0x${string}`;
  score: bigint;
  creditLimit: bigint; // micro-USDC (6 decimals)
  band: string;
  issuedAt: bigint;
  expiry: bigint;
}

/**
 * Resolve the attester signing key with a stable, predictable precedence:
 *   1. ATTESTER_PRIVATE_KEY — an explicit, dedicated key (recommended in prod).
 *   2. Derived from AUTH_SECRET — stable across restarts without a new secret.
 *   3. Ephemeral — a random key per boot (fine for a demo; address is published
 *      via /credit/attester so verification still works within a run).
 * The attester is its OWN identity, deliberately separate from the treasury that
 * pays crew — vouching for a score and spending money are different authorities.
 */
export function resolveAttesterKey(
  explicit?: string,
  authSecret?: string,
): { key: `0x${string}`; source: string; stable: boolean } {
  const e = explicit?.trim();
  if (e && /^0x[0-9a-fA-F]{64}$/.test(e)) return { key: e as `0x${string}`, source: "ATTESTER_PRIVATE_KEY", stable: true };
  if (authSecret && authSecret.length > 0) {
    // KDF, not reuse: the signing key is keccak(label || AUTH_SECRET), so the
    // HMAC session secret is never itself used to sign attestations.
    const derived = keccak256(toBytes(`foreman-credit-attester:v1:${authSecret}`)) as `0x${string}`;
    return { key: derived, source: "derived from AUTH_SECRET", stable: true };
  }
  return { key: generatePrivateKey(), source: "ephemeral", stable: false };
}

export function createAttester(explicit?: string, authSecret?: string) {
  const { key, source, stable } = resolveAttesterKey(explicit, authSecret);
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    source,
    stable,
    /** Sign a credit attestation with the attester's EIP-712 key. */
    sign(message: CreditAttestationMessage) {
      return account.signTypedData({
        domain: attestationDomain(),
        types: ATTESTATION_TYPES,
        primaryType: ATTESTATION_PRIMARY_TYPE,
        message,
      });
    },
  };
}

/** Build the attestation message for a wallet's current score + limit. */
export function buildAttestation(
  subject: `0x${string}`,
  score: number,
  creditLimitUsdc: number,
  band: string,
): CreditAttestationMessage {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    subject,
    score: BigInt(Math.round(score)),
    creditLimit: BigInt(Math.round(creditLimitUsdc * 1e6)),
    band,
    issuedAt: BigInt(issuedAt),
    expiry: BigInt(issuedAt + TTL_SECONDS),
  };
}
