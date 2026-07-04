/** Client for the Foreman engine API (src/server.ts). */
export const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8799";
export const ARCSCAN = "https://testnet.arcscan.app";

/**
 * Format a USDC amount. Prices are nano-scale (sub-cent), so a flat 2-decimals
 * would render $0.004 as "$0.00". Show 2 significant figures under $0.10, and the
 * usual 2 decimals at or above it.
 */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0.00";
  if (n > 0 && n < 0.1) return String(parseFloat(n.toPrecision(2)));
  return n.toFixed(2);
}

// ── SIWE session: proof the connected wallet owns this account ──
// Money-control actions (fund, controls, run, standing orders) send this token;
// the engine rejects them with 401 unless the token's address matches.
export interface Session {
  token: string;
  address: string;
  expiresAt: number;
}
const SESSION_KEY = "foreman_session";

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as Session | null;
    if (s && s.expiresAt > Date.now()) return s;
  } catch {
    /* ignore */
  }
  return null;
}
function notifySession() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("foreman-session"));
}
function saveSession(s: Session) {
  if (typeof window !== "undefined") localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  notifySession();
}
export function clearSession() {
  if (typeof window !== "undefined") localStorage.removeItem(SESSION_KEY);
  notifySession();
}
/** Is there a live session proving ownership of `address`? */
export function isVerified(address?: string): boolean {
  const s = loadSession();
  return !!s && !!address && s.address.toLowerCase() === address.toLowerCase();
}
function authHeader(): Record<string, string> {
  const s = loadSession();
  return s ? { Authorization: `Bearer ${s.token}` } : {};
}

/** Step 1: get the challenge message the wallet must sign. */
export const getSiweChallenge = (address: string) => get<{ nonce: string; message: string }>(`/auth/nonce?address=${address}`);
/** Step 2: submit the signature; on success the session is stored + returned. */
export async function verifySiwe(address: string, signature: string): Promise<Session> {
  const r = await fetch(`${ENGINE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, signature }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `verify failed (${r.status})`);
  const s = body as Session;
  saveSession(s);
  return s;
}

export interface Stats {
  jobs: number;
  payments: number;
  volumeUsdc: number;
  startedAt: number;
  rail: string;
  foreman: string;
  brain: string;
  creditExtended?: number;
  accounts?: number;
}
export interface CrewMember {
  name: string;
  skill: string;
  priceUsdc: number;
  reputation: number;
  trend?: number; // last reputation move (+ up / − down) — for the live ▲/▼
  jobs: number;
  address: string;
  earnedUsdc?: number;
  registered?: boolean;
  external?: boolean;
  likes?: number;
  dislikes?: number;
}

/** 👍/👎 feedback on an agent's work — moves its rating, can auto-delist it. */
export interface RateResult {
  name: string;
  skill: string;
  reputation: number;
  delisted: boolean;
  likes: number;
  dislikes: number;
}
export async function rateAgent(agent: string, vote: "like" | "dislike"): Promise<RateResult> {
  const r = await fetch(`${ENGINE}/crew/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, vote }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `rate failed (${r.status})`);
  return body.agent as RateResult;
}

export interface RegisterInput {
  name: string;
  skill: string;
  priceUsdc: number;
  walletAddress: string;
  systemPrompt?: string;
  endpointUrl?: string;
}

/** Thrown when an agent fails the audition — carries the sample so the UI can show it. */
export class AuditionError extends Error {
  sample?: string;
  constructor(message: string, sample?: string) {
    super(message);
    this.name = "AuditionError";
    this.sample = sample;
  }
}

