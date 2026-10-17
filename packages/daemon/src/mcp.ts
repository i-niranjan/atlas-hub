import { Entry, EntryKind, type Project } from "@atlas/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { VERSION } from "./config.ts";
import type { Ingestor } from "./ingest/ingestor.ts";
import { isDirectory } from "./ingest/project.ts";
import { newEntryId, type Store } from "./store.ts";

export interface McpDeps {
  store: Store;
  ingestor: Ingestor;
  onSaved: (entryId: string) => void;
}

type AnyEntry = Entry & { source?: string };

function formatEntry(e: AnyEntry, store: Store, withEvidence = false): string {
  const project = store.getProject(e.projectId)?.name ?? "?";
  const flags = [
    e.status !== "active" ? e.status : null,
    e.reviewState === "needs_review" ? "unconfirmed" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    `[${e.id}] ${e.kind} · ${project}${flags ? ` · ${flags}` : ""} · ${e.decidedAt.slice(0, 10)}`,
    `  ${e.title}`,
    `  ${e.summary}`,
  ];
  if (withEvidence) {
    lines.push(`  Why: ${e.rationale}`);
    for (const a of e.alternatives) lines.push(`  Rejected ${a.option}: ${a.whyNot}`);
    for (const ev of e.evidence.slice(0, 3)) lines.push(`  Evidence: "${ev.quote}"`);
  }
  return lines.join("\n");
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function resolveProject(store: Store, ref: string | undefined): Project | null | undefined {
  if (!ref) return undefined;
  return store.findProject(ref);
}

export function buildMcpServer({ store, ingestor, onSaved }: McpDeps): McpServer {
  const server = new McpServer({ name: "atlas", version: VERSION });

  server.registerTool(
    "atlas_search",
    {
      title: "Search decisions",
      description:
        "Full-text search over recorded decisions, architecture, constraints, open questions and pivots across all projects on this Mac.",
      inputSchema: {
        query: z.string().min(2).describe("Words to search for"),
        project: z.string().optional().describe("Project name or root path to limit the search"),
      },
    },
    async ({ query, project }) => {
      const p = resolveProject(store, project);
      if (p === null) return text(`No project matches "${project}".`);
      const hits = store.search(query, p?.id, 15);
      return text(
        hits.length ? hits.map((e) => formatEntry(e, store)).join("\n\n") : "No matching entries.",
      );
    },
  );

  server.registerTool(
    "atlas_decisions",
    {
      title: "List decisions",
      description: "List recorded entries for a project, newest first. Defaults to active entries.",
      inputSchema: {
        project: z
          .string()
          .describe("Project name or root path (use the current working directory)"),
        kind: z
          .string()
          .optional()
          .describe("decision, architecture, constraint, open_question, risk or pivot"),
        status: z.enum(["active", "superseded", "reverted", "resolved"]).optional(),
      },
    },
    async ({ project, kind, status }) => {
      const p = store.findProject(project);
      if (!p) return text(`Atlas has no project "${project}" yet.`);
      const entries = store.listEntries({
        projectId: p.id,
        status: status ?? "active",
        ...(kind ? { kind } : {}),
        limit: 60,
      });
      return text(
        entries.length
          ? `${p.name} (${entries.length}):\n\n${entries.map((e) => formatEntry(e, store)).join("\n\n")}`
          : `No ${status ?? "active"} entries for ${p.name}.`,
      );
    },
  );

  server.registerTool(
    "atlas_why",
    {
      title: "Explain why",
      description:
        "Answer 'why is it like this?': finds the decisions behind a topic and returns their rationale, rejected alternatives, evidence quotes and full pivot history.",
      inputSchema: {
        topic: z.string().min(2).describe("The component, choice or behaviour to explain"),
        project: z.string().optional().describe("Project name or root path"),
      },
    },
    async ({ topic, project }) => {
      const p = resolveProject(store, project);
      if (p === null) return text(`No project matches "${project}".`);
      const hits = store.search(topic, p?.id, 4);
      if (!hits.length) return text(`Atlas has nothing recorded about "${topic}".`);
      const blocks = hits.map((hit) => {
        const chain = store.lineage(hit.id);
        const history =
          chain.length > 1
            ? `\n  History: ${chain.map((c) => `${c.title} (${c.status}, ${c.decidedAt.slice(0, 10)})`).join(" → ")}`
            : "";
        return formatEntry(hit, store, true) + history;
      });
      return text(blocks.join("\n\n"));
    },
  );

  server.registerTool(
    "atlas_check",
    {
      title: "Check against past decisions",
      description:
        "Before proposing or making a design change, list the active decisions and constraints it touches so you can spot contradictions. Returns candidates; you judge whether they conflict.",
      inputSchema: {
        proposal: z.string().min(5).describe("The change you are about to propose or make"),
        project: z
          .string()
          .describe("Project name or root path (use the current working directory)"),
      },
    },
    async ({ proposal, project }) => {
      const p = store.findProject(project);
      if (!p) return text(`Atlas has no project "${project}" yet; nothing to check against.`);
      const related = store.search(proposal, p.id, 10).filter((e) => e.status === "active");
      return text(
        related.length
          ? `Active entries in ${p.name} related to this proposal. If it contradicts any, tell the user and name the entry before going ahead:\n\n${related
              .map((e) => formatEntry(e, store, true))
              .join("\n\n")}`
          : `No active entries in ${p.name} relate to this proposal.`,
      );
    },
  );

  server.registerTool(
    "atlas_log_decision",
    {
      title: "Record a decision",
      description:
        "Record a decision the user has explicitly made or agreed to. Do not log suggestions, plans or to-dos. Evidence must be the user's own words, copied verbatim.",
      inputSchema: {
        project_path: z.string().describe("Absolute path of the project folder"),
        kind: EntryKind.describe(
          "decision, architecture, constraint, open_question, risk or pivot",
        ),
        title: z.string().min(1).max(120),
        summary: z
          .string()
          .min(1)
          .max(140)
          .describe("One line: what was chosen and the key reason"),
        rationale: z.string().min(1).describe("The trade-off: what this gains and what it costs"),
        alternatives: z.array(z.object({ option: z.string(), whyNot: z.string() })).default([]),
        evidence_quote: z.string().min(4).max(400).describe("The user's words, verbatim"),
        supersedes_id: z.string().optional().describe("Id of the entry this replaces, if any"),
      },
    },
    async (args) => {
      if (!isDirectory(args.project_path)) return text(`${args.project_path} is not a folder.`);
      const project = ingestor.addProject(args.project_path);
      const target = args.supersedes_id ? store.getEntry(args.supersedes_id) : null;
      if (args.supersedes_id && !target)
        return text(`No entry ${args.supersedes_id} to supersede.`);
      const now = new Date().toISOString();
      const parsed = Entry.safeParse({
        id: newEntryId(),
        projectId: project.id,
        kind: args.kind === "pivot" && !target ? "decision" : args.kind,
        title: args.title,
        summary: args.summary,
        rationale: args.rationale,
        alternatives: args.alternatives,
        status: "active",
        supersedesId: target?.id ?? null,
        confidence: 0.9,
        reviewState: "confirmed",
        evidence: [{ sessionId: "mcp", messageUuid: `mcp:${now}`, quote: args.evidence_quote }],
        decidedAt: now,
        createdAt: now,
      });
      if (!parsed.success) return text(`Not recorded: ${z.prettifyError(parsed.error)}`);
      store.db.transaction(() => {
        store.saveEntry(parsed.data, "manual");
        if (target) store.setStatus(target.id, "superseded");
      })();
      onSaved(parsed.data.id);
      return text(`Recorded ${parsed.data.id} in ${project.name}.`);
    },
  );

  return server;
}

/** Stateless MCP over streamable HTTP: a fresh server per request. */
export async function handleMcp(req: Request, deps: McpDeps): Promise<Response> {
  const server = buildMcpServer(deps);
  // No sessionIdGenerator: stateless mode.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
