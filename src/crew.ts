import Groq from "groq-sdk";
import { config } from "./config";
import { createLocalSigner } from "./signer";

/**
 * A crew member is a specialist agent that sells ONE skill, per task, for a fixed
 * USDC price. `walletAddress` is where its earnings settle. Members can be:
 *   - seeded (our starter crew),
 *   - registered + hosted (a system prompt we run on Groq, paid to their wallet),
 *   - registered + external (their own x402 endpoint — we pay it directly).
 */
export interface CrewMember {
  id: string;
  name: string;
  skill: string;
  description: string;
  priceUsdc: number;
  walletAddress: `0x${string}`;
  reputation: number; // 0..100, a moving average of delivery quality
  reliability: number; // 0..1 intrinsic quality/SLA — drives reputation over time
  jobsCompleted: number;
  earnedUsdc: number;
  systemPrompt: string;
  endpointUrl?: string; // bring-your-own x402 seller
  registered?: boolean;
  delisted?: boolean; // reputation fell below the bar — hidden from hiring + marketplace
  likes?: number;
  dislikes?: number;
}

/** Intrinsic reliability per seeded agent — reputation converges here over time. */
const RELIABILITY: Record<string, number> = {
  Codex: 0.95, Quill: 0.94, Polish: 0.92, Scout: 0.9, Muse: 0.82,
};

type Seed = Pick<CrewMember, "name" | "skill" | "description" | "priceUsdc" | "reputation" | "systemPrompt">;

// Five broad specialists — each a distinct skill, no overlap. Related capabilities
// are folded in (fact-checking → research, SEO → copywriting, code review → coding,
// summarizing → editing) so the Foreman hires fewer, more capable agents.
const SEED_CREW: Seed[] = [
  { name: "Scout", skill: "research", priceUsdc: 0.02, reputation: 72,
    description: "Researches any topic and sanity-checks the facts.",
    systemPrompt: "You are Scout, a fast research + fact-check specialist. Return concise, concrete findings: 2-4 key facts, and flag any dubious claim with a one-line plausibility note. No fluff." },
  { name: "Quill", skill: "copywriting", priceUsdc: 0.1, reputation: 81,
    description: "Writes punchy marketing copy, optimized for search.",
    systemPrompt: "You are Quill, an expert copywriter with SEO instincts. Produce vivid, concise, on-brand copy for the task; when relevant, weave in natural keywords and suggest a title/meta line. No preamble." },
  { name: "Codex", skill: "coding", priceUsdc: 0.08, reputation: 80,
    description: "Writes clean, correct code — and reviews it for bugs.",
    systemPrompt: "You are Codex, an expert programmer and reviewer. If asked to write code, output exactly what's asked in a fenced block (minimal, correct). If asked to review, list concrete issues and fixes succinctly. No tutorials, no padding." },
  { name: "Polish", skill: "editing", priceUsdc: 0.02, reputation: 78,
    description: "Proofreads, tightens, and summarizes text.",
    systemPrompt: "You are Polish, a meticulous editor. Proofread for grammar, flow, and clarity without changing meaning; if asked to summarize, return the tightest faithful summary. Return only the edited/summarized text." },
  { name: "Muse", skill: "image-prompt", priceUsdc: 0.04, reputation: 64,
    description: "Generates a header/hero image for the brief.",
    systemPrompt: "You are Muse, an art director. Reply with ONLY a vivid visual description of the image to generate — concrete subject, setting, style, lighting, mood. One sentence, no preamble, no quotes, and do NOT restate or mention the task/brief." },
];

let groqClient: Groq | null | undefined;
function getGroq(): Groq | null {
  if (groqClient === undefined) groqClient = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
  return groqClient;
}
export const usingRealBrain = () => getGroq() !== null;

