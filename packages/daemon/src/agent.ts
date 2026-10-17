import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import {
  BLOCK_TYPES,
  referencedEntryIds,
  validateView,
  type Block,
  type CanvasState,
  type EntryDetail,
  type ProjectSummary,
} from "@atlas/core";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store.ts";

/**
 * The generative canvas (ADR 0004/0005). Claude reads the store through tools
 * and finishes by calling `render_view`; the view goes to the app as an AG-UI
 * STATE_SNAPSHOT with every referenced entry resolved from the store.
 */

const SYSTEM = `You are the canvas of Atlas, a macOS app that records the decisions, architecture, constraints, open questions and pivots behind the developer's projects. The developer asks a question; you look up what is recorded and compose a view that answers it.

How to work:
1. Use the read tools to find the relevant entries. Search with a few different phrasings if the first finds nothing. Stay within the current project unless the question is cross-project.
2. Finish by calling render_view exactly once with a focused view. Then reply with at most two plain sentences that answer the question directly; the view carries the detail.

Composing the view:
- Reference recorded entries by id (DecisionCard, EntryList, PivotLineage, OpenQuestions). The app fills in their content from the store, so never restate an entry's details in Markdown.
- PivotLineage for "how did X evolve / why did we change". DecisionCard for one key decision. EntryList for several related ones. OpenQuestions for unresolved questions.
- ArchitectureDiagram only when architecture entries describe components and how they connect. Build the Mermaid flowchart (graph LR or TD, short node labels) strictly from those entries and list them in sourceEntryIds.
- OptionsCompare only when an entry's recorded alternatives support it; set sourceEntryId.
- Section groups related blocks under a heading. Callout (info) for a short note, e.g. that something is not recorded.
- Prefer 1-4 blocks. Lead with the most direct answer.

Rules:
- Use only what the tools return. If nothing relevant is recorded, render a single Callout saying so plainly, and do not guess.
- Unconfirmed entries (review: needs_review) may be shown, but say they are unconfirmed when they matter to the answer.
- No filler, no greetings, no restating the question.`;

const ViewInput = z.object({ title: z.string(), blocks: z.array(z.unknown()) });

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_projects",
    description: "List all projects Atlas knows, with entry counts.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_entries",
    description: "List a project's entries, newest first.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: { type: "string", enum: ["active", "superseded", "reverted", "resolved"] },
        kind: { type: "string" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_entries",
    description: "Full-text search over entries. Optionally limit to one project.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, projectId: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_entry",
    description: "Full detail of one entry: rationale, alternatives, evidence quotes and lineage.",
    input_schema: {
      type: "object",
      properties: { entryId: { type: "string" } },
      required: ["entryId"],
      additionalProperties: false,
    },
  },
  {
    name: "render_view",
    description: `Render the answer as a view. blocks is an array of objects, each with a "type" from: ${BLOCK_TYPES.join(", ")}.
Shapes:
- {type:"DecisionCard", entryId}
- {type:"EntryList", title?, entryIds:[...]}
- {type:"PivotLineage", entryId}
- {type:"OpenQuestions", entryIds:[...]}
- {type:"ArchitectureDiagram", title, mermaid, caption?, sourceEntryIds:[...]}
- {type:"OptionsCompare", question, options:[{name, pros:[...], cons:[...], chosen}], sourceEntryId?}
- {type:"ProjectOverview", projectId}
- {type:"Callout", tone:"info"|"warning", text}
- {type:"Markdown", text}
- {type:"KeyValue", items:[{label, value}]}
- {type:"Section", title, blocks:[...]}`,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short view title, at most 80 characters" },
        blocks: { type: "array", items: { type: "object" } },
      },
      required: ["title", "blocks"],
      additionalProperties: false,
    },
  },
];

const STEP_LABELS: Record<string, string> = {
  list_projects: "Reading projects",
  list_entries: "Reading decisions",
  search_entries: "Searching decisions",
  get_entry: "Reading details",
  render_view: "Composing view",
};

