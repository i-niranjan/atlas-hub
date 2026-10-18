import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { TNode, Track } from "@atlas/core";
import { z } from "zod";
import type { UsageSink } from "../usage.ts";
import type { Doc } from "./docs.ts";

const Quote = z.object({ path: z.string(), quote: z.string() });

export const PlanExtraction = z.object({
  docs: z.array(
    z.object({
      path: z.string(),
      role: z.enum(["current", "superseded", "reference"]),
      /** A date the document states for itself (created/updated), ISO yyyy-mm-dd, else null. */
      date: z.string().nullable(),
    }),
  ),
  tracks: z.array(
    z.object({
      ref: z.string(),
      name: z.string(),
      status: z.enum(["active", "abandoned"]),
      reason: z.string().nullable(),
      forkedFromRef: z.string().nullable(),
      /** On a track that replaced another (forkedFromRef set): the pivot, structured. */
      change: z
        .object({
          before: z.string(),
          after: z.string(),
          why: z.string().nullable(),
          whyEvidence: Quote.nullable(),
          shifts: z.array(z.object({ from: z.string(), to: z.string() })),
          cost: z.string().nullable(),
          entryIds: z.array(z.string()),
        })
        .nullable(),
      evidence: Quote,
    }),
  ),
  nodes: z.array(
    z.object({
      ref: z.string(),
      existingId: z.string().nullable(),
      trackRef: z.string(),
      kind: z.enum(["goal", "milestone", "story"]),
      key: z.string().nullable(),
      title: z.string(),
      parentRef: z.string().nullable(),
      status: z.enum(["planned", "in_progress", "done", "dropped", "blocked"]),
      /** Goals and milestones: one plain sentence for a newcomer. Null for stories. */
      explain: z.string().nullable(),
      evidence: Quote,
    }),
  ),
  primer: z.object({
    oneLiner: z.string(),
    terms: z.array(z.object({ term: z.string(), meaning: z.string() })),
  }),
});
export type PlanExtraction = z.infer<typeof PlanExtraction>;

export const PLAN_SYSTEM = `You read a software project's planning documents and lay out its trajectory: where it is heading, what is planned, what is done, and which earlier plans were abandoned. Atlas draws this as a map, so structure and accuracy matter more than detail.

# Tracks
A track is one coherent direction for the project. Usually there is one active track. A document marked superseded, archived or "original", or explicitly replaced by another plan, is an abandoned track; set forkedFromRef on the track that replaced it to point at the abandoned one. Name tracks with short noun phrases a newcomer understands ("Terminal coding tool", "Python cloud platform").

# Pivots (change, on the track that replaced another)
A reader with no context must understand the change of direction from these fields alone:
- before: what the old plan was, in plain words (at most 12 words).
- after: what the plan is now, in plain words (at most 12 words).
- why: the cause, meaning the problem with the old approach or the new fact that made it wrong, in one or two plain sentences. Where the change is recorded ("superseded by the master scope", "conflicts with document X") is NOT a reason. Look for the cause in the documents and in <decisions>. If none states it directly, use the replacing plan's own stated principles, goals or priorities that the old plan conflicts with (for example "The new plan puts one reliable agent before a swarm of agents"), quoted in whyEvidence. Set why to null only when neither exists; never guess.
- whyEvidence: a verbatim quote (4-200 characters) from a document that supports why, or null if the cause comes only from <decisions>.
- entryIds: ids from <decisions> that record why the direction changed.
- shifts: 2 to 4 concrete differences as from → to, each side at most 4 words ("Python" → "TypeScript", "Cloud service" → "Local terminal tool").
- cost: what was given up or postponed, in plain words, or null.
Define any unavoidable project term in primer.terms. reason (on the abandoned track) is a one-line plain summary of why, or null.

# Nodes
- goal: one per track, the outcome the track aims for, in a single line.
- milestone: the stages, in order (use the documents' own ids as key, e.g. "H2", "M3").
- story: the work items under a milestone (key = the documents' id, e.g. "CH-014"; parentRef = the milestone's ref).
For an abandoned track, give its goal and its main milestones or phases (3 to 8, in order) so the map can show what was originally planned; no stories.
Include every milestone and story the current plan lists; never sample or summarise a backlog. List nodes in the documents' order. (Title wording rules are under Wording.)

# Wording: write for someone who has never seen this project
The person reading the map has no context. Every title must make sense on its own:
- Titles: plain words, at most 8 words (about 60 characters), saying what the step delivers ("Agent edits code safely in a sandbox"), not internal shorthand ("Isolated coding"). Keep ids in key, never in the title.
- explain: for the goal and each milestone, one plain sentence (at most 90 characters) on what it means and why it matters. Null for stories.
- Avoid jargon. When a project-specific word is unavoidable (a component's name, an acronym), keep it and define it in primer.terms.

# primer
- oneLiner: what this project is, for a newcomer, at most 120 characters.
- terms: up to 6 project-specific words that appear in your titles or goal, each with a plain meaning of at most 80 characters. Only words a newcomer wouldn't know.

# Status
Only from explicit statements: progress tables, resume or status notes, checkmarks, "done", "complete", "in progress", "dropped", "blocked". A plan saying what will be built is "planned". Never infer progress.

# Existing items
You get the items already on the map. When a node is the same item, set existingId to its id, even if its wording changed. Otherwise null.

# Evidence
Every track and node needs one quote copied verbatim from the named document (path exactly as given), 4-200 characters. Quotes are checked mechanically; nodes with invented quotes are discarded.

# docs
For every document given, say whether it is the current plan, a superseded plan, or reference material (scripts, explainers, notes), and any date it states for itself.`;

