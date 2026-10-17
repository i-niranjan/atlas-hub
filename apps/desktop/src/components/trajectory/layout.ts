import type { NodeState, TrackState, TrajectoryState } from "@atlas/core";

/**
 * Subway-map layout. x is "story order": finished work by when it finished,
 * then current and planned work in plan order. Each track gets a lane; a track
 * that replaced another forks down from where the old one stopped.
 *
 * Positions are computed from the *latest* state so Replay never moves things:
 * at an earlier time, nodes only appear, fill or fade in place.
 */

export const LANE_GAP = 92;
export const TOP = 58;
export const LEFT = 36;
/** Wide enough for a station label (key + ~20 characters) so labels never collide. */
const STATION_GAP = 112;
const STORY_GAP = 21;
const FORK_GAP = 44;

export interface Station {
  node: NodeState;
  x: number;
  y: number;
  stories: { node: NodeState; x: number; y: number }[];
  /** x where this station's segment ends (next station or line end). */
  endX: number;
}

export interface Lane {
  track: TrackState;
  y: number;
  color: string;
  stations: Station[];
  startX: number;
  endX: number;
  /** Where the line comes from when this track forked off another. */
  forkFrom: { x: number; y: number } | null;
}

export interface Layout {
  lanes: Lane[];
  width: number;
  height: number;
  /** Maps a timestamp to an x position along the finished part of the map. */
  timeToX: (iso: string) => number;
}

const PALETTE = [
  "var(--blue)",
  "var(--purple)",
  "var(--teal)",
  "var(--pink)",
  "var(--green)",
  "var(--orange)",
];

function stationKey(n: NodeState, track: TrackState): [number, string, number] {
  // Abandoned directions and finished work are history, ordered by time.
  if (track.status === "abandoned") return [0, n.createdAt, n.sort];
  if (n.kind === "pivot") return [0, n.createdAt, n.sort];
  if (n.status === "done") return [0, n.statusAt, n.sort];
  if (n.status === "dropped") return [0, n.statusAt, n.sort];
  return [1, track.createdAt, n.sort];
}

const cmp = (a: [number, string, number], b: [number, string, number]) =>
  a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2];

