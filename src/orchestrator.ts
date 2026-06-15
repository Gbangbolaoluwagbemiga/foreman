import { decompose, chooseCrew } from "./brain";
import { runCrewTask, type CrewRegistry } from "./crew";
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

export interface ForemanDeps {
  registry: CrewRegistry;
  settlement: Settlement;
  foreman: AgentSigner;
  onEvent?: (msg: string) => void;
}

/**
 * The Foreman loop: plan → for each subtask hire the best affordable crew, PAY them
 * in USDC, collect the work → assemble → return an itemized receipt. Fully autonomous
 * once it has a goal and a budget.
 */
export async function runJob(job: JobRequest, deps: ForemanDeps): Promise<Receipt> {
  const { registry, settlement, foreman } = deps;
  const say = deps.onEvent ?? (() => {});

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
    const hire = chooseCrew(subtask, subtaskBudget, registry);

    if (!hire) {
      skipped.push({ skill: subtask.skill, reason: `no crew within $${subtaskBudget.toFixed(2)}` });
      say(`⚠️  Skipped ${subtask.skill}: nothing affordable within $${subtaskBudget.toFixed(2)}`);
      continue;
    }

    say(`🤝 Hiring ${hire.name} for ${subtask.skill} — $${hire.priceUsdc.toFixed(2)} (rep ${hire.reputation})`);
    const context = priorWork.length ? priorWork.join("\n\n") : undefined;
    const deliverable = await runCrewTask(hire, subtask.description, context);
    priorWork.push(`[${subtask.skill} by ${hire.name}]\n${deliverable}`);

    const payment = await settlement.pay({
      from: foreman,
      to: hire.signer.address,
      amountUsdc: hire.priceUsdc,
      memo: `${subtask.skill}: ${subtask.description.slice(0, 40)}`,
    });
    spent += hire.priceUsdc;
    registry.recordOutcome(hire.id, true);
    const updated = registry.members.find((m) => m.id === hire.id)!;
    say(`💸 Paid ${hire.name} $${hire.priceUsdc.toFixed(2)} USDC [${payment.ref}] — rep → ${updated.reputation}`);

    lineItems.push({
      crew: hire.name,
      skill: subtask.skill,
      priceUsdc: hire.priceUsdc,
      paymentRef: payment.ref,
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
    rail: settlement.rail,
    lineItems,
    skipped,
    result,
  };
}

function assemble(goal: string, items: LineItem[]): string {
  const parts = items.map((i) => `### ${i.skill} — by ${i.crew}\n${i.deliverable}`);
  return `# Deliverable for: ${goal}\n\n${parts.join("\n\n")}`;
}