export async function registerAgent(input: RegisterInput) {
  const r = await fetch(`${ENGINE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    // 422 = failed the audition; the body carries a sample of what the agent produced.
    if (r.status === 422) throw new AuditionError(body.error ?? "audition failed", body.sample);
    throw new Error(body.error ?? `register failed (${r.status})`);
  }
  return {
    ...(body.agent as { id: string; name: string; skill: string; priceUsdc: number; walletAddress: string; auditScore?: number }),
    status: body.status as "pending" | "approved",
  };
}

// ── Admin moderation: curate the marketplace (approve/reject/delete pending agents).
export interface AdminAgent {
  id: string;
  name: string;
  skill: string;
  priceUsdc: number;
  walletAddress: string;
  reputation: number;
  jobs: number;
  earnedUsdc: number;
  registered: boolean;
  external: boolean;
  delisted: boolean;
  status: "pending" | "approved";
  systemPrompt?: string;
  audit: { score: number; reason: string; sample: string; at: number } | null;
  live: boolean;
}
export type AdminAction = "approve" | "reject" | "delete" | "delist" | "relist" | "reaudition";

export async function getAdminStatus(): Promise<{ configured: boolean; admin: boolean }> {
  const r = await fetch(`${ENGINE}/admin/status`, { cache: "no-store", headers: { ...authHeader() } });
  if (!r.ok) return { configured: false, admin: false };
  return r.json();
}

export async function getAdminAgents(): Promise<{ agents: AdminAgent[]; autoApproveScore: number }> {
  const r = await fetch(`${ENGINE}/admin/agents`, { cache: "no-store", headers: { ...authHeader() } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `could not load agents (${r.status})`);
  return { agents: body.agents ?? [], autoApproveScore: body.autoApproveScore ?? 82 };
}

export async function adminAgentAction(id: string, action: AdminAction): Promise<AdminAgent[]> {
  const r = await fetch(`${ENGINE}/admin/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ id, action }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `action failed (${r.status})`);
  return body.agents ?? [];
}
export interface LedgerItem {
  ts: number;
  crew: string;
  skill: string;
  amountUsdc: number;
  ref: string;
  recipient?: string;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${ENGINE}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`engine ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export interface ForemanInfo {
  address: string;
  rail: string;
  walletUsdc: string | null;
  gatewayAvailable: string | null;
}
export const getForeman = () => get<ForemanInfo>("/foreman");

export async function withdrawForeman(amount: string) {
  const r = await fetch(`${ENGINE}/foreman/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `withdraw failed (${r.status})`);
  return body as { ok: boolean; withdrew: string };
}

export const getStats = () => get<Stats>("/stats");
export const getCrew = () => get<{ members: CrewMember[] }>("/crew").then((d) => d.members);
export const getActivity = () => get<{ ledger: LedgerItem[] }>("/activity").then((d) => d.ledger);

