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
}

/** Intrinsic reliability per seeded agent — reputation converges here over time. */
const RELIABILITY: Record<string, number> = {
  Lint: 0.96, Quill: 0.94, Polish: 0.92, Scout: 0.9, Digest: 0.86, Verify: 0.88, Rank: 0.85, Muse: 0.82,
};

type Seed = Pick<CrewMember, "name" | "skill" | "description" | "priceUsdc" | "reputation" | "systemPrompt">;

const SEED_CREW: Seed[] = [
  { name: "Scout", skill: "research", priceUsdc: 0.05, reputation: 72,
    description: "Gathers facts, sources, and background on any topic.",
    systemPrompt: "You are Scout, a fast research specialist. Return concise, concrete findings and 2-4 key facts. No fluff." },
  { name: "Quill", skill: "copywriting", priceUsdc: 0.3, reputation: 81,
    description: "Writes punchy marketing and editorial copy.",
    systemPrompt: "You are Quill, an expert copywriter. Produce vivid, concise, on-brand copy for the task. No preamble." },
  { name: "Muse", skill: "image-prompt", priceUsdc: 0.1, reputation: 64,
    description: "Generates a header/hero image for the brief.",
    systemPrompt: "You are Muse, an art director. Reply with ONLY a vivid visual description of the image to generate — concrete subject, setting, style, lighting, mood. One sentence, no preamble, no quotes, and do NOT restate or mention the task/brief." },
  { name: "Polish", skill: "proofreading", priceUsdc: 0.03, reputation: 78,
    description: "Fixes grammar, flow, and clarity without changing meaning.",
    systemPrompt: "You are Polish, a meticulous proofreader. Return the corrected text only — fix grammar, flow, clarity; keep meaning." },
  { name: "Digest", skill: "summarization", priceUsdc: 0.04, reputation: 66,
    description: "Condenses long content into tight summaries.",
    systemPrompt: "You are Digest. Summarize the input into the tightest faithful summary possible." },
  { name: "Verify", skill: "fact-check", priceUsdc: 0.05, reputation: 69,
    description: "Flags dubious claims and checks plausibility.",
    systemPrompt: "You are Verify, a fact-checker. List each claim with a plausibility verdict and a one-line reason." },
  { name: "Lint", skill: "code-review", priceUsdc: 0.2, reputation: 85,
    description: "Reviews code for bugs and clarity.",
    systemPrompt: "You are Lint, a senior code reviewer. Identify concrete issues and suggest fixes succinctly." },
  { name: "Rank", skill: "seo", priceUsdc: 0.07, reputation: 63,
    description: "Optimizes copy for search with keywords and meta.",
    systemPrompt: "You are Rank, an SEO specialist. Suggest a title tag, meta description, and 5 target keywords for the task." },
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
  register(input: RegisterInput): CrewMember {
    const m: CrewMember = {
      id: `reg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      name: input.name.slice(0, 32),
      skill: input.skill.trim().toLowerCase(),
      description: (input.systemPrompt ?? `External ${input.skill} agent`).slice(0, 90),
      priceUsdc: Math.max(0.001, input.priceUsdc),
      walletAddress: input.walletAddress as `0x${string}`,
      reputation: 60,
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
    return [...new Set(this.members.map((m) => m.skill))];
  }
  forSkill(skill: string): CrewMember[] {
    return this.members.filter((m) => m.skill === skill);
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
