import type { Entry, Project } from "@atlas/core";
import { SUMMARY_MAX } from "@atlas/core";
import type { Turn } from "../ingest/transcript.ts";

export const EXTRACTION_SYSTEM = `You maintain Atlas, a record of the decisions behind software projects. You read a slice of a conversation between a developer and Claude Code and record only what was actually decided. The developer reads these records later to answer "why is it like this?", so a wrong record is worse than a missing one.

# What to record

Record an entry only when the conversation shows a choice was made or agreed:
- the developer states a choice ("let's use X", "go with option 2", "remove that feature")
- the developer picks an option offered to them (turns marked CHOICE are answers to questions or plan approvals; they are the strongest evidence)
- the developer approves a proposal that names the choice ("ok", "go ahead" directly after a concrete proposal)
- the assistant makes a design choice that shapes the project (architecture, a dependency, a data format, user-facing behaviour) and states it, without the developer objecting (record it at confidence ≤ 0.6). Routine implementation choices the assistant makes while coding are not decisions.

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
- "supersedes": this replaces or reverses an existing active entry; set targetId. Use kind "pivot" when the direction genuinely reverses. Also fill before (the old choice, in plain words), after (the new choice, in plain words), shifts (1-3 concrete differences, each "old → new", at most 4 words a side) and cost (what was given up, or null). The rationale then states the cause of the change: the problem with the old choice or the new fact, as the turns state it. A reference to a document is not a cause.
For any other action leave before, after and cost null and shifts empty.
- "resolves": this answers an existing open_question; set targetId.
Only use ids that appear in the existing entries. A proposal that was never accepted cannot be superseded; that is a "new" decision.

# Project

Entries default to the session's project. If the conversation is clearly about a different project folder (for example, it creates or works inside another repository), set projectRoot to that folder's absolute path exactly as it appears in the conversation or in the known projects list. Otherwise leave projectRoot null.

# Evidence

Every entry needs 1-3 evidence quotes copied verbatim from the NEW turns: the exact characters, 4-300 characters long, from the turn whose uuid you give. Prefer the developer's own words or a CHOICE turn over the assistant's. Never paraphrase or fix typos in a quote; quotes are checked mechanically and entries with invented quotes are discarded.

# Writing

Write for someone with no context on the project; they read these records later to understand it.
- title: imperative or noun phrase naming the choice in plain words, at most 80 characters ("Store decisions in a local SQLite database"). Internal names and acronyms are fine only if the summary makes them clear.
- summary: one line, at most ${SUMMARY_MAX} characters, saying what was chosen and the key reason. Specific nouns, no filler ("This decision...", "The team decided...")
- rationale: 1-3 sentences giving the reason as the conversation states it. Name the trade-off (what this gains, what it costs or rules out) when the conversation states one; otherwise say what it was chosen over and why. Never invent a trade-off or a reason.
- alternatives: options actually considered and why each lost, only if the conversation says so
- confidence: 0.9+ explicit developer choice; 0.7-0.9 clear agreement; ≤0.6 assistant-made or ambiguous

If the new turns contain no decisions, return an empty list. That is the common case.
`;

export const ROADMAP_SYSTEM = `You maintain the roadmaps in Atlas, which draws where software projects are heading. You read a slice of a conversation between a developer and Claude Code and report how it moves a project's roadmap. A wrong change is worse than a missing one.

# Evidence
Every item needs 1-3 evidence quotes copied verbatim from the NEW turns: the exact characters, 4-300 characters long, from the turn whose uuid you give. Prefer the developer's own words or a CHOICE turn (an answer to a question or a plan approval). Quotes are checked mechanically; items with invented quotes are discarded.
Confidence: 0.9+ explicit developer statement; 0.7-0.9 clear agreement; ≤0.6 assistant-only or ambiguous.

# Progress (only when <trajectory> is given; otherwise return an empty progress list)

<trajectory> lists the project's planned goal, milestones and stories with ids and status. Report movement on it that the new turns show:
- started / done / dropped / blocked: an existing node (nodeId) whose work clearly began, was finished (implemented and verified, not merely discussed), was cut from scope, or is blocked.
- added: new work the developer brought into scope (title; milestoneId when it clearly belongs to one; kind "story"). On a roadmap marked managed_by="sessions" you may also add a whole new phase with kind "milestone".
- pivot: the developer changed the project's direction so the current plan no longer applies. Rare; only for explicit decisions. title = the new direction; before = the old plan in plain words; after = the new plan in plain words; reason = the cause as the turns state it (the problem with the old approach or the new fact), or null if not stated; shifts = 2-4 concrete differences, each written "old → new" with at most 4 words a side; cost = what was given up or postponed, or null. For other actions leave before/after/cost null and shifts empty. Write for someone with no context on the project; a reference to a document or "the plan changed" is not a why.
Same evidence rules as above. Do not report planning talk as progress. Empty is the common case.

# Starting a roadmap (only when <no_roadmap> is given; otherwise newPlan is null)

The session's project has no roadmap and no plan documents. Start one only when the new turns are genuine work on this project: building it, planning it, or brainstorming its direction and what to build. Then return newPlan: direction (short noun phrase for the approach), goal (one line: what the project is for), and the phases or milestones in order (at least one), with tasks under them where the turns name them. Each milestone needs a verbatim evidence quote from the new turns. Use ids the conversation gives (e.g. "Phase 1", "M2") as key. Status is planned unless the turns show the work done or under way.
Write for someone with no context on the project: plain-word titles (at most 8 words) that say what each phase delivers, and an explain sentence (at most 90 characters) per milestone; no internal shorthand.
Confidence: 0.8 or more only when the developer explicitly agreed to the plan; brainstorming that hasn't settled is below 0.7 (it is drawn as unconfirmed).
Return null for everything else: general questions, tool or account help, one-off fixes, chit-chat, and work that is really about a different project from <known_projects>.`;

export interface ExtractInput {
  sessionProject: Project;
  knownProjects: Project[];
  existing: Entry[];
  contextTurns: Turn[];
  newTurns: Turn[];
  /** Rendered trajectory of the session's project, when it has one (module 2). */
  trajectory?: string;
  /** The session's project has neither a roadmap nor plan docs: a session may start one. */
  noRoadmap?: boolean;
}

/** The developer's own words carry the decisions, so they get more room than assistant replies. */
const TURN_MAX_CHARS = { user: 20_000, choice: 12_000, assistant: 6_000 } as const;

function renderTurn(t: Turn): string {
  const role = t.role === "choice" ? "CHOICE" : t.role.toUpperCase();
  const max = TURN_MAX_CHARS[t.role];
  const text = t.text.length > max ? `${t.text.slice(0, max)} […]` : t.text;
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
    ...(input.trajectory ? [`<trajectory>\n${input.trajectory}\n</trajectory>`] : []),
    ...(input.noRoadmap
      ? [
          `<no_roadmap project="${input.sessionProject.name}">This project has no roadmap or plan documents yet.</no_roadmap>`,
        ]
      : []),
    `<earlier_turns note="context only; already processed, do not extract or quote from these">\n${context}\n</earlier_turns>`,
    `<new_turns>\n${input.newTurns.map(renderTurn).join("\n\n")}\n</new_turns>`,
  ].join("\n\n");
}
