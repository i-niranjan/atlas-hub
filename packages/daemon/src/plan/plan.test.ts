import { heading, projectAt } from "@atlas/core";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Turn } from "../ingest/transcript.ts";
import { memoryStore, NOW, seedProject, tempDir } from "../test-helpers.ts";
import { attributePlan, findDocs, type Doc } from "./docs.ts";
import { missingKeys, type PlanExtraction } from "./extract.ts";
import { applyCommits, keyPattern, readCommits, referencedForeignKeys } from "./git.ts";
import { advances, applyPlan } from "./reconcile.ts";
import { applyProgress, renderTrajectory } from "./session.ts";
import { TrajectoryStore } from "./store.ts";

const docs: Doc[] = [
  {
    path: "/p/backlog.md",
    label: "backlog.md",
    text: "Coding harness backlog. H0 Reproducible foundation. CH-001 Pin the toolchain. CH-002 Model round-trip. H1 Read-only agent. CH-003 Read tools. Status: CH-001 done.",
    modifiedAt: "2026-10-10T00:00:00.000Z",
    supersededHint: false,
  },
  {
    path: "/p/archive/cloud.md",
    label: "archive/cloud.md",
    text: "Original plan: Python FastAPI cloud service. Phase 1 API skeleton. Superseded by the harness plan.",
    modifiedAt: "2026-10-02T00:00:00.000Z",
    supersededHint: true,
  },
];

const q = (path: string, quote: string) => ({ path, quote });

function extraction(over: Partial<PlanExtraction> = {}): PlanExtraction {
  return {
    docs: [
      { path: "backlog.md", role: "current", date: "2026-10-05" },
      { path: "archive/cloud.md", role: "superseded", date: null },
    ],
    tracks: [
      {
        ref: "cloud",
        name: "Python cloud platform",
        status: "abandoned",
        reason: "Superseded by the harness plan",
        forkedFromRef: null,
        evidence: q("archive/cloud.md", "Python FastAPI cloud service"),
      },
      {
        ref: "h",
        name: "Coding harness",
        status: "active",
        reason: null,
        forkedFromRef: "cloud",
        evidence: q("backlog.md", "Coding harness backlog"),
      },
    ],
    nodes: [
      {
        ref: "c1",
        existingId: null,
        trackRef: "cloud",
        kind: "milestone",
        key: null,
        title: "API skeleton",
        parentRef: null,
        status: "planned",
        evidence: q("archive/cloud.md", "Phase 1 API skeleton"),
      },
      {
        ref: "h0",
        existingId: null,
        trackRef: "h",
        kind: "milestone",
        key: "H0",
        title: "Reproducible foundation",
        parentRef: null,
        status: "planned",
        evidence: q("backlog.md", "H0 Reproducible foundation"),
      },
      {
        ref: "s1",
        existingId: null,
        trackRef: "h",
        kind: "story",
        key: "CH-001",
        title: "Pin the toolchain",
        parentRef: "h0",
        status: "done",
        evidence: q("backlog.md", "CH-001 done"),
      },
      {
        ref: "s2",
        existingId: null,
        trackRef: "h",
        kind: "story",
        key: "CH-002",
        title: "Model round-trip",
        parentRef: "h0",
        status: "planned",
        evidence: q("backlog.md", "CH-002 Model round-trip"),
      },
      {
        ref: "h1",
        existingId: null,
        trackRef: "h",
        kind: "milestone",
        key: "H1",
        title: "Read-only agent",
        parentRef: null,
        status: "planned",
        evidence: q("backlog.md", "H1 Read-only agent"),
      },
      {
        ref: "s3",
        existingId: null,
        trackRef: "h",
        kind: "story",
        key: "CH-003",
        title: "Read tools",
        parentRef: "h1",
        status: "planned",
        evidence: q("backlog.md", "CH-003 Read tools"),
      },
      {
        ref: "fake",
        existingId: null,
        trackRef: "h",
        kind: "story",
        key: "CH-099",
        title: "Invented work",
        parentRef: "h1",
        status: "planned",
        evidence: q("backlog.md", "CH-099 something that is not there"),
      },
    ],
    ...over,
  };
}

function setup() {
  const store = memoryStore();
  const project = seedProject(store);
  const t = new TrajectoryStore(store.db);
  return { store, project, t };
}

