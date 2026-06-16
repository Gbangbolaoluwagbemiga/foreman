import { decompose, chooseCrew } from "./brain";
import { runCrewTask, type CrewMember, type CrewRegistry } from "./crew";
import type { AgentSigner } from "./signer";
import type { Settlement } from "./settlement";

export interface JobRequest {
  goal: string;
  budgetUsdc: number;
}

export interface LineItem {
  crew: string;
  skill: string;
  priceUsdc: number;
  paymentRef: string;
  reputationAfter: number;
  deliverable: string;
}

export interface Receipt {
  goal: string;
  budgetUsdc: number;
  spentUsdc: number;
  changeUsdc: number;
  rail: string;
  lineItems: LineItem[];
  skipped: { skill: string; reason: string }[];
  result: string;
}

/** Result of hiring a crew member: the work done + how it was paid for. */
export interface HireResult {
  deliverable: string;
  paymentRef: string;
  amountUsdc: number;
}

/**
 * A way to hire + pay a crew member for a task. This is the seam that lets the
 * SAME Foreman loop run on mock settlement OR real Circle Gateway nanopayments.
 */
export type Hirer = (
  member: CrewMember,
  task: string,
  context?: string,
) => Promise<HireResult>;

export interface ForemanDeps {
  registry: CrewRegistry;
  /** Local signer for the mock rail. Not needed when a custom `hire` is given. */
  foreman?: AgentSigner;
  /** Default rail: builds a mock hirer if `hire` isn't supplied. */
  settlement?: Settlement;
  /** Override the payment rail — e.g. real Circle Gateway (see gateway/hirer.ts). */
  hire?: Hirer;
  /** Label shown on the receipt. Defaults to the settlement rail. */
  rail?: string;
  onEvent?: (msg: string) => void;
}

/** Default hirer: run the work locally (Groq) and settle via the given rail. */
function mockHire(deps: { settlement: Settlement; foreman: AgentSigner }): Hirer {
  return async (member, task, context) => {
    const deliverable = await runCrewTask(member, task, context);
    const payment = await deps.settlement.pay({
      from: deps.foreman,
      to: member.walletAddress,
      amountUsdc: member.priceUsdc,
      memo: task.slice(0, 40),
    });
    return { deliverable, paymentRef: payment.ref, amountUsdc: member.priceUsdc };
  };
}

/**
 * The Foreman loop: plan → for each subtask hire the best affordable crew, PAY them
 * in USDC, collect the work → assemble → return an itemized receipt. Fully autonomous
 * once it has a goal and a budget.
 */
export async function runJob(job: JobRequest, deps: ForemanDeps): Promise<Receipt> {
  const { registry } = deps;
  const say = deps.onEvent ?? (() => {});

  const hire =
    deps.hire ??
    (deps.settlement && deps.foreman
      ? mockHire({ settlement: deps.settlement, foreman: deps.foreman })
      : (() => {
          throw new Error("runJob needs `hire`, or both `settlement` and `foreman`");
        })());
  const rail = deps.rail ?? deps.settlement?.rail ?? "custom";

  say(`🧠 Foreman planning: "${job.goal}" (budget $${job.budgetUsdc.toFixed(2)})`);
  const subtasks = await decompose(job.goal, registry.skills());
  say(`📋 Plan: ${subtasks.map((s) => s.skill).join(" → ")}`);

  const lineItems: LineItem[] = [];
  const skipped: Receipt["skipped"] = [];
  const priorWork: string[] = [];
  let spent = 0;

  // Cheapest available price per skill — used to reserve budget for later subtasks
  // so spending on an early task can't starve the ones still to come.
  const cheapest = (skill: string): number => {
    const prices = registry.forSkill(skill).map((m) => m.priceUsdc);
    return prices.length ? Math.min(...prices) : 0;
  };

  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i]!;
    const remaining = job.budgetUsdc - spent;
    // Reserve the minimum needed to still afford every later subtask.
    const reserve = subtasks.slice(i + 1).reduce((sum, s) => sum + cheapest(s.skill), 0);
    const subtaskBudget = Math.max(0, remaining - reserve);
    const chosen = chooseCrew(subtask, subtaskBudget, registry);

    if (!chosen) {
      skipped.push({ skill: subtask.skill, reason: `no crew within $${subtaskBudget.toFixed(2)}` });
      say(`⚠️  Skipped ${subtask.skill}: nothing affordable within $${subtaskBudget.toFixed(2)}`);
      continue;
    }

    say(`🤝 Hiring ${chosen.name} for ${subtask.skill} — $${chosen.priceUsdc.toFixed(2)} (rep ${chosen.reputation})`);
    const context = priorWork.length ? priorWork.join("\n\n") : undefined;
    const { deliverable, paymentRef, amountUsdc } = await hire(chosen, subtask.description, context);
    priorWork.push(`[${subtask.skill} by ${chosen.name}]\n${deliverable}`);

    spent += amountUsdc;
    // Delivery quality varies by the agent's reliability (an SLA model). Payment
    // happens regardless (x402 pay-first); reputation is the market's recourse.
    const success = Math.random() < chosen.reliability;
    registry.recordOutcome(chosen.id, success, amountUsdc);
    const updated = registry.members.find((m) => m.id === chosen.id)!;
    say(
      success
        ? `💸 Paid ${chosen.name} $${amountUsdc.toFixed(2)} USDC [${paymentRef}] — rep → ${updated.reputation}`
        : `⚠️ ${chosen.name} delivered below par — paid $${amountUsdc.toFixed(2)} [${paymentRef}] but reputation slashed → ${updated.reputation}`,
    );

    lineItems.push({
      crew: chosen.name,
      skill: subtask.skill,
      priceUsdc: amountUsdc,
      paymentRef,
      reputationAfter: updated.reputation,
      deliverable,
    });
  }

  const result = assemble(job.goal, lineItems);
  return {
    goal: job.goal,
    budgetUsdc: job.budgetUsdc,
    spentUsdc: Number(spent.toFixed(6)),
    changeUsdc: Number((job.budgetUsdc - spent).toFixed(6)),
    rail,
    lineItems,
    skipped,
    result,
  };
}

function assemble(goal: string, items: LineItem[]): string {
  const parts = items.map((i) => `### ${i.skill} — by ${i.crew}\n${i.deliverable}`);
  return `# Deliverable for: ${goal}\n\n${parts.join("\n\n")}`;
}
