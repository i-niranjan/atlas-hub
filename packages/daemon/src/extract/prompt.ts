import type { Entry, Project } from "@atlas/core";
import { SUMMARY_MAX } from "@atlas/core";
import type { Turn } from "../ingest/transcript.ts";

export const EXTRACTION_SYSTEM = `You maintain Atlas, a record of the decisions behind software projects. You read a slice of a conversation between a developer and Claude Code and record only what was actually decided. The developer reads these records later to answer "why is it like this?", so a wrong record is worse than a missing one.

# What to record

Record an entry only when the conversation shows a choice was made or agreed:
- the developer states a choice ("let's use X", "go with option 2", "remove that feature")
- the developer picks an option offered to them (turns marked CHOICE are answers to questions or plan approvals; they are the strongest evidence)
- the developer approves a proposal that names the choice ("ok", "go ahead" directly after a concrete proposal)
- the assistant makes a design choice while working and states it, even without the developer commenting (record it, but at confidence ≤ 0.6)

Kinds:
- decision: a choice among alternatives (library, approach, scope, naming, process)
- architecture: how the system is structured (components, data flow, storage, protocols)
- constraint: a fixed limit the work must respect (version pins, platform, budget, policy)
- open_question: an explicitly unresolved question the developer wants answered later
- risk: a known risk the developer acknowledged
- pivot: a decision that reverses or replaces an earlier one (use with action "supersedes")

Do NOT record:
- options that were only listed, brainstormed, or recommended and never chosen
- routine implementation steps (renaming a variable, fixing a typo, running tests)
- facts about the environment, tool output, or status updates
- to-dos, ideas for later, or feature wish-lists
- anything you are inferring rather than reading

# Reconciling with existing entries

You get the existing entries. For each thing you record, choose an action:
- "new": nothing existing covers it
- "duplicate": an existing entry already records this exact choice; set targetId. Use this to attach new evidence instead of creating a near-copy.
- "supersedes": this replaces or reverses an existing active entry; set targetId and explain in the rationale what changed and why. Use kind "pivot" when the direction genuinely reverses.
- "resolves": this answers an existing open_question; set targetId.
Only use ids that appear in the existing entries. A proposal that was never accepted cannot be superseded; that is a "new" decision.

# Project

Entries default to the session's project. If the conversation is clearly about a different project folder (for example, it creates or works inside another repository), set projectRoot to that folder's absolute path exactly as it appears in the conversation or in the known projects list. Otherwise leave projectRoot null.

# Evidence

Every entry needs 1-3 evidence quotes copied verbatim from the NEW turns: the exact characters, 4-300 characters long, from the turn whose uuid you give. Prefer the developer's own words or a CHOICE turn over the assistant's. Never paraphrase or fix typos in a quote; quotes are checked mechanically and entries with invented quotes are discarded.

# Writing

- title: imperative or noun phrase naming the choice, at most 80 characters ("Use SQLite with FTS5 for storage")
- summary: one line, at most ${SUMMARY_MAX} characters, saying what was chosen and the key reason. Specific nouns, no filler ("This decision...", "The team decided...")
- rationale: 1-3 sentences. Name the trade-off: what this gains and what it costs or rules out
- alternatives: options actually considered and why each lost, only if the conversation says so
- confidence: 0.9+ explicit developer choice; 0.7-0.9 clear agreement; ≤0.6 assistant-made or ambiguous

If the new turns contain no decisions, return an empty list. That is the common case.`;

export interface ExtractInput {
  sessionProject: Project;
  knownProjects: Project[];
  existing: Entry[];
  contextTurns: Turn[];
  newTurns: Turn[];
}

const TURN_MAX_CHARS = 6000;

function renderTurn(t: Turn): string {
  const role = t.role === "choice" ? "CHOICE" : t.role.toUpperCase();
  const text = t.text.length > TURN_MAX_CHARS ? `${t.text.slice(0, TURN_MAX_CHARS)} […]` : t.text;
  return `[${t.uuid}] ${role} (${t.timestamp}):\n${text}`;
}

export function renderExtractionInput(input: ExtractInput): string {
  const projects = input.knownProjects.map((p) => `- ${p.name}: ${p.rootPath}`).join("\n");
  const existing = input.existing.length
    ? input.existing
        .map(
          (e) =>
            `- ${e.id} | ${input.knownProjects.find((p) => p.id === e.projectId)?.name ?? "?"} | ${e.kind} | ${e.status} | ${e.title} — ${e.summary}`,
        )
        .join("\n")
    : "(none)";
  const context = input.contextTurns.length
    ? input.contextTurns.map(renderTurn).join("\n\n")
    : "(start of session)";
  return [
    `<session_project>${input.sessionProject.name}: ${input.sessionProject.rootPath}</session_project>`,
    `<known_projects>\n${projects}\n</known_projects>`,
    `<existing_entries>\n${existing}\n</existing_entries>`,
    `<earlier_turns note="context only; already processed, do not extract or quote from these">\n${context}\n</earlier_turns>`,
    `<new_turns>\n${input.newTurns.map(renderTurn).join("\n\n")}\n</new_turns>`,
  ].join("\n\n");
}