describe("applyPlan", () => {
  it("builds tracks, a fork with a pivot node, and nested stories; drops invented quotes", () => {
    const { project, t } = setup();
    const res = applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    expect(res.rejected.map((r) => r.title)).toEqual(["Invented work"]);
    const state = projectAt(t.data(project.id), NOW);
    expect(state.tracks.map((tr) => [tr.name, tr.status])).toEqual([
      ["Python cloud platform", "abandoned"],
      ["Coding harness", "active"],
    ]);
    const harness = state.tracks[1]!;
    expect(harness.parentTrackId).toBe(state.tracks[0]!.id);
    expect(harness.reason).toBe("Superseded by the harness plan");
    expect(state.nodes.find((n) => n.kind === "pivot")?.title).toBe("Switched to Coding harness");
    const h = heading(state);
    expect(h.now.milestone?.key).toBe("H0");
    expect(h.now.story?.key).toBe("CH-002");
  });

  it("dates a replaced plan before its successor and keeps its items planned", () => {
    const { project, t } = setup();
    const x = extraction();
    // The model marks the old plan's milestone dropped and dates it after the new plan.
    x.nodes[0] = { ...x.nodes[0]!, status: "dropped" };
    x.docs[1] = { ...x.docs[1]!, date: "2026-10-20" };
    applyPlan(x, { store: t, projectId: project.id, docs, now: NOW });
    const data = t.data(project.id);
    const cloud = data.tracks.find((tr) => tr.name === "Python cloud platform")!;
    const harness = data.tracks.find((tr) => tr.name === "Coding harness")!;
    expect(cloud.createdAt < harness.createdAt).toBe(true);
    const c1 = data.nodes.find((n) => n.trackId === cloud.id && n.kind === "milestone")!;
    expect(t.currentStatus(c1.id)).toBe("planned");
    expect(c1.createdAt >= cloud.createdAt).toBe(true);
  });

  it("uses the document's stated date for when the plan appeared", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const h0 = t.data(project.id).nodes.find((n) => n.key === "H0")!;
    expect(h0.createdAt).toBe("2026-10-05T00:00:00.000Z");
  });

  it("is idempotent and never moves status backwards", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const before = t.data(project.id);
    // Re-run where the docs now (wrongly) say CH-001 is only planned.
    const again = extraction();
    again.nodes[2] = { ...again.nodes[2]!, status: "planned" };
    applyPlan(again, { store: t, projectId: project.id, docs, now: NOW });
    const after = t.data(project.id);
    expect(after.nodes).toHaveLength(before.nodes.length);
    expect(after.events).toHaveLength(before.events.length);
    expect(t.currentStatus(after.nodes.find((n) => n.key === "CH-001")!.id)).toBe("done");
  });

  it("matches renamed items by key instead of duplicating them", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const renamed = extraction();
    renamed.nodes[3] = { ...renamed.nodes[3]!, title: "Model and tool round-trip" };
    applyPlan(renamed, { store: t, projectId: project.id, docs, now: NOW });
    const ch2 = t.data(project.id).nodes.filter((n) => n.key === "CH-002");
    expect(ch2.map((n) => n.title)).toEqual(["Model and tool round-trip"]);
  });
});

describe("missingKeys", () => {
  it("finds ids the current docs define but the extraction skipped, ignoring archives", () => {
    const d: Doc[] = [
      { ...docs[0]!, text: "CH-001 a. CH-001 done. CH-007 b. CH-007 c. CH-009 mentioned once." },
      { ...docs[1]!, text: "OLD-001 x. OLD-001 y." },
    ];
    expect(missingKeys(d, extraction())).toEqual(["CH-007"]);
  });
});

describe("advances", () => {
  it("only moves forward, except explicit drops and blocks", () => {
    expect(advances("planned", "done")).toBe(true);
    expect(advances("done", "in_progress")).toBe(false);
    expect(advances("done", "dropped")).toBe(true);
    expect(advances("dropped", "done")).toBe(false);
    expect(advances(null, "planned")).toBe(true);
  });
});

