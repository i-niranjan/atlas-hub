import { describe, expect, it } from "vitest";
import { adrEntryId, importAdrs } from "./adr.ts";
import { REPO_ROOT } from "./install.ts";
import { memoryStore, NOW, seedProject } from "./test-helpers.ts";

describe("importAdrs", () => {
  it("imports Atlas's own decision records (dogfooding)", () => {
    const store = memoryStore();
    const project = seedProject(store, REPO_ROOT, "atlas");
    const res = importAdrs(store, project, NOW);
    expect(res.errors).toEqual([]);
    expect(res.imported.length).toBeGreaterThanOrEqual(9);

    const tauri = store.getEntry(adrEntryId(project.id, "0002"))!;
    expect(tauri.title).toMatch(/Tauri/);
    expect(tauri.source).toBe("adr");
    expect(tauri.alternatives.map((a) => a.option)).toEqual(["Native SwiftUI", "Electron"]);
    expect(tauri.evidence[0]!.quote).toBe("Tauri 2 + React (Recommended)");

    const ts = store.getEntry(adrEntryId(project.id, "0009"))!;
    expect(ts.kind).toBe("constraint");
    expect(ts.reviewState).toBe("confirmed");
  });

  it("is idempotent", () => {
    const store = memoryStore();
    const project = seedProject(store, REPO_ROOT, "atlas");
    importAdrs(store, project, NOW);
    const before = store.listEntries({ projectId: project.id }).length;
    importAdrs(store, project, NOW);
    expect(store.listEntries({ projectId: project.id })).toHaveLength(before);
  });

  it("does nothing for projects without decision records", () => {
    const store = memoryStore();
    expect(importAdrs(store, seedProject(store, "/nonexistent"), NOW).imported).toEqual([]);
  });
});
