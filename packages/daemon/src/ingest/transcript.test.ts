import { describe, expect, it } from "vitest";
import { line } from "../test-helpers.ts";
import { cleanText, completeLines, parseTranscript } from "./transcript.ts";

describe("parseTranscript", () => {
  const jsonl = [
    JSON.stringify({ type: "permission-mode", permissionMode: "auto", sessionId: "sess-1" }),
    line.user("Should we use SQLite or Postgres?"),
    line.user("<system-reminder>internal</system-reminder>meta", { isMeta: true }),
    line.assistant([
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: "Two options." },
      {
        type: "tool_use",
        id: "toolu_q",
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which database?",
              options: [
                { label: "SQLite (Recommended)", description: "Local, zero ops" },
                { label: "Postgres", description: "Server needed" },
              ],
            },
          ],
        },
      },
    ]),
    line.toolResult("toolu_q", 'User answered: "Which database?"="SQLite (Recommended)"'),
    line.assistant([{ type: "tool_use", id: "toolu_b", name: "Bash", input: { command: "ls" } }]),
    line.toolResult("toolu_b", "file-a file-b"),
    line.assistant([{ type: "text", text: "subagent chatter" }], { isSidechain: true }),
    line.title("Database choice"),
    line.user("<system-reminder>ignore me</system-reminder>Go with it."),
  ].join("\n");

  const parsed = parseTranscript(jsonl);

  it("reads session metadata", () => {
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.title).toBe("Database choice");
    expect(parsed.cwd).toBe("/tmp/demo");
  });

  it("keeps user, assistant and choice turns and drops noise", () => {
    expect(parsed.turns.map((t) => t.role)).toEqual(["user", "assistant", "choice", "user"]);
  });

  it("renders AskUserQuestion options so alternatives are visible", () => {
    const asked = parsed.turns[1]!.text;
    expect(asked).toContain("Asked: Which database?");
    expect(asked).toContain("Postgres: Server needed");
  });

  it("records the answer as a choice, but not ordinary tool output", () => {
    expect(parsed.turns[2]!.text).toContain('"SQLite (Recommended)"');
    expect(parsed.turns.some((t) => t.text.includes("file-a"))).toBe(false);
  });

  it("strips system reminders and skips sidechains and meta lines", () => {
    expect(parsed.turns[3]!.text).toBe("Go with it.");
    expect(parsed.turns.some((t) => t.text.includes("subagent"))).toBe(false);
    expect(parsed.turns.some((t) => t.text.includes("meta"))).toBe(false);
  });

  it("survives malformed lines", () => {
    expect(parseTranscript(`not json\n${line.user("hi")}`).turns).toHaveLength(1);
  });
});

describe("completeLines", () => {
  it("drops a trailing partial line", () => {
    expect(completeLines('{"a":1}\n{"b":')).toBe('{"a":1}\n');
    expect(completeLines('{"b":')).toBe("");
  });
});

describe("cleanText", () => {
  it("removes command wrapper tags", () => {
    expect(cleanText("<command-name>/clear</command-name>\nreal text")).toBe("real text");
  });
});
