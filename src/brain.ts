import { groqComplete, type CrewMember, type CrewRegistry } from "./crew";

/** One unit of work the Foreman will hire a crew member to do. */
export interface Subtask {
  skill: string;
  description: string;
  budgetShare: number; // 0..1, fractions of the total budget
}

/**
 * The Foreman's planning step: break a goal into subtasks, each mapped to a skill
 * that exists in the marketplace. Real reasoning via Groq (with model fallback);
 * deterministic heuristic if every model is unavailable, so the demo always runs.
 */
export async function decompose(
  goal: string,
  availableSkills: string[],
): Promise<Subtask[]> {
  const system = `You are Foreman, an AI general contractor. Hire the FEWEST specialists that genuinely satisfy the goal — often exactly ONE.
Rules:
- Match the request precisely. A simple ask ("a line of code", "translate this", "a tagline") needs ONE subtask.
- Do NOT add research, SEO, proofreading, fact-check, or images UNLESS the goal clearly calls for them.
- Never pad the plan to use more agents. Less is better.
- Each subtask MUST use a skill from this list: ${availableSkills.join(", ")}. Pick the closest-matching skill.
Return ONLY JSON: {"subtasks":[{"skill":"<one of the list>","description":"<what to do>","budgetShare":<0..1>}]}
Use 1-4 subtasks (prefer 1-2). budgetShare values sum to ~1.`;
  const text = await groqComplete(
    [
      { role: "system", content: system },
      { role: "user", content: `Goal: ${goal}` },
    ],
    { temperature: 0.4, maxTokens: 400, json: true },
  );
  if (text) {
    try {
      const parsed = JSON.parse(text) as { subtasks?: Subtask[] };
      const valid = (parsed.subtasks ?? []).filter((s) => availableSkills.includes(s.skill));
      if (valid.length > 0) return normalizeShares(valid);
    } catch {
      // bad JSON — fall back to the heuristic plan
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
  if (candidates.length === 0) return null;
  // Mostly hire the best, but explore ~20% of the time so newcomers and registered
  // agents get discovered — that's how a real market forms (and solves cold-start).
  if (candidates.length > 1 && Math.random() < 0.2) {
    return candidates[Math.floor(Math.random() * candidates.length)]!;
  }
  return candidates[0]!;
}

function normalizeShares(subtasks: Subtask[]): Subtask[] {
  const total = subtasks.reduce((s, t) => s + (t.budgetShare > 0 ? t.budgetShare : 0), 0) || 1;
  return subtasks.map((t) => ({ ...t, budgetShare: (t.budgetShare > 0 ? t.budgetShare : 1 / subtasks.length) / total }));
}

function mockDecompose(goal: string, skills: string[]): Subtask[] {
  const g = goal.toLowerCase();
  // Map common keywords → the right skill so the offline planner is still smart.
  const KEYWORDS: Record<string, string> = {
    code: "coding", coding: "coding", function: "coding", script: "coding", program: "coding",
    rust: "coding", python: "coding", javascript: "coding", typescript: "coding", solidity: "coding",
    translate: "translation", summarize: "summarization", summary: "summarization",
    image: "image-prompt", logo: "image-prompt", banner: "image-prompt",
    seo: "seo", proofread: "proofreading", "fact-check": "fact-check", review: "code-review",
  };
  const named = skills.filter((s) => g.includes(s.replace(/-/g, " ")) || g.includes(s));
  const fromKeywords = Object.entries(KEYWORDS).filter(([k]) => g.includes(k)).map(([, v]) => v);
  const wanted = [...new Set([...named, ...fromKeywords])].filter((s) => skills.includes(s));
  // Otherwise hire a single sensible default — keep it minimal, don't pad.
  const fallback = skills.includes("copywriting") ? ["copywriting"] : skills.slice(0, 1);
  const picked = (wanted.length ? wanted : fallback).slice(0, 4);
  return normalizeShares(
    picked.map((skill) => ({ skill, description: `${skill} for: ${goal}`, budgetShare: 1 / picked.length })),
  );
}