export interface GroqOpts {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

/**
 * Run a chat completion, automatically falling back to the secondary model when
 * the primary is rate-limited (it has a separate daily quota). Returns null if
 * every model is unavailable, so callers can degrade gracefully.
 */
export async function groqComplete(
  messages: { role: "system" | "user"; content: string }[],
  opts: GroqOpts = {},
): Promise<string | null> {
  const groq = getGroq();
  if (!groq) return null;
  const models = [...new Set([config.groqModel, config.groqFallbackModel].filter(Boolean))];
  for (const model of models) {
    try {
      const c = await groq.chat.completions.create({
        model,
        messages,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 400,
        ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      const t = c.choices[0]?.message?.content?.trim();
      if (t) return t;
    } catch (err) {
      const msg = (err instanceof Error ? err.message.split("\n")[0] : "unknown") ?? "unknown";
      console.warn(`  [groq] ${model} unavailable — ${msg.slice(0, 80)}`);
      // fall through to the next model
    }
  }
  return null;
}

export interface RegisterInput {
  name: string;
  skill: string;
  priceUsdc: number;
  walletAddress: string;
  systemPrompt?: string;
  endpointUrl?: string;
}

export class CrewRegistry {
  readonly members: CrewMember[];

  constructor(members: CrewMember[]) {
    this.members = members;
  }

  static seeded(): CrewRegistry {
    const members = SEED_CREW.map((s, i) => ({
      ...s,
      id: `crew-${i + 1}`,
      walletAddress: createLocalSigner().address,
      reliability: RELIABILITY[s.name] ?? 0.9,
      jobsCompleted: 0,
      earnedUsdc: 0,
    }));
    return new CrewRegistry(members);
  }

  /** Add an externally-registered agent. Returns the created member. */
  register(input: RegisterInput, opts: { reputationSeed?: number } = {}): CrewMember {
    // New agents enter UNPROVEN — below the established crew (rep 63–85) — and
    // must earn their rank through delivery. A strong audition lifts the start a
    // little; it never lets a newcomer leapfrog a proven specialist.
    const seed = opts.reputationSeed;
    const startRep = seed !== undefined ? Math.max(40, Math.min(62, Math.round(40 + (seed - 50) * 0.6))) : 50;
    const m: CrewMember = {
      id: `reg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      name: input.name.slice(0, 32),
      skill: input.skill.trim().toLowerCase(),
      description: (input.systemPrompt ?? `External ${input.skill} agent`).slice(0, 90),
      priceUsdc: Math.max(0.001, input.priceUsdc),
      walletAddress: input.walletAddress as `0x${string}`,
      reputation: startRep,
      reliability: 0.9, // newcomers start optimistic; the market learns the truth
      jobsCompleted: 0,
      earnedUsdc: 0,
      systemPrompt: input.systemPrompt ?? `You are a helpful ${input.skill} specialist. Be concise and concrete.`,
      endpointUrl: input.endpointUrl?.trim() || undefined,
      registered: true,
    };
    this.members.push(m);
    return m;
  }

  skills(): string[] {
    return [...new Set(this.members.filter((m) => !m.delisted).map((m) => m.skill))];
  }
  forSkill(skill: string): CrewMember[] {
    return this.members.filter((m) => m.skill === skill && !m.delisted);
  }
  /** Is a skill already served by a live agent? (Used to enforce skill uniqueness.) */
  hasSkill(skill: string): boolean {
    return this.members.some((m) => m.skill === skill.trim().toLowerCase() && !m.delisted);
  }
  byId(id: string): CrewMember | undefined {
    return this.members.find((m) => m.id === id || m.name.toLowerCase() === id.toLowerCase());
  }

  recordOutcome(id: string, success: boolean, amountUsdc = 0): void {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    m.jobsCompleted += 1;
    // Reputation = exponential moving average of delivery quality. Converges to the
    // agent's true reliability and visibly dips when a delivery comes in below par.
    m.reputation = Math.round(m.reputation * 0.8 + (success ? 100 : 0) * 0.2);
    // Paid via x402 regardless (pay-first) — at nano scale, reputation is the recourse.
    m.earnedUsdc = Number((m.earnedUsdc + amountUsdc).toFixed(6));
    if (m.reputation < 50) m.delisted = true;
  }

  /**
   * User feedback: a 👍 lifts the agent's rating, a 👎 lowers it (EWMA so one vote
   * nudges, a few move the needle). Drop below 50 → auto-delisted, which frees the
   * skill for a better agent to claim. Returns the updated member.
   */
  rate(identifier: string, vote: "like" | "dislike"): CrewMember | undefined {
    const key = identifier.trim().toLowerCase();
    const m = this.members.find(
      (x) => !x.delisted && (x.id === identifier || x.name.toLowerCase() === key || x.skill === key),
    );
    if (!m) return undefined;
    if (vote === "like") {
      m.likes = (m.likes ?? 0) + 1;
      m.reputation = Math.round(m.reputation * 0.9 + 100 * 0.1);
    } else {
      m.dislikes = (m.dislikes ?? 0) + 1;
      m.reputation = Math.round(m.reputation * 0.9);
    }
    if (m.reputation < 50) m.delisted = true;
    return m;
  }
}

/** Run a crew member's skill — real Groq if configured, else a graceful offline deliverable. */
export async function runCrewTask(member: CrewMember, task: string, context?: string): Promise<string> {
  const fallback = `[${member.name}·${member.skill}] ${task}${context ? " (built on prior crew's work)" : ""} → delivered (offline).`;
  const userContent = context
    ? `${task}\n\n--- Work already delivered by earlier crew (use this as your input) ---\n${context}`
    : task;
  const out = await groqComplete(
    [
      { role: "system", content: member.systemPrompt },
      { role: "user", content: userContent },
    ],
    { maxTokens: 400 },
  );
  return withImage(member.skill, out || fallback, task);
}

/**
 * AUDITION a hosted agent before it can be listed: run its system prompt against
 * a sample task and judge the output. This is the quality gate that keeps the
 * marketplace from filling with rubbish or copy-paste clones. Returns a pass/fail
 * plus a score we use to seed the agent's starting reputation (so a strong agent
 * enters higher, a weak-but-passing one enters on probation).
 */
export interface Audition {
  pass: boolean;
  score: number; // 0..100
  reason: string;
  sample: string;
}
export async function auditionHostedAgent(skill: string, systemPrompt: string): Promise<Audition> {
  const probe = `Sample assignment to verify your specialty. Topic: "a new neighbourhood coffee shop launching next month". Produce your best, concise ${skill} output for this — do the task, don't describe it.`;
  const output = await groqComplete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: probe },
    ],
    { maxTokens: 300 },
  );

  // Planner offline (no Groq key / rate-limited): don't block — admit on probation.
  if (!output) return { pass: true, score: 45, reason: "audition skipped (planner offline) — admitted on probation", sample: "" };

  const sample = output.slice(0, 400);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  // Heuristic rejections — the obvious rubbish.
  if (norm(output).length < 25) return { pass: false, score: 0, reason: "output too short to be useful", sample };
  if (norm(output).includes(norm(systemPrompt).slice(0, 40)) && norm(systemPrompt).length > 40)
    return { pass: false, score: 0, reason: "agent echoed its instructions instead of doing the task", sample };
  if (/\b(i cannot|i can't|as an ai|i'm unable|i am unable)\b/i.test(output))
    return { pass: false, score: 0, reason: "agent refused the sample task", sample };

  // Best-effort LLM judge — strict auditor scores the work.
  const verdict = await groqComplete(
    [
      { role: "system", content: 'You are a strict quality auditor for an AI agent marketplace. Score 0-100 whether the OUTPUT is a competent, specific, non-generic response that actually performs the stated SKILL (not a refusal, not echoing instructions). Return JSON {"score": <number>, "reason": "<short>"}.' },
      { role: "user", content: `SKILL: ${skill}\nTASK: ${probe}\n\nOUTPUT:\n${output}` },
    ],
    { json: true, maxTokens: 120, temperature: 0 },
  );
  let score = 55;
  let reason = "passed heuristic checks";
  if (verdict) {
    try {
      const j = JSON.parse(verdict);
      if (Number.isFinite(Number(j.score))) {
        score = Math.max(0, Math.min(100, Math.round(Number(j.score))));
        reason = String(j.reason ?? reason).slice(0, 120);
      }
    } catch {
      /* keep heuristic default */
    }
  }
  // Admission bar: a competent agent clears 50.
  if (score < 50) return { pass: false, score, reason: `quality below the bar: ${reason}`, sample };
  return { pass: true, score, reason, sample };
}

/** The image crew GENERATES a real image (Pollinations — free, keyless). */
function withImage(skill: string, text: string, task: string): string {
  if (skill !== "image-prompt" && skill !== "image") return text;
  const offline = !text || /delivered \(offline\)/.test(text) || text.length < 15;
  // Build a clean VISUAL prompt — never the meta-instruction (which produced nonsense).
  let prompt = offline
    ? task
        .replace(/^.*?for:\s*/i, "")
        .replace(/\b(write|develop|create|design|generate|produce|a concept for|that captures.*|appeals to.*|header image|image[- ]?prompt|the essence of)\b/gi, " ")
        .replace(/[—–-]\s*(research|copy|copywriting|seo)\b/gi, " ")
    : text.replace(/^here'?s?\b[^:]*:\s*/i, "").replace(/image[- ]?generation prompt:?/i, "");
  prompt = (prompt || task).replace(/["\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
  const styled = `${prompt}, professional marketing header image, photographic, warm natural lighting, high detail`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=1024&height=576&nologo=true`;
  const caption = offline ? `Header image concept — ${prompt}` : text;
  return `${caption}\n\n![generated image](${url})`;
}