describe("git", () => {
  it("matches keys exactly and marks recorded evidence as done", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const changed = applyCommits(t, project.id, [
      {
        sha: "a1",
        at: "2026-10-11T10:00:00.000Z",
        subject: "feat(model): wire round-trip for CH-002",
      },
      { sha: "a2", at: "2026-10-12T10:00:00.000Z", subject: "docs: record ch-002 evidence" },
      { sha: "a3", at: "2026-10-12T11:00:00.000Z", subject: "chore: bump CH-0021 unrelated" },
    ]);
    expect(changed).toBe(2);
    const ch2 = t.data(project.id).nodes.find((n) => n.key === "CH-002")!;
    expect(t.currentStatus(ch2.id)).toBe("done");
    expect(
      t
        .evidence(ch2.id)
        .filter((e) => e.kind === "commit")
        .map((e) => e.ref),
    ).toEqual(["a1", "a2"]);
    expect(t.history(ch2.id).at(-1)!.at).toBe("2026-10-12T10:00:00.000Z");
  });

  it("builds a longest-first key pattern", () => {
    const p = keyPattern([{ key: "CH-01" }, { key: "CH-014" }, { key: "weird key" }] as never)!;
    expect("did CH-014".match(p)).toEqual(["CH-014"]);
  });

  it("spots commits that reference another project's plan", () => {
    const hits = referencedForeignKeys(
      [{ sha: "x", at: NOW, subject: "docs: record ch-003 evidence" }],
      new Set(),
      new Map([["ch-003", "p_docs"]]),
    );
    expect([...hits]).toEqual([["p_docs", "docs: record ch-003 evidence"]]);
  });

  it("reads real git history", () => {
    const dir = tempDir();
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    git("init", "-q");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first CH-001",
    );
    const commits = readCommits(dir, null);
    expect(commits.map((c) => c.subject)).toEqual(["first CH-001"]);
    expect(readCommits(dir, commits[0]!.sha)).toEqual([]);
  });
});

describe("session progress", () => {
  const turns: Turn[] = [
    {
      uuid: "u1",
      role: "user",
      text: "CH-002 is done, tests pass. Also add a retry story.",
      timestamp: "2026-10-13T09:00:00.000Z",
    },
    {
      uuid: "a1",
      role: "assistant",
      text: "I think CH-003 has started.",
      timestamp: "2026-10-13T09:01:00.000Z",
    },
    {
      uuid: "u2",
      role: "user",
      text: "We're dropping the harness and building a VS Code extension instead, because users live in the editor.",
      timestamp: "2026-10-13T10:00:00.000Z",
    },
  ];

  it("moves stories, adds scope, and leaves assistant-only claims unconfirmed", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const nodes = t.data(project.id).nodes;
    const id = (k: string) => nodes.find((n) => n.key === k)!.id;
    const n = applyProgress(
      [
        {
          action: "done",
          nodeId: id("CH-002"),
          title: "",
          milestoneId: null,
          reason: null,
          confidence: 0.9,
          evidence: [{ turnUuid: "u1", quote: "CH-002 is done, tests pass" }],
        },
        {
          action: "started",
          nodeId: id("CH-003"),
          title: "",
          milestoneId: null,
          reason: null,
          confidence: 0.9,
          evidence: [{ turnUuid: "a1", quote: "CH-003 has started" }],
        },
        {
          action: "added",
          nodeId: null,
          title: "Retry failed model calls",
          milestoneId: id("H0"),
          reason: null,
          confidence: 0.9,
          evidence: [{ turnUuid: "u1", quote: "add a retry story" }],
        },
        {
          action: "done",
          nodeId: id("CH-001"),
          title: "",
          milestoneId: null,
          reason: null,
          confidence: 0.9,
          evidence: [{ turnUuid: "u1", quote: "not in the transcript" }],
        },
      ],
      {
        store: t,
        projectId: project.id,
        sessionId: "s",
        newTurns: turns,
        now: "2026-10-13T12:00:00.000Z",
      },
    );
    expect(n.changes).toBe(3);
    expect(t.currentStatus(id("CH-002"))).toBe("done");
    expect(t.node(id("CH-003"))!.reviewState).toBe("needs_review");
    const added = t.data(project.id).nodes.find((x) => x.title === "Retry failed model calls")!;
    expect(added.parentId).toBe(id("H0"));
    expect(added.source).toBe("session");
  });

  it("forks a new direction on an explicit pivot, with the reason", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    applyProgress(
      [
        {
          action: "pivot",
          nodeId: null,
          title: "VS Code extension",
          milestoneId: null,
          reason: "users live in the editor",
          confidence: 0.95,
          evidence: [{ turnUuid: "u2", quote: "building a VS Code extension instead" }],
        },
      ],
      {
        store: t,
        projectId: project.id,
        sessionId: "s",
        newTurns: turns,
        now: "2026-10-13T12:00:00.000Z",
      },
    );
    const state = projectAt(t.data(project.id), "2026-10-13T12:00:00.000Z");
    expect(state.tracks.map((tr) => [tr.name, tr.status])).toEqual([
      ["Python cloud platform", "abandoned"],
      ["Coding harness", "abandoned"],
      ["VS Code extension", "active"],
    ]);
    expect(heading(state).track?.name).toBe("VS Code extension");
  });

  it("renders the active direction for the extractor", () => {
    const { project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const text = renderTrajectory(t.data(project.id), NOW)!;
    expect(text).toMatch(/^Active direction: Coding harness/);
    expect(text).toContain("| CH-002 | Model round-trip | planned");
  });
});

