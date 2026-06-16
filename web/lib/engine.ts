/** Client for the Foreman engine API (src/server.ts). */
export const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8799";
export const ARCSCAN = "https://testnet.arcscan.app";

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
  jobs: number;
  address: string;
  earnedUsdc?: number;
  registered?: boolean;
  external?: boolean;
}

export interface RegisterInput {
  name: string;
  skill: string;
  priceUsdc: number;
  walletAddress: string;
  systemPrompt?: string;
  endpointUrl?: string;
}

export async function registerAgent(input: RegisterInput) {
  const r = await fetch(`${ENGINE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `register failed (${r.status})`);
  return body.agent as { id: string; name: string; skill: string; priceUsdc: number; walletAddress: string };
}
export interface LedgerItem {
  ts: number;
  crew: string;
  skill: string;
  amountUsdc: number;
  ref: string;
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
    headers: { "Content-Type": "application/json" },
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
  suspended?: boolean;
  perJobCap?: number;
  dailyCap?: number;
  spentToday?: number;
}
export const getAccount = (user: string) => get<Account>(`/account?user=${user}`);

export async function setControls(
  user: string,
  controls: { suspended?: boolean; perJobCap?: number; dailyCap?: number },
): Promise<Account> {
  const r = await fetch(`${ENGINE}/account/controls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  lineItems: { crew: string; skill: string; priceUsdc: number; paymentRef: string; deliverable: string }[];
  result: string;
}
export const getHistory = (user: string) => get<{ jobs: HistoryJob[] }>(`/history?user=${user}`).then((d) => d.jobs);

export async function reportDeposit(user: string, amount: number): Promise<Account> {
  const r = await fetch(`${ENGINE}/account/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, amount }),
  });
  return r.json();
}

export function paymentsPerMin(s: Stats): string {
  const mins = (Date.now() - s.startedAt) / 60000;
  return mins > 0.05 ? (s.payments / mins).toFixed(1) : "—";
}
