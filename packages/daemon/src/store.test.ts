import { openDb } from "./db.ts";
import type { Entry } from "@atlas/core";
import { describe, expect, it } from "vitest";
import { ftsQuery, Store } from "./store.ts";
import { memoryStore, NOW, seedProject } from "./test-helpers.ts";

const entry = (id: string, projectId: string, over: Partial<Entry> = {}): Entry => ({
  id,
  projectId,
  kind: "decision",
  title: "Use Tauri for the desktop shell",
  summary: "Native window at small size.",
  rationale: "Native feel; adds a Rust toolchain.",
  alternatives: [],
  status: "active",
  supersedesId: null,
  confidence: 0.9,
  reviewState: "confirmed",
  evidence: [{ sessionId: "s", messageUuid: "m", quote: "Tauri 2 + React" }],
  decidedAt: NOW,
  createdAt: NOW,
  ...over,
});

describe("Store", () => {
  it("derives stable project ids from name and path", () => {
    const s = memoryStore();
    const a = seedProject(s, "/x/atlas", "atlas");
    const b = s.upsertProject({ name: "atlas", rootPath: "/x/atlas", gitRemote: "git@x" }, NOW);
    expect(a.id).toBe(b.id);
    expect(b.gitRemote).toBe("git@x");
  });

  it("finds entries with full-text search, prefix matching and stemming", () => {
    const s = memoryStore();
    const p = seedProject(s);
    s.saveEntry(entry("e1", p.id), "extracted");
    s.saveEntry(
      entry("e2", p.id, { title: "Store data in SQLite", summary: "Local database." }),
      "extracted",
    );
    expect(s.search("taur").map((e) => e.id)).toEqual(["e1"]);
    expect(s.search("databases").map((e) => e.id)).toEqual(["e2"]);
    expect(s.search("")).toEqual([]);
  });

  it("keeps FTS in sync on update and hides dismissed entries", () => {
    const s = memoryStore();
    const p = seedProject(s);
    s.saveEntry(entry("e1", p.id), "extracted");
    s.saveEntry(entry("e1", p.id, { title: "Use Electron instead" }), "extracted");
    expect(s.search("electron")).toHaveLength(1);
    expect(s.search("tauri")).toHaveLength(0);
    s.setReview("e1", "dismissed");
    expect(s.search("electron")).toHaveLength(0);
    expect(s.listProjects()[0]!.counts.total).toBe(0);
  });

  it("returns the whole lineage from any entry in the chain", () => {
    const s = memoryStore();
    const p = seedProject(s);
    s.saveEntry(entry("a", p.id, { status: "superseded" }), "extracted");
    s.saveEntry(
      entry("b", p.id, { kind: "pivot", supersedesId: "a", status: "superseded" }),
      "extracted",
    );
    s.saveEntry(entry("c", p.id, { kind: "pivot", supersedesId: "b" }), "extracted");
    for (const id of ["a", "b", "c"])
      expect(s.lineage(id).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(s.entryDetail("b")!.supersededBy?.id).toBe("c");
  });

  it("stops tracking a project's folders, hides it, and can restore it", () => {
    const s = memoryStore();
    const p = seedProject(s, "/w/noise", "noise");
    s.saveEntry(entry("e1", p.id), "extracted");
    s.ignoreProject(p.id, false, NOW);
    expect(s.listProjects()).toEqual([]);
    expect(s.isIgnored("/w/noise")).toBe(true);
    expect(s.isIgnored("/w/noise/sub/dir")).toBe(true);
    expect(s.isIgnored("/w/noisemaker")).toBe(false);
    expect(s.getEntry("e1")).not.toBeNull();
    expect(s.restoreIgnored("/w/noise")).toBe(p.id);
    expect(s.listProjects().map((x) => x.id)).toEqual([p.id]);
    expect(s.isIgnored("/w/noise")).toBe(false);
  });

  it("always ignores temp folders and app scratch workspaces", () => {
    const s = new Store(openDb(":memory:"));
    expect(s.isIgnored("/private/tmp/x")).toBe(true);
    expect(s.isIgnored("/tmp")).toBe(true);
    expect(s.isIgnored("/var/folders/ab/T/y")).toBe(true);
    expect(s.isIgnored("/Users/me/Library/Application Support/Claude/scratch-workspaces/a")).toBe(
      true,
    );
    expect(s.isIgnored("/Users/me/WORK/app")).toBe(false);
  });

  it("can delete a project's data when it stops being tracked", () => {
    const s = memoryStore();
    const p = seedProject(s, "/w/noise", "noise");
    s.saveEntry(entry("e1", p.id), "extracted");
    s.ignoreProject(p.id, true, NOW);
    expect(s.getEntry("e1")).toBeNull();
  });

  it("sanitises free text into a safe FTS query", () => {
    expect(ftsQuery('why "tauri"? (OR) -- drop')).toBe('"why"* OR "tauri"* OR "or"* OR "drop"*');
    expect(ftsQuery("!!")).toBeNull();
  });
});