describe("cross-project progress", () => {
  it("updates another project's roadmap when the session was shown it", () => {
    const { store, project, t } = setup();
    applyPlan(extraction(), { store: t, projectId: project.id, docs, now: NOW });
    const elsewhere = seedProject(store, "/tmp/elsewhere", "elsewhere");
    const id = t.data(project.id).nodes.find((n) => n.key === "CH-002")!.id;
    const item = {
      action: "done" as const,
      nodeId: id,
      title: "",
      milestoneId: null,
      reason: null,
      confidence: 0.9,
      evidence: [{ turnUuid: "u1", quote: "CH-002 is done" }],
    };
    const turns: Turn[] = [{ uuid: "u1", role: "user", text: "CH-002 is done", timestamp: NOW }];
    const ctx = { store: t, projectId: elsewhere.id, sessionId: "s", newTurns: turns, now: NOW };
    expect(applyProgress([item], ctx).changes).toBe(0);
    const res = applyProgress([item], { ...ctx, projectIds: [elsewhere.id, project.id] });
    expect(res).toEqual({ changes: 1, projects: [project.id] });
  });
});

describe("docs discovery", () => {
  it("skips nested projects and instruction files; git repos contribute only plan docs", () => {
    const root = tempDir();
    const w = (p: string, s = "x") => {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), s);
    };
    w("plan/roadmap.md");
    w("AGENTS.md");
    w("archive/old.md");
    w("other-project/START-HERE.md");
    w("other-project/plan.md");
    w("repo/.git/HEAD");
    w("repo/README.md");
    w("repo/src/notes.md");
    const found = findDocs(root)
      .map((p) => p.slice(root.length + 1))
      .sort();
    expect(found).toEqual(["archive/old.md", "plan/roadmap.md"]);
    expect(findDocs(join(root, "repo")).map((p) => p.slice(root.length + 1))).toEqual([
      "repo/README.md",
    ]);
  });

  it("attributes a Claude plan to the project it names", () => {
    const store = memoryStore();
    const atlas = seedProject(store, "/Users/x/WORK/atlas", "atlas");
    const other = seedProject(store, "/Users/x/WORK/other", "other");
    expect(
      attributePlan("Repo at ~/WORK/atlas, monorepo layout (`~/WORK/atlas`)", [atlas, other])?.id,
    ).toBe(atlas.id);
    expect(attributePlan("nothing relevant", [atlas, other])).toBeNull();
  });
});

describe("linking projects", () => {
  it("folds a code repo into its plan's project, including future sessions there", () => {
    const store = memoryStore();
    const docsP = seedProject(store, "/w/swarm", "swarm");
    const code = seedProject(store, "/w/ant-cli", "ant-cli");
    store.upsertSession({ id: "s1", projectId: code.id, transcriptPath: "/t", title: null });
    store.linkProjects(docsP.id, code.id);
    expect(store.getProject(code.id)).toBeNull();
    expect(store.getSession("s1")!.projectId).toBe(docsP.id);
    expect(store.rootsOf(docsP.id).map((r) => [r.path, r.role])).toEqual([
      ["/w/swarm", "primary"],
      ["/w/ant-cli", "linked"],
    ]);
    // A new session in the code folder now lands in the linked project.
    expect(
      store.upsertProject({ name: "ant-cli", rootPath: "/w/ant-cli", gitRemote: null }, NOW).id,
    ).toBe(docsP.id);
  });
});
