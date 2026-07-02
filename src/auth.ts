import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import { verifyMessage } from "viem";

/**
 * Sign-In-With-Ethereum (EIP-4361) for Foreman.
 *
 * An account is keyed by a wallet address — but anyone could POST that address.
 * Before a spend account's money can be moved (fund, set caps, flip the kill
 * switch, run a job, create a standing order) the caller must PROVE they own the
 * wallet by signing a one-time challenge. That proof mints a short-lived session
 * token, and the protected endpoints require a token whose address matches.
 *
 * This is what makes the credit score a trustworthy signal: reputation and credit
 * belong to a *provably owned* identity, not a spoofable one.
 */

const NONCE_TTL_MS = 5 * 60_000; // a challenge is valid for 5 minutes
const SESSION_TTL_MS = 12 * 60 * 60_000; // a session lasts 12 hours

// address → the exact message we asked it to sign (single-use, short-lived).
const challenges = new Map<string, { message: string; exp: number }>();

// Session-signing secret. Set AUTH_SECRET to keep sessions valid across restarts;
// otherwise a per-boot random secret (sessions re-verify after a restart).
const SECRET = process.env.AUTH_SECRET?.trim() || randomBytes(32).toString("hex");
const DOMAIN = process.env.AUTH_DOMAIN?.trim() || "foreman";

const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Issue a challenge and return the SIWE message for the wallet to sign. */
export function issueChallenge(address: string): { nonce: string; message: string } | null {
  if (!isAddress(address)) return null;
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message =
    `${DOMAIN} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `Verify you own this wallet to manage your Foreman spending account.\n\n` +
    `URI: https://${DOMAIN}\n` +
    `Version: 1\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`;
  challenges.set(address.toLowerCase(), { message, exp: Date.now() + NONCE_TTL_MS });
  return { nonce, message };
}

/** Verify the signature over the issued challenge; on success mint a session. */
export async function verifyAndMint(
  address: string,
  signature: string,
): Promise<{ token: string; address: string; expiresAt: number } | null> {
  if (!isAddress(address) || typeof signature !== "string") return null;
  const key = address.toLowerCase();
  const entry = challenges.get(key);
  if (!entry || entry.exp < Date.now()) return null;
  let ok = false;
  try {
    ok = await verifyMessage({ address: address as `0x${string}`, message: entry.message, signature: signature as `0x${string}` });
  } catch {
    ok = false;
  }
  if (!ok) return null;
  challenges.delete(key); // single-use
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ a: key, e: exp })).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, address: key, expiresAt: exp };
}

/** Return the verified (lowercase) address for a session token, or null. */
export function verifySession(token?: string | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { a: addr, e: exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp < Date.now()) return null;
    return String(addr).toLowerCase();
  } catch {
    return null;
  }
}

/** Pull the Bearer token off a request. */
export function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers["authorization"];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.startsWith("Bearer ") ? v.slice(7).trim() : null;
}

/**
 * ── Agent API keys ────────────────────────────────────────────────────────────
 * A SIWE session proves a *human* owns the account. But headless agents (via MCP
 * or the `/delegate` API) can't sign in a browser. An API key is a long-lived,
 * revocable credential the owner mints *after* proving ownership, and hands to an
 * agent so it can spend from — and only from — that account, inside its caps and
 * credit line. The key encodes the owner + a keyId; revocation is enforced by the
 * server tracking which keyIds are still active.
 */
const APIKEY_TTL_MS = 365 * 24 * 60 * 60_000; // keys last a year

export function issueApiKey(owner: string, ttlMs = APIKEY_TTL_MS): { apiKey: string; keyId: string; owner: string } | null {
  if (!isAddress(owner)) return null;
  const keyId = randomBytes(6).toString("hex");
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ a: owner.toLowerCase(), k: keyId, e: exp })).toString("base64url");
  // Domain-separated HMAC ("apikey:") so a key can never be confused with a session token.
  const sig = createHmac("sha256", SECRET).update("apikey:" + payload).digest("base64url");
  return { apiKey: `fmn_${payload}.${sig}`, keyId, owner: owner.toLowerCase() };
}

/** Verify an API key's signature + expiry. Returns owner + keyId (revocation is checked by the caller). */
export function verifyApiKey(key?: string | null): { owner: string; keyId: string } | null {
  if (!key || !key.startsWith("fmn_")) return null;
  const [payload, sig] = key.slice(4).split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", SECRET).update("apikey:" + payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { a: owner, k: keyId, e: exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp < Date.now()) return null;
    if (!isAddress(owner) || typeof keyId !== "string") return null;
    return { owner: String(owner).toLowerCase(), keyId };
  } catch {
    return null;
  }
}

/** True if the request carries a valid session for `user`. */
export function ownsAccount(req: http.IncomingMessage, user: string): boolean {
  const addr = verifySession(bearer(req));
  return !!addr && !!user && addr === user.toLowerCase();
}
