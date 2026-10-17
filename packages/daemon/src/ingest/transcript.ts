import { z } from "zod";

/**
 * One conversational turn worth reading for decisions. `choice` is a user
 * decision made through a UI (AskUserQuestion answers, plan approvals), which
 * Claude Code records as a tool result rather than a typed message.
 */
export interface Turn {
  uuid: string;
  role: "user" | "assistant" | "choice";
  text: string;
  timestamp: string;
}

export interface ParsedTranscript {
  sessionId: string | null;
  title: string | null;
  cwd: string | null;
  turns: Turn[];
}

/** Tools whose results carry the user's own decision. */
const CHOICE_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const CHOICE_MAX_CHARS = 8000;

const Block = z.looseObject({ type: z.string() });
const Line = z.looseObject({
  type: z.string(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
  aiTitle: z.string().optional(),
  message: z.looseObject({ content: z.union([z.string(), z.array(Block)]).optional() }).optional(),
});

const SYSTEM_TAGS =
  /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>/g;

export function cleanText(text: string): string {
  return text
    .replace(SYSTEM_TAGS, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: unknown) =>
      typeof b === "object" && b !== null && "type" in b && b.type === "text" && "text" in b
        ? String(b.text)
        : "",
    )
    .join("\n");
}

function describeQuestions(input: unknown): string {
  const parsed = z
    .object({
      questions: z.array(
        z.object({
          question: z.string(),
          options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
        }),
      ),
    })
    .safeParse(input);
  if (!parsed.success) return "";
  return parsed.data.questions
    .map(
      (q) =>
        `Asked: ${q.question}\n` +
        q.options
          .map((o) => `  - ${o.label}${o.description ? `: ${o.description}` : ""}`)
          .join("\n"),
    )
    .join("\n");
}

/** Parse complete JSONL lines into turns. Unknown or malformed lines are skipped. */
export function parseTranscript(jsonl: string): ParsedTranscript {
  const out: ParsedTranscript = { sessionId: null, title: null, cwd: null, turns: [] };
  const toolNames = new Map<string, string>();

  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = Line.safeParse(json);
    if (!parsed.success) continue;
    const line = parsed.data;

    out.sessionId ??= line.sessionId ?? null;
    if (line.type === "ai-title" && line.aiTitle) out.title = line.aiTitle;
    if (line.cwd) out.cwd ??= line.cwd;
    if (line.isSidechain) continue;
    if (line.type !== "user" && line.type !== "assistant") continue;
    if (!line.uuid || !line.message) continue;

    const ts = line.timestamp ?? new Date(0).toISOString();
    const content = line.message.content;

    if (line.type === "assistant") {
      const blocks = Array.isArray(content) ? content : [];
      const parts: string[] = [];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
        if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          toolNames.set(b.id, b.name);
          if (b.name === "AskUserQuestion") parts.push(describeQuestions(b.input));
        }
      }
      const text = cleanText(parts.join("\n"));
      if (text) out.turns.push({ uuid: line.uuid, role: "assistant", text, timestamp: ts });
      continue;
    }

    // user line
    if (line.isMeta) continue;
    if (typeof content === "string") {
      const text = cleanText(content);
      if (text) out.turns.push({ uuid: line.uuid, role: "user", text, timestamp: ts });
      continue;
    }
    const blocks = content ?? [];
    const typed = cleanText(textOf(blocks));
    if (typed) out.turns.push({ uuid: line.uuid, role: "user", text: typed, timestamp: ts });
    for (const b of blocks) {
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
      if (!CHOICE_TOOLS.has(toolNames.get(b.tool_use_id) ?? "")) continue;
      const text = cleanText(textOf(b.content)).slice(0, CHOICE_MAX_CHARS);
      if (text) out.turns.push({ uuid: line.uuid, role: "choice", text, timestamp: ts });
    }
  }
  return out;
}

/** Only complete lines: a transcript being written may end mid-line. */
export function completeLines(buf: string): string {
  const end = buf.lastIndexOf("\n");
  return end === -1 ? "" : buf.slice(0, end + 1);
}