export function runJob(goal: string, budget: number, user?: string) {
  return fetch(`${ENGINE}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ goal, budget, user }),
  });
}

export interface Account {
  user: string;
  deposited: number;
  spent: number;
  balance: number;
  owed: number;
  creditLimit: number;
  creditAvailable: number;
  spendable: number;
  creditScore?: number;
  creditRate?: number;
  creditBand?: string;
  jobsCount?: number;
  repayments?: number;
  repaidTotal?: number;
  suspended?: boolean;
  perJobCap?: number;
  dailyCap?: number;
  spentToday?: number;
}
export const getAccount = (user: string) => get<Account>(`/account?user=${user}`);

/** A settled payment's live Circle Gateway record — the on-chain proof. */
export interface TransferProof {
  id: string;
  status: string;
  from: string;
  to: string;
  amountUsdc: number;
  createdAt: string;
  updatedAt: string;
  explorer: string;
}
/** A payment ref is a real Circle transfer if it's a UUID (vs the gw:/mock fallbacks). */
export const isTransferId = (ref: string) => /^[0-9a-f-]{36}$/i.test(ref);
export const verifyTransfer = (id: string) => get<TransferProof>(`/transfer?id=${id}`);

// ── Portable credit attestation: an EIP-712-signed statement of a wallet's score
// that anyone can verify offline against the published attester address — the score
// as an independently-verifiable primitive, not a "trust our server" lookup.
export interface CreditAttestation {
  attester: `0x${string}`;
  signature: `0x${string}`;
  attestation: { subject: string; score: number; creditLimit: number; band: string; issuedAt: number; expiry: number };
  eip712: {
    domain: { name: string; version: string; chainId: number };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, string>;
  };
}
export const getCreditAttestation = (user: string) => get<CreditAttestation>(`/credit/attestation?user=${user}`);

/** Verify an attestation's EIP-712 signature in the browser — zero trust in the engine. */
export async function verifyCreditAttestation(a: CreditAttestation): Promise<boolean> {
  try {
    const { verifyTypedData } = await import("viem");
    // Cast the whole options object: viem's generic infers field types from `types`,
    // which we only know at runtime — the signature check itself is fully dynamic.
    return await verifyTypedData({
      address: a.attester,
      domain: a.eip712.domain,
      types: a.eip712.types,
      primaryType: a.eip712.primaryType,
      message: a.eip712.message,
      signature: a.signature,
    } as Parameters<typeof verifyTypedData>[0]);
  } catch {
    return false;
  }
}

// ── Agent API keys: credentials the owner mints so a headless agent (MCP / API)
// can spend from this account, inside its caps + credit. Managing keys requires
// the SIWE session (authHeader).
export interface ApiKeyMeta {
  id: string;
  createdAt: number;
  label?: string;
}
export async function listApiKeys(user: string): Promise<ApiKeyMeta[]> {
  // The list is owner-only, so this must carry the SIWE session — plain get() doesn't.
  const r = await fetch(`${ENGINE}/account/apikeys?user=${user}`, {
    cache: "no-store",
    headers: { ...authHeader() },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `could not list keys (${r.status})`);
  return body.keys ?? [];
}

/** Mint a key. The full secret is returned exactly once — copy it immediately. */
export async function createApiKey(user: string, label?: string): Promise<{ apiKey: string; keyId: string }> {
  const r = await fetch(`${ENGINE}/account/apikey`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ user, label }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `could not mint key (${r.status})`);
  return body;
}

export async function revokeApiKey(user: string, keyId: string): Promise<ApiKeyMeta[]> {
  const r = await fetch(`${ENGINE}/account/apikey/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ user, keyId }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `could not revoke (${r.status})`);
  return body.keys ?? [];
}

export async function setControls(
  user: string,
  controls: { suspended?: boolean; perJobCap?: number; dailyCap?: number },
): Promise<Account> {
  const r = await fetch(`${ENGINE}/account/controls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ user, ...controls }),
  });
  return r.json();
}

export interface HistoryJob {
  ts: number;
  goal: string;
  budgetUsdc: number;
  spentUsdc: number;
  changeUsdc: number;
  rail: string;
  lineItems: { crew: string; skill: string; priceUsdc: number; paymentRef: string; recipient?: string; deliverable: string }[];
  result: string;
}
export const getHistory = (user: string) => get<{ jobs: HistoryJob[] }>(`/history?user=${user}`).then((d) => d.jobs);

export async function reportDeposit(user: string, amount: number): Promise<Account> {
  const r = await fetch(`${ENGINE}/account/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ user, amount }),
  });
  return r.json();
}

// ── Standing orders: autonomous recurring jobs funded by the card ──
export interface StandingOrder {
  id: string;
  user: string;
  goal: string;
  budget: number;
  everyMinutes: number;
  active: boolean;
  createdAt: number;
  lastRunAt: number;
  runs: number;
  totalSpent: number;
  lastNote?: string;
}
export const getOrders = (user: string) => get<{ orders: StandingOrder[] }>(`/orders?user=${user}`).then((d) => d.orders);

async function postOrder<T>(path: string, payload: unknown): Promise<T> {
  const r = await fetch(`${ENGINE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `request failed (${r.status})`);
  return body as T;
}
export const createOrder = (user: string, goal: string, budget: number, everyMinutes: number) =>
  postOrder<{ order: StandingOrder }>("/orders", { user, goal, budget, everyMinutes }).then((d) => d.order);
export const toggleOrder = (user: string, id: string) =>
  postOrder<{ orders: StandingOrder[] }>("/orders/toggle", { user, id }).then((d) => d.orders);
export const deleteOrder = (user: string, id: string) =>
  postOrder<{ orders: StandingOrder[] }>("/orders/delete", { user, id }).then((d) => d.orders);

export function paymentsPerMin(s: Stats): string {
  const mins = (Date.now() - s.startedAt) / 60000;
  return mins > 0.05 ? (s.payments / mins).toFixed(1) : "—";
}
