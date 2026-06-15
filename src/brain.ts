import Groq from "groq-sdk";
import { config } from "./config";
import type { CrewMember, CrewRegistry } from "./crew";

/** One unit of work the Foreman will hire a crew member to do. */
export interface Subtask {
  skill: string;
  description: string;
  budgetShare: number; // 0..1, fractions of the total budget
}

let groq: Groq | null | undefined;
function getGroq(): Groq | null {
  if (groq === undefined) groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
  return groq;
}

/**
 * The Foreman's planning step: break a goal into subtasks, each mapped to a skill
 * that exists in the marketplace. Real reasoning via Groq; deterministic fallback
 * so the demo always runs.
 */
export async function decompose(
  goal: string,
  availableSkills: string[],
): Promise<Subtask[]> {
  const client = getGroq();
  if (client) {
    const system = `You are Foreman, an AI general contractor. Break the user's goal into 2-5 subtasks.
Each subtask MUST use a skill from this list: ${availableSkills.join(", ")}.
Return ONLY JSON: {"subtasks":[{"skill":"<one of the list>","description":"<what to do>","budgetShare":<0..1>}]}
budgetShare values should sum to ~1. Order subtasks logically (e.g. research before writing).`;
    const completion = await client.chat.completions.create({
      model: config.groqModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Goal: ${goal}` },
      ],
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: "json_object" },
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    try {
      const parsed = JSON.parse(text) as { subtasks?: Subtask[] };
      const valid = (parsed.subtasks ?? []).filter((s) => availableSkills.includes(s.skill));
      if (valid.length > 0) return normalizeShares(valid);
    } catch {
      /* fall through to mock */
    }
  }
  return mockDecompose(goal, availableSkills);
}

/** Pick the best crew member for a subtask: affordable first, then highest reputation, then cheapest. */
export function chooseCrew(
  subtask: Subtask,
  budgetForSubtask: number,
  registry: CrewRegistry,
): CrewMember | null {
  const candidates = registry
    .forSkill(subtask.skill)
    .filter((m) => m.priceUsdc <= budgetForSubtask)
    .sort((a, b) => b.reputation - a.reputation || a.priceUsdc - b.priceUsdc);
  return candidates[0] ?? null;
}

function normalizeShares(subtasks: Subtask[]): Subtask[] {
  const total = subtasks.reduce((s, t) => s + (t.budgetShare > 0 ? t.budgetShare : 0), 0) || 1;
  return subtasks.map((t) => ({ ...t, budgetShare: (t.budgetShare > 0 ? t.budgetShare : 1 / subtasks.length) / total }));
}

function mockDecompose(goal: string, skills: string[]): Subtask[] {
  // Heuristic plan: research → produce → polish, using whatever skills exist.
  const order = ["research", "copywriting", "image-prompt", "proofreading"];
  const chosen = order.filter((s) => skills.includes(s));
  const picked = chosen.length > 0 ? chosen : skills.slice(0, 3);
  return normalizeShares(
    picked.map((skill) => ({
      skill,
      description: `${skill} for: ${goal}`,
      budgetShare: 1 / picked.length,
    })),
  );
}