function compact(
  e: EntryDetail | (ReturnType<Store["listEntries"]>[number] & { source?: string }),
) {
  return {
    id: e.id,
    projectId: e.projectId,
    kind: e.kind,
    status: e.status,
    review: e.reviewState,
    title: e.title,
    summary: e.summary,
    decidedAt: e.decidedAt.slice(0, 10),
    supersedesId: e.supersedesId,
  };
}

/** Drop references to unknown entries; drop blocks left empty by that. */
function pruneUnknown(blocks: Block[], known: Set<string>, dropped: string[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "DecisionCard":
      case "PivotLineage":
        if (known.has(b.entryId)) out.push(b);
        else dropped.push(`${b.type}: unknown entry ${b.entryId}`);
        break;
      case "EntryList":
      case "OpenQuestions": {
        const ids = b.entryIds.filter((id) => known.has(id));
        if (ids.length) out.push({ ...b, entryIds: ids });
        else dropped.push(`${b.type}: no known entries`);
        break;
      }
      case "ArchitectureDiagram":
        out.push({ ...b, sourceEntryIds: b.sourceEntryIds.filter((id) => known.has(id)) });
        break;
      case "OptionsCompare": {
        const { sourceEntryId, ...rest } = b;
        out.push(sourceEntryId && known.has(sourceEntryId) ? b : rest);
        break;
      }
      case "Section": {
        const inner = pruneUnknown(b.blocks, known, dropped);
        if (inner.length) out.push({ ...b, blocks: inner });
        break;
      }
      default:
        out.push(b);
    }
  }
  return out;
}

export function resolveView(
  store: Store,
  input: unknown,
): { state: CanvasState } | { error: string } {
  const v = validateView(input);
  if ("error" in v) return { error: v.error };
  const ids = referencedEntryIds(v.blocks);
  const entries: Record<string, EntryDetail> = {};
  for (const id of ids) {
    const d = store.entryDetail(id);
    if (d) entries[id] = d;
  }
  // Lineage views need every entry in the chain.
  for (const d of Object.values(entries)) {
    for (const l of d.lineage)
      if (!entries[l.id]) {
        const full = store.entryDetail(l.id);
        if (full) entries[l.id] = full;
      }
  }
  const dropped = [...v.dropped];
  const blocks = pruneUnknown(v.blocks, new Set(Object.keys(entries)), dropped);
  const projects: Record<string, ProjectSummary> = {};
  const all = store.listProjects();
  const wanted = new Set<string>(Object.values(entries).map((e) => e.projectId));
  const visit = (b: Block): void => {
    if (b.type === "ProjectOverview") wanted.add(b.projectId);
    if (b.type === "Section") b.blocks.forEach(visit);
  };
  blocks.forEach(visit);
  for (const p of all) if (wanted.has(p.id)) projects[p.id] = p;
  for (const b of blocks) {
    if (b.type !== "ProjectOverview" || !projects[b.projectId]) continue;
    for (const e of store.listEntries({ projectId: b.projectId, limit: 40 })) {
      const full = store.entryDetail(e.id);
      if (full) entries[e.id] = full;
    }
  }
  if (!blocks.length) return { error: `every block was invalid: ${dropped.join("; ")}` };
  return { state: { view: { title: v.title, blocks }, entries, projects, dropped } };
}

function runTool(store: Store, name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, string | undefined>;
  switch (name) {
    case "list_projects":
      return JSON.stringify(
        store
          .listProjects()
          .map((p) => ({ id: p.id, name: p.name, root: p.rootPath, ...p.counts })),
      );
    case "list_entries":
      return JSON.stringify(
        store
          .listEntries({
            projectId: args.projectId ?? "",
            ...(args.status ? { status: args.status as "active" } : {}),
            ...(args.kind ? { kind: args.kind } : {}),
            limit: 80,
          })
          .map(compact),
      );
    case "search_entries":
      return JSON.stringify(store.search(args.query ?? "", args.projectId, 20).map(compact));
    case "get_entry": {
      const d = store.entryDetail(args.entryId ?? "");
      return d
        ? JSON.stringify({
            ...compact(d),
            rationale: d.rationale,
            alternatives: d.alternatives,
            evidence: d.evidence.map((e) => e.quote),
            lineage: d.lineage,
          })
        : `No entry ${args.entryId}`;
    }
    default:
      return `Unknown tool ${name}`;
  }
}

