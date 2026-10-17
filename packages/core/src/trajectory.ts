import type { ReviewState } from "./entry.ts";

/**
 * Module 2: a project's trajectory. Tracks are branches of intent; nodes are
 * goals, milestones and stories on them. Every change is an append-only event,
 * so the state at any moment is `projectAt(events, t)`: the map, Replay and
 * the scope chart are all views of that one function.
 */

export type TrackStatus = "active" | "abandoned" | "merged";
export type NodeKind = "goal" | "milestone" | "story" | "pivot";
export type NodeStatus = "planned" | "in_progress" | "done" | "dropped" | "blocked";
export type NodeSource = "doc" | "session" | "plan" | "git" | "manual";

export interface Track {
  id: string;
  projectId: string;
  name: string;
  parentTrackId: string | null;
  /** Node on the parent track where this track forks off. */
  forkNodeId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface TNode {
  id: string;
  projectId: string;
  trackId: string;
  kind: NodeKind;
  /** Stable external id from the source (`H2`, `CH-014`), when there is one. */
  key: string | null;
  title: string;
  parentId: string | null;
  sort: number;
  /** One plain sentence for someone new to the project (goals and milestones). */
  explain: string | null;
  reviewState: ReviewState;
  source: NodeSource;
  createdAt: string;
}

/** What a newcomer needs to read the map: the project in a line, and its own jargon. */
export interface Primer {
  oneLiner: string;
  terms: { term: string; meaning: string }[];
}

export type TrajectoryEvent =
  | {
      id: number;
      at: string;
      type: "track_created";
      subjectId: string;
      value: null;
      source: NodeSource;
    }
  | {
      id: number;
      at: string;
      type: "track_status";
      subjectId: string;
      value: TrackStatus;
      source: NodeSource;
    }
  | {
      id: number;
      at: string;
      type: "node_created";
      subjectId: string;
      value: NodeStatus;
      source: NodeSource;
    }
  | {
      id: number;
      at: string;
      type: "node_status";
      subjectId: string;
      value: NodeStatus;
      source: NodeSource;
    };

export interface TrajectoryEvidence {
  kind: "quote" | "doc" | "commit";
  /** Session id, document path or commit SHA. */
  ref: string;
  excerpt: string;
  at: string;
}

export interface TrajectoryData {
  projectId: string;
  primer?: Primer | null;
  tracks: Track[];
  nodes: TNode[];
  events: TrajectoryEvent[];
}

export interface NodeState extends TNode {
  status: NodeStatus;
  statusAt: string;
}

export interface TrackState extends Track {
  status: TrackStatus;
}

export interface TrajectoryState {
  at: string;
  tracks: TrackState[];
  nodes: NodeState[];
}

/** Ordering for "status only moves forward" rules (dropped/blocked are explicit). */
export const STATUS_RANK: Record<NodeStatus, number> = {
  planned: 0,
  blocked: 1,
  in_progress: 2,
  done: 3,
  dropped: 3,
};

const byTime = (a: TrajectoryEvent, b: TrajectoryEvent) =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id;

/** The trajectory exactly as it was at time `t` (ISO string). */
export function projectAt(data: TrajectoryData, t: string): TrajectoryState {
  const trackStatus = new Map<string, TrackStatus>();
  const nodeStatus = new Map<string, { status: NodeStatus; at: string }>();
  for (const ev of [...data.events].sort(byTime)) {
    if (ev.at > t) break;
    switch (ev.type) {
      case "track_created":
        if (!trackStatus.has(ev.subjectId)) trackStatus.set(ev.subjectId, "active");
        break;
      case "track_status":
        trackStatus.set(ev.subjectId, ev.value);
        break;
      case "node_created":
      case "node_status":
        nodeStatus.set(ev.subjectId, { status: ev.value, at: ev.at });
        break;
    }
  }
  const tracks = data.tracks
    .filter((tr) => trackStatus.has(tr.id))
    .map((tr) => ({ ...tr, status: trackStatus.get(tr.id)! }));
  const live = new Set(tracks.map((tr) => tr.id));
  const nodes = data.nodes
    .filter((n) => nodeStatus.has(n.id) && live.has(n.trackId))
    .map((n) => {
      const s = nodeStatus.get(n.id)!;
      return { ...n, status: s.status, statusAt: s.at };
    })
    .sort((a, b) => a.sort - b.sort);
  return { at: t, tracks, nodes };
}

export function timeRange(data: TrajectoryData): { start: string; end: string } | null {
  if (!data.events.length) return null;
  const times = data.events.map((e) => e.at).sort();
  return { start: times[0]!, end: times.at(-1)! };
}

/** Planned work still in scope: stories (or milestones without stories) on live tracks, not dropped. */
export function scopeSize(state: TrajectoryState): { total: number; done: number } {
  const active = new Set(state.tracks.filter((t) => t.status === "active").map((t) => t.id));
  const onActive = state.nodes.filter((n) => active.has(n.trackId));
  // A milestone that ever had stories is measured by them, even if all were dropped.
  const parents = new Set(
    onActive.filter((n) => n.kind === "story" && n.parentId).map((n) => n.parentId),
  );
  const nodes = onActive.filter((n) => n.status !== "dropped");
  const units = nodes.filter(
    (n) => n.kind === "story" || (n.kind === "milestone" && !parents.has(n.id)),
  );
  return { total: units.length, done: units.filter((n) => n.status === "done").length };
}

export interface ScopePoint {
  at: string;
  total: number;
  done: number;
  /** The event that moved scope here, if it changed. */
  cause: TrajectoryEvent | null;
  delta: number;
}

/** Scope size after every event; `delta` is non-zero where scope grew or shrank. */
export function scopeSeries(data: TrajectoryData): ScopePoint[] {
  const times = [...new Set(data.events.map((e) => e.at))].sort();
  const points: ScopePoint[] = [];
  let prev = 0;
  for (const at of times) {
    const s = scopeSize(projectAt(data, at));
    const cause =
      data.events
        .filter((e) => e.at === at)
        .find(
          (e) => e.type === "track_status" || e.type === "node_created" || e.value === "dropped",
        ) ?? null;
    points.push({ at, total: s.total, done: s.done, cause, delta: s.total - prev });
    prev = s.total;
  }
  return points;
}

export interface MilestoneProgress {
  node: NodeState;
  done: number;
  total: number;
}

export interface Heading {
  track: TrackState | null;
  goal: NodeState | null;
  /** The milestone being worked on now, then the next ones. */
  milestones: MilestoneProgress[];
  now: { milestone: NodeState | null; story: NodeState | null };
  blocked: NodeState[];
  abandoned: TrackState[];
}

/** What the heading card shows: derived, never stored. */
export function heading(state: TrajectoryState, next = 3): Heading {
  const track =
    state.tracks
      .filter((t) => t.status === "active")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const onTrack = state.nodes.filter((n) => n.trackId === track?.id);
  const milestones = onTrack.filter((n) => n.kind === "milestone" && n.status !== "dropped");
  const progress = milestones.map((m) => {
    const stories = onTrack.filter((n) => n.parentId === m.id && n.status !== "dropped");
    const done = stories.length
      ? stories.filter((s) => s.status === "done").length
      : m.status === "done"
        ? 1
        : 0;
    return { node: m, done, total: stories.length || 1 };
  });
  const firstOpen = progress.findIndex((p) => p.node.status !== "done" && p.done < p.total);
  const upcoming = firstOpen === -1 ? [] : progress.slice(firstOpen, firstOpen + next);
  const nowMilestone = upcoming[0]?.node ?? null;
  const stories = onTrack.filter((n) => n.kind === "story" && n.parentId === nowMilestone?.id);
  const story =
    stories.find((s) => s.status === "in_progress") ??
    stories.find((s) => s.status === "planned" || s.status === "blocked") ??
    null;
  return {
    track,
    goal: onTrack.find((n) => n.kind === "goal") ?? null,
    milestones: upcoming,
    now: { milestone: nowMilestone, story },
    blocked: onTrack.filter((n) => n.status === "blocked"),
    abandoned: state.tracks.filter((t) => t.status === "abandoned"),
  };
}
