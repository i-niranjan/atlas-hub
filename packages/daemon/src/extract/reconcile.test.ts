import { beforeEach, describe, expect, it } from "vitest";
import type { Turn } from "../ingest/transcript.ts";
import type { Store } from "../store.ts";
import { memoryStore, NOW, seedProject } from "../test-helpers.ts";
import { reconcile, type ReconcileContext } from "./reconcile.ts";
import type { Candidate } from "./schema.ts";
import { normalise, verifyEvidence } from "./verify.ts";

const turns: Turn[] = [
  {
    uuid: "u1",
    role: "user",
    text: "Let's use **SQLite** for storage — it's local.",
    timestamp: "2026-10-17T10:00:00.000Z",
  },
  {
    uuid: "a1",
    role: "assistant",
    text: "I'll pin TypeScript to 6.0 for lint support.",
    timestamp: "2026-10-17T10:01:00.000Z",
  },
  {
    uuid: "u2",
    role: "user",
    text: "Actually switch to Postgres, we need concurrent writers.",
    timestamp: "2026-10-17T11:00:00.000Z",
  },
];

const candidate = (over: Partial<Candidate>): Candidate => ({
  action: "new",
  targetId: null,
  projectRoot: null,
  kind: "decision",
  title: "Use SQLite for storage",
  summary: "SQLite keeps storage local with zero operations.",
  rationale: "Local-first and simple; gives up concurrent multi-writer access.",
  alternatives: [],
  confidence: 0.92,
  evidence: [{ turnUuid: "u1", quote: "Let's use SQLite for storage" }],
  ...over,
});

describe("verifyEvidence", () => {
  it("matches across markdown, dashes and case", () => {
    expect(normalise("Let's use **SQLite** — ok")).toBe(normalise("let's use sqlite - ok"));
    const ok = verifyEvidence([{ turnUuid: "u1", quote: "it's local" }], turns, "s");
    expect(ok).toHaveLength(1);
  });

  it("re-points a quote attributed to the wrong turn and drops invented ones", () => {
    const res = verifyEvidence(
      [
        { turnUuid: "u2", quote: "use SQLite for storage" },
        { turnUuid: "u1", quote: "we chose MongoDB" },
      ],
      turns,
      "s",
    );
    expect(res).toHaveLength(1);
    expect(res[0]!.messageUuid).toBe("u1");
  });
});

describe("reconcile", () => {
  let store: Store;
  let ctx: ReconcileContext;

  beforeEach(() => {
    store = memoryStore();
    const project = seedProject(store);
    ctx = {
      store,
      sessionId: "sess-1",
      sessionProject: project,
      newTurns: turns,
      shownIds: new Set(),
      resolveProjectRoot: () => null,
      now: NOW,
    };
  });

  it("saves a user-backed, confident decision as confirmed", () => {
    const out = reconcile([candidate({})], ctx);
    expect(out.saved).toHaveLength(1);
    const e = store.getEntry(out.saved[0]!)!;
    expect(e.reviewState).toBe("confirmed");
    expect(e.decidedAt).toBe("2026-10-17T10:00:00.000Z");
  });

  it("rejects entries whose quotes are not in the transcript", () => {
    const out = reconcile(
      [candidate({ evidence: [{ turnUuid: "u1", quote: "we picked Mongo" }] })],
      ctx,
    );
    expect(out.saved).toHaveLength(0);
    expect(out.rejected[0]!.reason).toMatch(/evidence/);
  });

  it("marks assistant-only decisions for review", () => {
    const out = reconcile(
      [
        candidate({
          title: "Pin TypeScript 6.0",
          kind: "constraint",
          evidence: [{ turnUuid: "a1", quote: "pin TypeScript to 6.0" }],
        }),
      ],
      ctx,
    );
    expect(store.getEntry(out.saved[0]!)!.reviewState).toBe("needs_review");
  });

  it("links a pivot to the decision it supersedes and retires the old one", () => {
    const first = reconcile([candidate({})], ctx).saved[0]!;
    ctx.shownIds = new Set([first]);
    const pivot = reconcile(
      [
        candidate({
          action: "supersedes",
          targetId: first,
          kind: "pivot",
          title: "Switch storage to Postgres",
          summary: "Postgres replaces SQLite to support concurrent writers.",
          evidence: [{ turnUuid: "u2", quote: "switch to Postgres, we need concurrent writers" }],
        }),
      ],
      ctx,
    ).saved[0]!;
    expect(store.getEntry(first)!.status).toBe("superseded");
    expect(store.getEntry(pivot)!.supersedesId).toBe(first);
    expect(store.lineage(first).map((e) => e.id)).toEqual([first, pivot]);
  });

  it("merges duplicates as extra evidence instead of a near-copy", () => {
    const first = reconcile([candidate({})], ctx).saved[0]!;
    ctx.shownIds = new Set([first]);
    const out = reconcile(
      [
        candidate({
          action: "duplicate",
          targetId: first,
          evidence: [{ turnUuid: "u1", quote: "it's local" }],
        }),
      ],
      ctx,
    );
    expect(out.saved).toHaveLength(0);
    expect(out.merged).toEqual([first]);
    expect(store.getEntry(first)!.evidence).toHaveLength(2);
  });

  it("downgrades a pivot with no valid target to a plain decision needing review", () => {
    const out = reconcile(
      [candidate({ action: "supersedes", targetId: "e_made_up", kind: "pivot" })],
      ctx,
    );
    const e = store.getEntry(out.saved[0]!)!;
    expect(e.kind).toBe("decision");
    expect(e.supersedesId).toBeNull();
    expect(e.reviewState).toBe("needs_review");
  });

  it("files an entry under another project when the model names a real folder", () => {
    const other = seedProject(store, "/tmp/other", "other");
    ctx.resolveProjectRoot = (root) => (root === "/tmp/other" ? other : null);
    const out = reconcile([candidate({ projectRoot: "/tmp/other" })], ctx);
    expect(store.getEntry(out.saved[0]!)!.projectId).toBe(other.id);
  });

  it("rejects summaries over the length cap rather than storing sloppy text", () => {
    const out = reconcile([candidate({ summary: "x".repeat(200) })], ctx);
    expect(out.saved).toHaveLength(0);
  });
});
