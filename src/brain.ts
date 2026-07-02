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
  const system = `You are Foreman, an AI general contractor. Choose the SMALLEST set of specialists that genuinely satisfies the goal. Hire multiple agents ONLY when the goal truly spans several distinct deliverables.

Skills available: ${availableSkills.join(", ")}. Each subtask must use the closest-matching skill.

Examples (note how simple asks use exactly ONE agent):
- "write a hello world in C" → {"subtasks":[{"skill":"coding","description":"Write a hello world program in C","budgetShare":1}]}
- "translate this to French: ..." → {"subtasks":[{"skill":"translation","description":"Translate to French","budgetShare":1}]}
- "a catchy tagline for my coffee app" → {"subtasks":[{"skill":"copywriting","description":"Write a catchy tagline","budgetShare":1}]}
- "review this function for bugs" → {"subtasks":[{"skill":"coding","description":"Review the code for bugs","budgetShare":1}]}
- "a full launch campaign: market research, copy, and a header image" → {"subtasks":[{"skill":"research","description":"Research the market","budgetShare":0.3},{"skill":"copywriting","description":"Write the campaign copy","budgetShare":0.4},{"skill":"image-prompt","description":"Design a header image","budgetShare":0.3}]}

Rules:
- A simple, single-domain request = exactly ONE agent. Do NOT add research, editing, or images unless the goal explicitly needs them.
- Never pad the plan. Fewer agents is better.
Return ONLY JSON: {"subtasks":[{"skill","description","budgetShare"}]}. budgetShare sums to ~1.`;
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
      if (valid.length > 0) return normalizeShares(dedupeBySkill(valid));
    } catch {
      // bad JSON — fall back to the heuristic plan
    }
  }
  return mockDecompose(goal, availableSkills);
}

/**
 * One skill = one hire per job. If the planner returns the same skill twice
 * ("coding → coding"), collapse them: keep the first description and merge the
 * budget shares. A single coding task is done by ONE coder, not two.
 */
function dedupeBySkill(subtasks: Subtask[]): Subtask[] {
  const bySkill = new Map<string, Subtask>();
  for (const s of subtasks) {
    const existing = bySkill.get(s.skill);
    if (existing) existing.budgetShare += s.budgetShare > 0 ? s.budgetShare : 0;
    else bySkill.set(s.skill, { ...s });
  }
  return [...bySkill.values()];
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
    "hello world": "coding", html: "coding", css: "coding", sql: "coding", algorithm: "coding", snippet: "coding",
    bug: "coding", review: "coding", refactor: "coding", debug: "coding",
    copy: "copywriting", tagline: "copywriting", slogan: "copywriting", headline: "copywriting",
    campaign: "copywriting", blog: "copywriting", tweet: "copywriting", email: "copywriting", caption: "copywriting",
    seo: "copywriting", keywords: "copywriting",
    summarize: "editing", summary: "editing", proofread: "editing", edit: "editing", grammar: "editing",
    "fact-check": "research", "fact check": "research", verify: "research", sources: "research",
    image: "image-prompt", logo: "image-prompt", banner: "image-prompt", picture: "image-prompt",
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