export interface PlanInput {
  projectName: string;
  /** For cost tracking. */
  projectId?: string;
  /** Ids the previous attempt left out; the model is asked to include them. */
  missingKeys?: string[];
  docs: Doc[];
  tracks: Track[];
  nodes: TNode[];
  /** The project's recorded decisions (module 1): where the "why" behind a pivot usually lives. */
  decisions?: {
    id: string;
    kind: string;
    title: string;
    summary: string;
    rationale: string;
    decidedAt: string;
  }[];
}

export function renderPlanInput(input: PlanInput): string {
  const trackName = new Map(input.tracks.map((t) => [t.id, t.name]));
  const existing = input.nodes.length
    ? input.nodes
        .map(
          (n) =>
            `- ${n.id} | ${trackName.get(n.trackId) ?? "?"} | ${n.kind} | ${n.key ?? "-"} | ${n.title}`,
        )
        .join("\n")
    : "(none yet)";
  const docs = input.docs
    .map(
      (d) =>
        `<doc path="${d.label}" modified="${d.modifiedAt.slice(0, 10)}"${d.supersededHint ? ' location_hint="archive"' : ""}>\n${d.text}\n</doc>`,
    )
    .join("\n\n");
  const missing = input.missingKeys?.length
    ? `\n\n<completeness note="A previous pass left these ids out. Include every one of them, plus everything else.">${input.missingKeys.join(", ")}</completeness>`
    : "";
  const decisions = input.decisions?.length
    ? `\n\n<decisions note="recorded from the developer's sessions; cite by id in entryIds">\n${input.decisions
        .map(
          (d) =>
            `- ${d.id} | ${d.kind} | ${d.decidedAt.slice(0, 10)} | ${d.title}: ${d.summary} Why: ${d.rationale}`,
        )
        .join("\n")}\n</decisions>`
    : "";
  return `<project>${input.projectName}</project>${missing}\n\n<existing_items>\n${existing}\n</existing_items>${decisions}\n\n${docs}`;
}

export interface PlanExtractor {
  extract(input: PlanInput): Promise<PlanExtraction>;
}

export class AnthropicPlanExtractor implements PlanExtractor {
  private readonly client: Anthropic;
  private readonly model: string;

  private readonly onUsage: UsageSink | undefined;

  constructor(apiKey: string, model: string, onUsage?: UsageSink) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.onUsage = onUsage;
  }

  async extract(input: PlanInput): Promise<PlanExtraction> {
    // Streamed: a long backlog can produce a large structured answer.
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 48_000,
      output_config: { format: zodOutputFormat(PlanExtraction), effort: "medium" },
      system: [{ type: "text", text: PLAN_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderPlanInput(input) }],
    });
    const message = await stream.finalMessage();
    this.onUsage?.("roadmap", this.model, message.usage, input.projectId ?? null);
    if (message.stop_reason === "refusal") throw new Error("plan extraction refused");
    if (message.stop_reason === "max_tokens")
      throw new Error("plan extraction truncated (max_tokens)");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return PlanExtraction.parse(JSON.parse(text));
  }
}

/** Ids documented at least twice (defined, not just mentioned) but absent from the extraction. */
export function missingKeys(docs: Doc[], x: PlanExtraction): string[] {
  const counts = new Map<string, number>();
  for (const d of docs) {
    if (d.supersededHint) continue;
    for (const m of d.text.matchAll(/(?<![A-Za-z0-9-])([A-Z]{1,6}-\d{2,5})(?![A-Za-z0-9])/g))
      counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  const got = new Set(x.nodes.map((n) => n.key?.toUpperCase()).filter(Boolean));
  return [...counts]
    .filter(([k, n]) => n >= 2 && !got.has(k))
    .map(([k]) => k)
    .sort();
}
