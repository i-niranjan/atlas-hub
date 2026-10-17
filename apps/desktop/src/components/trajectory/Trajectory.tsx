import type { Entry } from "@atlas/core";
import { heading, projectAt } from "@atlas/core";
import { Map as MapIcon } from "lucide-react";
import { useMemo } from "react";
import { useTrajectory } from "../../lib/queries.ts";
import { EmptyState, SkeletonRows } from "../ui.tsx";
import { HeadingCard } from "./Heading.tsx";
import { NodeDetail } from "./NodeDetail.tsx";
import { Primer } from "./Primer.tsx";
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
  const now = useMemo(() => new Date().toISOString(), [data]);
  const state = useMemo(() => (data ? projectAt(data, now) : null), [data, now]);
  const h = useMemo(() => (state ? heading(state) : null), [state]);

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (!data || !data.tracks.length || !state || !h) {
    return (
      <EmptyState
        icon={MapIcon}
        title="No roadmap yet"
        message="Atlas starts one when the project has plan documents (roadmaps, scope docs, backlogs, approved Claude plans), or when a Claude session plans or builds this project. It keeps moving as sessions and commits land."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-6 pt-5 pb-10">
          {data.primer && <Primer primer={data.primer} />}
          <HeadingCard heading={h} state={state} onSelectNode={(id) => onSelectNode(id)} />

          <section
            className="overflow-hidden rounded-[12px]"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
            aria-label="Trajectory"
          >
            <TrajectoryMap
              data={data}
              at={now}
              decisions={decisions}
              selectedId={selectedNodeId}
              onSelectNode={(id) => onSelectNode(id)}
              onOpenEntry={onOpenEntry}
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
                ▲ grew · ▼ cut
              </span>
            </div>
            <ScopeChart data={data} />
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