export interface AgentDeps {
  store: Store;
  apiKey: string | null;
  model: string;
}

const MAX_TURNS = 8;

export function runCanvas(input: RunAgentInput, deps: AgentDeps): ReadableStream<Uint8Array> {
  // Always SSE text: the desktop client speaks SSE, so protobuf negotiation is unnecessary.
  const encoder = new EventEncoder();
  const bytes = new TextEncoder();
  const { threadId, runId } = input;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BaseEvent) => controller.enqueue(bytes.encode(encoder.encode(event)));
      send({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

      if (!deps.apiKey) {
        send({
          type: EventType.RUN_ERROR,
          message: "Add an Anthropic API key in Settings to use Ask Atlas.",
          code: "no_api_key",
        } as BaseEvent);
        controller.close();
        return;
      }

      const projectId = (input.forwardedProps as { projectId?: string } | undefined)?.projectId;
      const project = projectId ? deps.store.getProject(projectId) : null;
      const messages: Anthropic.Beta.BetaMessageParam[] = [];
      for (const m of input.messages) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        const content = typeof m.content === "string" ? m.content : "";
        if (content.trim()) messages.push({ role: m.role, content });
      }
      if (project && messages.length) {
        messages.push({
          role: "system",
          content: `Current project: ${project.name} (id ${project.id}, ${project.rootPath}).`,
        } as unknown as Anthropic.Beta.BetaMessageParam);
      }

      const client = new Anthropic({ apiKey: deps.apiKey });
      let rendered = false;
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const stream = client.beta.messages.stream({
            model: deps.model,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "medium" },
            system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
            tools: TOOLS,
            messages,
          });
          let messageId: string | null = null;
          stream.on("text", (delta) => {
            if (!messageId) {
              messageId = randomUUID();
              send({
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: "assistant",
              } as BaseEvent);
            }
            send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta } as BaseEvent);
          });
          const message = await stream.finalMessage();
          if (messageId) send({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);

          if (message.stop_reason === "refusal") throw new Error("The request was declined.");
          const toolUses = message.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
          );
          if (!toolUses.length) break;
          if (message.stop_reason === "max_tokens") throw new Error("The response was cut off.");

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const use of toolUses) {
            const label = STEP_LABELS[use.name] ?? use.name;
            send({ type: EventType.STEP_STARTED, stepName: label } as BaseEvent);
            let result: string;
            let isError = false;
            if (use.name === "render_view") {
              const parsed = ViewInput.safeParse(use.input);
              const resolved = parsed.success
                ? resolveView(deps.store, parsed.data)
                : { error: "title and blocks are required" };
              if ("error" in resolved) {
                result = `View rejected: ${resolved.error}. Fix it and call render_view again.`;
                isError = true;
              } else {
                send({ type: EventType.STATE_SNAPSHOT, snapshot: resolved.state } as BaseEvent);
                rendered = true;
                result = resolved.state.dropped.length
                  ? `Rendered. Dropped: ${resolved.state.dropped.join("; ")}`
                  : "Rendered.";
              }
            } else {
              result = runTool(deps.store, use.name, use.input);
            }
            send({ type: EventType.STEP_FINISHED, stepName: label } as BaseEvent);
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: result,
              ...(isError ? { is_error: true } : {}),
            });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: EventType.RUN_FINISHED, threadId, runId, result: { rendered } } as BaseEvent);
      } catch (err) {
        const message =
          err instanceof Anthropic.AuthenticationError
            ? "The Anthropic API key was rejected. Update it in Settings."
            : err instanceof Anthropic.RateLimitError
              ? "Rate limited by the Anthropic API. Try again in a moment."
              : err instanceof Error
                ? err.message
                : String(err);
        send({ type: EventType.RUN_ERROR, message } as BaseEvent);
      }
      controller.close();
    },
  });
}
