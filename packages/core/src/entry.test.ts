import { describe, expect, it } from "vitest";
import { Entry, isKnownKind } from "./entry.ts";

const base = {
  id: "e_2",
  projectId: "p_atlas",
  kind: "decision",
  title: "Use Tauri 2 for the desktop shell",
  summary: "Native macOS window and vibrancy at ~10 MB, with React for the AG-UI renderer.",
  rationale: "Trades a Rust toolchain dependency for native feel without Electron's footprint.",
  status: "active",
  supersedesId: null,
  confidence: 0.92,
  reviewState: "confirmed",
  evidence: [{ sessionId: "s_1", messageUuid: "m_1", quote: "Tauri 2 + React (Recommended)" }],
  decidedAt: "2026-10-17T15:00:00.000Z",
  createdAt: "2026-10-17T15:00:00.000Z",
};

describe("Entry", () => {
  it("accepts a well-formed entry and defaults alternatives", () => {
    const parsed = Entry.parse(base);
    expect(parsed.alternatives).toEqual([]);
  });

  it("rejects an entry without evidence", () => {
    expect(Entry.safeParse({ ...base, evidence: [] }).success).toBe(false);
  });

  it("rejects summaries over the length cap", () => {
    expect(Entry.safeParse({ ...base, summary: "x".repeat(141) }).success).toBe(false);
  });

  it("requires a pivot to name what it supersedes", () => {
    expect(Entry.safeParse({ ...base, kind: "pivot" }).success).toBe(false);
    expect(Entry.safeParse({ ...base, kind: "pivot", supersedesId: "e_1" }).success).toBe(true);
  });

  it("rejects self-supersession", () => {
    expect(Entry.safeParse({ ...base, supersedesId: "e_2" }).success).toBe(false);
  });

  it("allows unknown snake_case kinds but rejects malformed ones", () => {
    expect(Entry.safeParse({ ...base, kind: "migration_plan" }).success).toBe(true);
    expect(Entry.safeParse({ ...base, kind: "Bad Kind" }).success).toBe(false);
    expect(isKnownKind("migration_plan")).toBe(false);
    expect(isKnownKind("pivot")).toBe(true);
  });
});