export function layout(state: TrajectoryState): Layout {
  const tracks = [...state.tracks].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const laneOf = new Map(tracks.map((t, i) => [t.id, i]));
  const byTrack = new Map<string, NodeState[]>();
  for (const n of state.nodes) byTrack.set(n.trackId, [...(byTrack.get(n.trackId) ?? []), n]);

  // Stations are milestones and pivots; a track with no milestones uses its stories.
  type Pending = { node: NodeState; track: TrackState; stories: NodeState[] };
  const pending: Pending[] = [];
  for (const t of tracks) {
    const nodes = byTrack.get(t.id) ?? [];
    const stationNodes = nodes.filter((n) => n.kind === "milestone" || n.kind === "pivot");
    const stationIds = new Set(stationNodes.map((n) => n.id));
    const loose = nodes.filter(
      (n) => n.kind === "story" && (!n.parentId || !stationIds.has(n.parentId)),
    );
    // A track always shows something: milestones, else its stories, else its goal.
    const list = stationNodes.length
      ? stationNodes
      : loose.length
        ? loose
        : nodes.filter((n) => n.kind === "goal");
    for (const s of list) {
      pending.push({
        node: s,
        track: t,
        stories: stationNodes.length
          ? nodes.filter((n) => n.kind === "story" && n.parentId === s.id)
          : [],
      });
    }
    // Stories without a milestone hang off the track's last station.
    if (stationNodes.length && loose.length) pending.at(-1)!.stories.push(...loose);
  }
  pending.sort((a, b) => cmp(stationKey(a.node, a.track), stationKey(b.node, b.track)));

  // One global x order across lanes, so parallel work lines up in time.
  const stationsByTrack = new Map<string, Station[]>();
  let x = LEFT;
  for (const p of pending) {
    const y = TOP + laneOf.get(p.track.id)! * LANE_GAP;
    const parent = p.track.parentTrackId ? stationsByTrack.get(p.track.parentTrackId) : undefined;
    // The first station after a fork leaves room for the curve.
    if (parent?.length && !stationsByTrack.get(p.track.id)?.length)
      x = Math.max(x, parent.at(-1)!.endX + FORK_GAP);
    const stories = [...p.stories].sort((a, b) =>
      cmp(stationKey(a, p.track), stationKey(b, p.track)),
    );
    const station: Station = {
      node: p.node,
      x,
      y,
      stories: stories.map((s, i) => ({ node: s, x: x + 26 + i * STORY_GAP, y })),
      endX: 0,
    };
    // History is compact: abandoned plans and pivots take less room than live work.
    const width =
      p.track.status === "abandoned"
        ? 124
        : p.node.kind === "pivot"
          ? 64
          : Math.max(STATION_GAP + 40, 26 + stories.length * STORY_GAP + 30);
    station.endX = x + width;
    x += width;
    stationsByTrack.set(p.track.id, [...(stationsByTrack.get(p.track.id) ?? []), station]);
  }

  const lanes: Lane[] = tracks.map((t, i) => {
    const stations = stationsByTrack.get(t.id) ?? [];
    const y = TOP + i * LANE_GAP;
    const parentStations = t.parentTrackId ? stationsByTrack.get(t.parentTrackId) : undefined;
    const forkStation = t.forkNodeId
      ? parentStations?.find(
          (s) => s.node.id === t.forkNodeId || s.stories.some((st) => st.node.id === t.forkNodeId),
        )
      : parentStations?.at(-1);
    const forkFrom =
      t.parentTrackId && forkStation ? { x: forkStation.endX - 24, y: forkStation.y } : null;
    const startX = forkFrom ? forkFrom.x : (stations[0]?.x ?? LEFT) - 14;
    return {
      track: t,
      y,
      color: t.status === "abandoned" ? "var(--gray)" : PALETTE[i % PALETTE.length]!,
      stations,
      startX,
      endX: Math.max(startX + 40, ...(stations.length ? [stations.at(-1)!.endX - 24] : [])),
      forkFrom,
    };
  });

  // Time → x, from nodes whose position is anchored by a real time.
  // Only settled points are anchors: finished work, pivots, and abandoned plans.
  // Planned items have no meaningful time on this axis.
  const settled = (n: NodeState, abandoned: boolean) =>
    abandoned || n.kind === "pivot" || n.status === "done" || n.status === "dropped";
  const anchors = lanes
    .flatMap((l) => {
      const abandoned = l.track.status === "abandoned";
      return l.stations.flatMap((s) => [
        ...(settled(s.node, abandoned) ? [{ at: s.node.statusAt, x: s.x }] : []),
        ...s.stories
          .filter((st) => settled(st.node, abandoned))
          .map((st) => ({ at: st.node.statusAt, x: st.x })),
      ]);
    })
    .filter((a) => a.at)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  // Anything after the last settled point sits at "now".
  const visibleNow = new Map(state.nodes.map((n) => [n.id, n]));
  const nowXs = lanes.map((l) => nowX(l, visibleNow)).filter((v): v is number => v !== null);
  if (nowXs.length) anchors.push({ at: new Date().toISOString(), x: Math.min(...nowXs) });
  const done = anchors.filter((a, i) => i === 0 || a.x >= anchors[i - 1]!.x);
  const timeToX = (iso: string) => {
    if (!done.length) return LEFT;
    if (iso <= done[0]!.at) return done[0]!.x;
    for (let i = 1; i < done.length; i++) {
      if (iso <= done[i]!.at) {
        const a = done[i - 1]!;
        const b = done[i]!;
        const span = Date.parse(b.at) - Date.parse(a.at) || 1;
        return a.x + ((Date.parse(iso) - Date.parse(a.at)) / span) * (b.x - a.x);
      }
    }
    return done.at(-1)!.x;
  };

  return {
    lanes,
    width: x + LEFT + 160,
    height: TOP + Math.max(1, tracks.length) * LANE_GAP + 10,
    timeToX,
  };
}

/** Where "now" sits on a lane: the first unfinished thing on it. */
export function nowX(lane: Lane, visible: Map<string, NodeState>): number | null {
  if (lane.track.status !== "active") return null;
  for (const s of lane.stations) {
    const st = visible.get(s.node.id);
    if (!st) continue;
    for (const story of s.stories) {
      const v = visible.get(story.node.id);
      if (v && v.status !== "done" && v.status !== "dropped") return story.x;
    }
    if (!s.stories.length && st.status !== "done" && st.status !== "dropped" && st.kind !== "pivot")
      return s.x;
  }
  return null;
}
