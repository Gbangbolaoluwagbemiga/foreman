import Groq from "groq-sdk";
import { config } from "./config";
import { createLocalSigner, type AgentSigner } from "./signer";

/**
 * A crew member is a specialist agent that sells ONE skill, per task, for a fixed
 * USDC price. Under the hood it's just a Groq system prompt + a wallet — which is
 * exactly why the marketplace is cheap to seed: one template → twenty specialists.
 */
export interface CrewMember {
  id: string;
  name: string;
  skill: string;
  description: string;
  priceUsdc: number;
  signer: AgentSigner;
  reputation: number; // 0..100
  jobsCompleted: number;
  systemPrompt: string;
}

type Seed = Omit<CrewMember, "signer" | "id" | "jobsCompleted"> & { jobsCompleted?: number };

/** The starter crew we deploy ourselves so the marketplace is alive on day one. */
const SEED_CREW: Seed[] = [
  { name: "Scout", skill: "research", priceUsdc: 0.05, reputation: 72,
    description: "Gathers facts, sources, and background on any topic.",
    systemPrompt: "You are Scout, a fast research specialist. Given a task, return concise, concrete findings and 2-4 key facts. No fluff." },
  { name: "Quill", skill: "copywriting", priceUsdc: 0.30, reputation: 81,
    description: "Writes punchy marketing and editorial copy.",
    systemPrompt: "You are Quill, an expert copywriter. Produce vivid, concise, on-brand copy for the task. No preamble." },
  { name: "Muse", skill: "image-prompt", priceUsdc: 0.10, reputation: 64,
    description: "Designs detailed prompts for image-generation models.",
    systemPrompt: "You are Muse. Output one rich, specific image-generation prompt (style, subject, lighting, mood, aspect)." },
  { name: "Polish", skill: "proofreading", priceUsdc: 0.03, reputation: 78,
    description: "Fixes grammar, flow, and clarity without changing meaning.",
    systemPrompt: "You are Polish, a meticulous proofreader. Return the corrected text only — fix grammar, flow, clarity; keep meaning." },
  { name: "Digest", skill: "summarization", priceUsdc: 0.04, reputation: 66,
    description: "Condenses long content into tight summaries.",
    systemPrompt: "You are Digest. Summarize the input into the tightest faithful summary possible." },
  { name: "Verify", skill: "fact-check", priceUsdc: 0.05, reputation: 69,
    description: "Flags dubious claims and checks plausibility.",
    systemPrompt: "You are Verify, a fact-checker. List each claim with a plausibility verdict and a one-line reason." },
  { name: "Lint", skill: "code-review", priceUsdc: 0.20, reputation: 85,
    description: "Reviews code for bugs and clarity.",
    systemPrompt: "You are Lint, a senior code reviewer. Identify concrete issues and suggest fixes succinctly." },
  { name: "Rank", skill: "seo", priceUsdc: 0.07, reputation: 63,
    description: "Optimizes copy for search with keywords and meta.",
    systemPrompt: "You are Rank, an SEO specialist. Suggest a title tag, meta description, and 5 target keywords for the task." },
];

let groqClient: Groq | null | undefined;
function getGroq(): Groq | null {
  if (groqClient === undefined) {
    groqClient = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
  }
  return groqClient;
}

/** Whether the real brain is available, or we're in deterministic mock mode. */
export const usingRealBrain = () => getGroq() !== null;

export class CrewRegistry {
  readonly members: CrewMember[];

  constructor(members: CrewMember[]) {
    this.members = members;
  }

  /** Seed the marketplace with our starter specialists, each given a fresh wallet. */
  static seeded(): CrewRegistry {
    const members = SEED_CREW.map((s, i) => ({
      ...s,
      id: `crew-${i + 1}`,
      jobsCompleted: s.jobsCompleted ?? 0,
      signer: createLocalSigner(),
    }));
    return new CrewRegistry(members);
  }

  skills(): string[] {
    return [...new Set(this.members.map((m) => m.skill))];
  }

  forSkill(skill: string): CrewMember[] {
    return this.members.filter((m) => m.skill === skill);
  }

  /** A successful job lifts reputation (capped); the network remembers who delivered. */
  recordOutcome(id: string, success: boolean): void {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    m.jobsCompleted += 1;
    m.reputation = success
      ? Math.min(100, m.reputation + 2)
      : Math.max(0, m.reputation - 10);
  }
}

/**
 * Run a crew member's skill on a task — real Groq if configured, else a mock deliverable.
 * `context` carries the work delivered by earlier crew so downstream specialists
 * actually build on it (e.g. the proofreader edits the copy, not the brief).
 */
export async function runCrewTask(
  member: CrewMember,
  task: string,
  context?: string,
): Promise<string> {
  const fallback = `[${member.name}·${member.skill}] ${task}${context ? " (built on prior crew's work)" : ""} → delivered (offline).`;
  const groq = getGroq();
  if (!groq) return withImage(member.skill, fallback, task);

  const userContent = context
    ? `${task}\n\n--- Work already delivered by earlier crew (use this as your input) ---\n${context}`
    : task;
  try {
    const completion = await groq.chat.completions.create({
      model: config.groqModel,
      messages: [
        { role: "system", content: member.systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.6,
      max_tokens: 400,
    });
    return withImage(member.skill, completion.choices[0]?.message?.content?.trim() || fallback, task);
  } catch (err) {
    // Brain unavailable (rate limit / network) — never crash the economy mid-job.
    const reason = err instanceof Error ? err.message.split("\n")[0] : "unknown";
    console.warn(`  [crew] ${member.name} brain unavailable, delivering offline (${reason})`);
    return withImage(member.skill, fallback, task);
  }
}

/**
 * The image crew actually GENERATES an image (via Pollinations — free, keyless),
 * not just a text prompt. The deliverable embeds a real, renderable image URL.
 */
function withImage(skill: string, text: string, task: string): string {
  if (skill !== "image-prompt" && skill !== "image") return text;
  const prompt = (text && text.length > 10 ? text : task).replace(/\s+/g, " ").trim().slice(0, 320);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=576`;
  return `${text}\n\n![generated image](${url})`;
}
