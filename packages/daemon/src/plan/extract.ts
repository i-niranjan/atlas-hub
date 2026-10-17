import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { TNode, Track } from "@atlas/core";
import { z } from "zod";
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
      evidence: Quote,
    }),
  ),
});
export type PlanExtraction = z.infer<typeof PlanExtraction>;

export const PLAN_SYSTEM = `You read a software project's planning documents and lay out its trajectory: where it is heading, what is planned, what is done, and which earlier plans were abandoned. Atlas draws this as a map, so structure and accuracy matter more than detail.

# Tracks
A track is one coherent direction for the project. Usually there is one active track. A document marked superseded, archived or "original", or explicitly replaced by another plan, is an abandoned track; give it a reason taken from the documents (for example, which document supersedes it and why) and set forkedFromRef on the track that replaced it to point at the abandoned one. Name tracks with short noun phrases ("Coding harness", "Python cloud platform").

# Nodes
- goal: one per track, the outcome the track aims for, in a single line.
- milestone: the stages, in order (use the documents' own ids as key, e.g. "H2", "M3").
- story: the work items under a milestone (key = the documents' id, e.g. "CH-014"; parentRef = the milestone's ref).
For an abandoned track, give only its goal and at most 8 milestones, no stories.
List nodes in the documents' order. Titles: at most 70 characters, specific, no ids repeated in the title.

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
  docs: Doc[];
  tracks: Track[];
  nodes: TNode[];
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
  return `<project>${input.projectName}</project>\n\n<existing_items>\n${existing}\n</existing_items>\n\n${docs}`;
}

export interface PlanExtractor {
  extract(input: PlanInput): Promise<PlanExtraction>;
}

export class AnthropicPlanExtractor implements PlanExtractor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
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
    if (message.stop_reason === "refusal") throw new Error("plan extraction refused");
    if (message.stop_reason === "max_tokens")
      throw new Error("plan extraction truncated (max_tokens)");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return PlanExtraction.parse(JSON.parse(text));
  }
}
