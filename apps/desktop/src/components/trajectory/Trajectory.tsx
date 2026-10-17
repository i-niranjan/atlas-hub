import type { Entry } from "@atlas/core";
import { heading, projectAt, timeRange } from "@atlas/core";
import { Map as MapIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTrajectory } from "../../lib/queries.ts";
import { EmptyState, SkeletonRows } from "../ui.tsx";
import { HeadingCard } from "./Heading.tsx";
import { NodeDetail } from "./NodeDetail.tsx";
import { Replay, type Speed } from "./Replay.tsx";
import { ScopeChart } from "./ScopeChart.tsx";
import { TrajectoryMap } from "./TrajectoryMap.tsx";

/** Module 2: where the project is heading, at a glance, and how it got here. */
export function Trajectory({
  projectId,
  decisions,
  onOpenEntry,
  selectedNodeId,
  onSelectNode,
}: {
  projectId: string;
  decisions: Entry[];
  onOpenEntry: (id: string) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const { data, isLoading } = useTrajectory(projectId);
  const [at, setAt] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("4");

  // "Now" is fixed per data version so Replay has a stable end while it plays.
  const now = useMemo(() => new Date().toISOString(), [data]);
  const shownAt = at ?? now;
  const state = useMemo(() => (data ? projectAt(data, shownAt) : null), [data, shownAt]);
  const h = useMemo(() => (state ? heading(state) : null), [state]);
  const range = data ? timeRange(data) : null;

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (!data || !data.tracks.length || !state || !h || !range) {
    return (
      <EmptyState
        icon={MapIcon}
        title="No roadmap yet"
        message="Atlas draws this from the project's plan documents (roadmaps, scope docs, backlogs, approved Claude plans) and keeps it moving as sessions and commits land."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-6 pt-5 pb-10">
          <HeadingCard heading={h} state={state} onSelectNode={(id) => onSelectNode(id)} />

          <section
            className="overflow-hidden rounded-[12px]"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
            aria-label="Trajectory"
          >
            <TrajectoryMap
              data={data}
              at={shownAt}
              decisions={decisions}
              selectedId={selectedNodeId}
              onSelectNode={(id) => onSelectNode(id)}
              onOpenEntry={onOpenEntry}
            />
            <Replay
              start={range.start}
              end={now}
              at={at}
              onChange={setAt}
              playing={playing}
              onPlayingChange={setPlaying}
              speed={speed}
              onSpeedChange={setSpeed}
            />
          </section>

          <section
            className="rounded-[12px] px-4 pt-3 pb-2"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
            aria-label="Scope over time"
          >
            <div className="t-section mb-1 flex items-center justify-between">
              <span>Scope over time</span>
              <span className="t-caption font-normal" style={{ color: "var(--label-3)" }}>
                ▲ grew · ▼ cut · click to replay from there
              </span>
            </div>
            <ScopeChart
              data={data}
              at={shownAt}
              onSeek={(iso) => {
                setPlaying(false);
                setAt(iso);
              }}
            />
          </section>
        </div>
      </div>
      {selectedNodeId && data.nodes.some((n) => n.id === selectedNodeId) && (
        <NodeDetail
          nodeId={selectedNodeId}
          projectId={projectId}
          data={data}
          onClose={() => onSelectNode(null)}
          onSelectNode={(id) => onSelectNode(id)}
        />
      )}
    </div>
  );
}
