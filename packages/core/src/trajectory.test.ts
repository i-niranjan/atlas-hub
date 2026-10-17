import { describe, expect, it } from "vitest";
import {
  heading,
  projectAt,
  scopeSeries,
  scopeSize,
  type TNode,
  type Track,
  type TrajectoryData,
  type TrajectoryEvent,
} from "./trajectory.ts";

const track = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  projectId: "p",
  name: id,
  parentTrackId: null,
  forkNodeId: null,
  reason: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const node = (id: string, trackId: string, over: Partial<TNode> = {}): TNode => ({
  id,
  projectId: "p",
  trackId,
  kind: "story",
  key: null,
  title: id,
  parentId: null,
  sort: 0,
  reviewState: "confirmed",
  source: "doc",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

let seq = 0;
const ev = (at: string, type: TrajectoryEvent["type"], subjectId: string, value: unknown = null) =>
  ({
    id: ++seq,
    at: `2026-10-${at}T00:00:00.000Z`,
    type,
    subjectId,
    value,
    source: "doc",
  }) as TrajectoryEvent;

// A cloud plan abandoned on the 5th for a harness track; H0 has two stories.
const data: TrajectoryData = {
  projectId: "p",
  tracks: [
    track("cloud"),
    track("harness", { parentTrackId: "cloud", createdAt: "2026-10-05T00:00:00.000Z" }),
  ],
  nodes: [
    node("c1", "cloud", { kind: "milestone", sort: 0 }),
    node("goal", "harness", { kind: "goal", sort: -1 }),
    node("h0", "harness", { kind: "milestone", key: "H0", sort: 1 }),
    node("s1", "harness", { key: "CH-001", parentId: "h0", sort: 2 }),
    node("s2", "harness", { key: "CH-002", parentId: "h0", sort: 3 }),
    node("h1", "harness", { kind: "milestone", key: "H1", sort: 4 }),
    node("s3", "harness", { key: "CH-003", parentId: "h1", sort: 5 }),
  ],
  events: [
    ev("01", "track_created", "cloud"),
    ev("01", "node_created", "c1", "planned"),
    ev("05", "track_created", "harness"),
    ev("05", "track_status", "cloud", "abandoned"),
    ev("05", "node_created", "goal", "planned"),
    ev("05", "node_created", "h0", "planned"),
    ev("05", "node_created", "s1", "planned"),
    ev("05", "node_created", "s2", "planned"),
    ev("05", "node_created", "h1", "planned"),
    ev("05", "node_created", "s3", "planned"),
    ev("08", "node_status", "s1", "done"),
    ev("10", "node_status", "s2", "in_progress"),
    ev("12", "node_status", "s3", "dropped"),
  ],
};

const at = (d: string) => `2026-10-${d}T12:00:00.000Z`;

describe("projectAt", () => {
  it("shows only what existed at the time", () => {
    const s = projectAt(data, at("02"));
    expect(s.tracks.map((t) => [t.id, t.status])).toEqual([["cloud", "active"]]);
    expect(s.nodes.map((n) => n.id)).toEqual(["c1"]);
  });

  it("replays forks and status changes exactly", () => {
    const s = projectAt(data, at("09"));
    expect(s.tracks.map((t) => [t.id, t.status])).toEqual([
      ["cloud", "abandoned"],
      ["harness", "active"],
    ]);
    expect(s.nodes.find((n) => n.id === "s1")!.status).toBe("done");
    expect(s.nodes.find((n) => n.id === "s2")!.status).toBe("planned");
  });

  it("ignores event order in storage", () => {
    const shuffled = { ...data, events: [...data.events].reverse() };
    expect(projectAt(shuffled, at("10"))).toEqual(projectAt(data, at("10")));
  });
});

describe("scope", () => {
  it("counts stories on active tracks, excluding dropped", () => {
    expect(scopeSize(projectAt(data, at("09")))).toEqual({ total: 3, done: 1 });
    expect(scopeSize(projectAt(data, at("13")))).toEqual({ total: 2, done: 1 });
  });

  it("marks where scope grew and shrank", () => {
    const series = scopeSeries(data);
    const deltas = series.filter((p) => p.delta !== 0).map((p) => [p.at.slice(8, 10), p.delta]);
    expect(deltas).toEqual([
      ["01", 1],
      ["05", 2],
      ["12", -1],
    ]);
  });
});

describe("heading", () => {
  it("finds the current milestone, active story and abandoned tracks", () => {
    const h = heading(projectAt(data, at("11")));
    expect(h.track?.id).toBe("harness");
    expect(h.goal?.id).toBe("goal");
    expect(h.now.milestone?.key).toBe("H0");
    expect(h.now.story?.key).toBe("CH-002");
    expect(h.milestones.map((m) => [m.node.key, m.done, m.total])).toEqual([
      ["H0", 1, 2],
      ["H1", 0, 1],
    ]);
    expect(h.abandoned.map((t) => t.id)).toEqual(["cloud"]);
  });
});
