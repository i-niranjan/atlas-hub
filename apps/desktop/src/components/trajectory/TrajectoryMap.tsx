import type { Entry, NodeState, NodeStatus, TrajectoryData } from "@atlas/core";
import { projectAt } from "@atlas/core";
import { Maximize2, Minus, Plus } from "lucide-react";
import { motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { kindMeta } from "../ui.tsx";
import { layout, nowX, type Lane, LANE_GAP, TOP } from "./layout.ts";

export const STATUS_LABEL: Record<NodeStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
  blocked: "Blocked",
};

interface Props {
  data: TrajectoryData;
  /** Moment to show (Replay); the layout is always from the latest state. */
  at: string;
  decisions?: Entry[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
  onOpenEntry?: (id: string) => void;
  /** Embedded in Ask Atlas: no zoom controls, fits its card. */
  compact?: boolean;
  height?: number;
}

const spring = { type: "spring", stiffness: 420, damping: 32 } as const;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function TrajectoryMap({
  data,
  at,
  decisions = [],
  selectedId,
  onSelectNode,
  onOpenEntry,
  compact = false,
  height,
}: Props) {
  const latest = useMemo(() => projectAt(data, "9999"), [data]);
  const plan = useMemo(() => layout(latest), [latest]);
  const visibleState = useMemo(() => projectAt(data, at), [data, at]);
  const visible = useMemo(() => new Map(visibleState.nodes.map((n) => [n.id, n])), [visibleState]);
  const liveTracks = useMemo(
    () => new Map(visibleState.tracks.map((t) => [t.id, t])),
    [visibleState],
  );

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<{ node: NodeState; x: number; y: number } | null>(null);
  const fitted = useRef(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e!.contentRect.width, h: e!.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mapHeight = height ?? Math.max(220, plan.height + 40);

  // Fit once: show everything if it fits, otherwise keep "now" in view.
  const fit = () => {
    // Never shrink below legible; wider maps scroll, centred on "now".
    const k = Math.max(0.85, Math.min(1.1, size.w / plan.width));
    const contentW = plan.width * k;
    const nowXs = plan.lanes.map((l) => nowX(l, visible)).filter((v): v is number => v !== null);
    const focus = nowXs.length ? Math.max(...nowXs) * k : contentW;
    // Show history from the start when "now" is already on screen; otherwise centre on now.
    const x =
      contentW <= size.w
        ? (size.w - contentW) / 2
        : focus <= size.w * 0.8
          ? 12
          : Math.min(0, Math.max(size.w - contentW, size.w * 0.55 - focus));
    setView({ x, y: Math.max(0, (mapHeight - plan.height * k) / 2), k });
  };
  useEffect(() => {
    if (!fitted.current && size.w > 100) {
      fit();
      fitted.current = true;
    }
  }, [size.w, plan.width]);

  const onWheel = (e: WheelEvent) => {
    if (compact) return;
    if (e.ctrlKey) {
      // Trackpad pinch arrives as ctrl+wheel; zoom around the cursor.
      const rect = box.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(2.2, Math.max(0.4, v.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
      });
    } else {
      setView((v) => ({
        ...v,
        x: v.x - e.deltaX,
        y: v.y - (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : 0),
      }));
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (compact || e.button !== 0 || (e.target as Element).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const zoom = (f: number) =>
    setView((v) => {
      const k = Math.min(2.2, Math.max(0.4, v.k * f));
      const cx = size.w / 2;
      const cy = mapHeight / 2;
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });

  // Decisions sit on a rail above the lanes, at the moment they were made.
  const railY = TOP - 36;
  const decisionMarks = useMemo(() => {
    const placed: { e: Entry; x: number; row: number }[] = [];
    let last = -Infinity;
    for (const e of [...decisions].sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : 1))) {
      if (e.decidedAt > at) continue;
      // Spread decisions made close together instead of stacking them.
      const x = Math.max(plan.timeToX(e.decidedAt), last + 11);
      last = x;
      placed.push({ e, x, row: 0 });
    }
    return placed;
  }, [decisions, plan, at]);

  const hoverCard = hover && (
    <div
      className="pointer-events-none absolute z-20 w-[240px] rounded-[10px] px-3 py-2.5"
      style={{
        left: Math.min(size.w - 250, Math.max(8, hover.x - 120)),
        top: hover.y + 16,
        background: "var(--elevated)",
        boxShadow: "var(--shadow-pop)",
      }}
      role="tooltip"
    >
      <div
        className="t-caption font-medium"
        style={{
          color: kindMeta(
            hover.node.kind === "story"
              ? "decision"
              : hover.node.kind === "milestone"
                ? "architecture"
                : "pivot",
          ).color,
        }}
      >
        {hover.node.kind === "milestone"
          ? "Milestone"
          : hover.node.kind === "pivot"
            ? "Pivot"
            : "Story"}
        {hover.node.key ? ` · ${hover.node.key}` : ""}
      </div>
      <div className="t-headline mt-0.5">{hover.node.title}</div>
      <div className="t-caption mt-1" style={{ color: "var(--label-2)" }}>
        {STATUS_LABEL[hover.node.status]}
        {hover.node.reviewState === "needs_review" ? " · unconfirmed" : ""}
      </div>
    </div>
  );

  return (
    <div
      ref={box}
      className="relative overflow-hidden"
      style={{
        height: mapHeight,
        cursor: drag.current ? "grabbing" : compact ? "default" : "grab",
        touchAction: "none",
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label={describe(visibleState, plan.lanes)}
    >
      <svg width={size.w} height={mapHeight} className="block">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {decisions.length > 0 && (
            <g>
              <line
                x1={plan.lanes[0]?.startX ?? 0}
                x2={plan.width - 160}
                y1={railY}
                y2={railY}
                stroke="var(--separator)"
                strokeDasharray="1 4"
              />
              <text
                x={(plan.lanes[0]?.startX ?? 0) - 2}
                y={railY - 9}
                className="t-caption"
                fill="var(--label-3)"
              >
                Decisions
              </text>
              {decisionMarks.map(({ e, x, row }) => (
                <g
                  key={e.id}
                  data-node
                  transform={`translate(${x},${railY + row * 8})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => onOpenEntry?.(e.id)}
                >
                  <title>{e.title}</title>
                  <motion.path
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={spring}
                    d="M 0 -5 L 5 0 L 0 5 L -5 0 Z"
                    fill={kindMeta(e.kind).color}
                    opacity={e.status === "active" ? 0.95 : 0.4}
                  />
                </g>
              ))}
            </g>
          )}

          {plan.lanes.map((lane) => (
            <LaneView
              key={lane.track.id}
              lane={lane}
              live={liveTracks.get(lane.track.id)}
              visible={visible}
              selectedId={selectedId ?? null}
              onSelect={onSelectNode}
              onHover={(node, x, y) =>
                setHover(node ? { node, x: x * view.k + view.x, y: y * view.k + view.y } : null)
              }
            />
          ))}
        </g>
      </svg>
      {hoverCard}
      {!compact && (
        <div
          className="absolute right-3 bottom-3 flex overflow-hidden rounded-[7px]"
          style={{ background: "var(--elevated)", boxShadow: "var(--shadow-card)" }}
        >
          {[
            { icon: Minus, label: "Zoom out", onClick: () => zoom(1 / 1.25) },
            { icon: Maximize2, label: "Fit", onClick: fit },
            { icon: Plus, label: "Zoom in", onClick: () => zoom(1.25) },
          ].map(({ icon: Icon, label, onClick }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={onClick}
              className="flex h-7 w-7 items-center justify-center hover:bg-[var(--fill)]"
              style={{ color: "var(--label-2)" }}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LaneView({
  lane,
  live,
  visible,
  selectedId,
  onSelect,
  onHover,
}: {
  lane: Lane;
  live: { status: string } | undefined;
  visible: Map<string, NodeState>;
  selectedId: string | null;
  onSelect: ((id: string) => void) | undefined;
  onHover: (node: NodeState | null, x: number, y: number) => void;
}) {
  const shown = !!live;
  const abandoned = live?.status === "abandoned";
  const color = abandoned ? "var(--gray)" : lane.color;
  const now = shown ? nowX(lane, visible) : null;
  const firstX = lane.stations[0] ? lane.stations[0].x - 14 : lane.startX;
  const solidEnd = now ?? lane.endX;
  const fork = lane.forkFrom;
  const forkPath = fork
    ? `M ${fork.x} ${fork.y} C ${fork.x + 28} ${fork.y}, ${firstX - 28} ${lane.y}, ${firstX} ${lane.y}`
    : null;

  return (
    <motion.g initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={{ duration: 0.35 }}>
      <text
        x={firstX}
        y={lane.y - 20}
        className="t-caption"
        fontWeight={600}
        fill={abandoned ? "var(--label-3)" : color}
      >
        {truncate(lane.track.name, 36)}
        {abandoned ? "  ·  abandoned" : ""}
      </text>

      {forkPath && (
        <motion.path
          d={forkPath}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          opacity={abandoned ? 0.45 : 1}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: shown ? 1 : 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
      {/* finished part */}
      <motion.line
        x1={firstX}
        y1={lane.y}
        y2={lane.y}
        stroke={color}
        strokeWidth={abandoned ? 2.5 : 3}
        strokeLinecap="round"
        opacity={abandoned ? 0.45 : 1}
        initial={{ x2: firstX }}
        animate={{ x2: Math.max(firstX, solidEnd) }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      {/* planned part */}
      {!abandoned && now !== null && (
        <line
          x1={now}
          x2={lane.endX}
          y1={lane.y}
          y2={lane.y}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4 5"
          strokeLinecap="round"
          opacity={0.45}
        />
      )}
      {abandoned && (
        <g>
          <line
            x1={lane.endX}
            x2={lane.endX}
            y1={lane.y - 8}
            y2={lane.y + 8}
            stroke="var(--gray)"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.7}
          />
        </g>
      )}

      {lane.stations.map((s) => {
        const v = visible.get(s.node.id);
        return (
          <g key={s.node.id}>
            {s.stories.map((st) => (
              <Dot
                key={st.node.id}
                node={visible.get(st.node.id)}
                base={st.node}
                x={st.x}
                y={st.y}
                r={3.6}
                color={color}
                selected={selectedId === st.node.id}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
            <Dot
              node={v}
              base={s.node}
              x={s.x}
              y={s.y}
              r={s.node.kind === "pivot" ? 7.5 : 7}
              color={s.node.kind === "pivot" ? "var(--pink)" : color}
              selected={selectedId === s.node.id}
              onSelect={onSelect}
              onHover={onHover}
              station
            />
            {v && s.node.kind !== "pivot" && (
              <motion.text
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                x={s.x}
                y={s.y + 24}
                textAnchor="start"
                className="t-caption"
                fill={abandoned ? "var(--label-3)" : "var(--label-2)"}
              >
                {s.node.key && (
                  <tspan fontWeight={650} fill={abandoned ? "var(--label-3)" : "var(--label)"}>
                    {s.node.key}{" "}
                  </tspan>
                )}
                {truncate(s.node.title, abandoned ? 15 : s.node.key ? 18 : 22)}
              </motion.text>
            )}
          </g>
        );
      })}

      {abandoned && lane.track.reason && (
        <foreignObject x={lane.endX + 12} y={lane.y - 13} width={300} height={44}>
          <div
            className="t-caption inline-block max-w-[290px] rounded-[6px] px-2 py-1"
            style={{ background: "var(--fill)", color: "var(--label-2)", lineHeight: "15px" }}
            title={lane.track.reason}
          >
            {truncate(lane.track.reason, 90)}
          </div>
        </foreignObject>
      )}

      {now !== null && (
        <g pointerEvents="none">
          <circle
            cx={now}
            cy={lane.y}
            r={12}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            className="pulse"
            opacity={0.7}
          />
          <text
            x={now}
            y={lane.y - 18}
            textAnchor="middle"
            className="t-caption"
            fontWeight={650}
            fill="var(--accent)"
          >
            Now
          </text>
        </g>
      )}
    </motion.g>
  );
}

function Dot({
  node,
  base,
  x,
  y,
  r,
  color,
  selected,
  station = false,
  onSelect,
  onHover,
}: {
  node: NodeState | undefined;
  base: NodeState;
  x: number;
  y: number;
  r: number;
  color: string;
  selected: boolean;
  station?: boolean;
  onSelect: ((id: string) => void) | undefined;
  onHover: (node: NodeState | null, x: number, y: number) => void;
}) {
  const status = node?.status ?? "planned";
  const unconfirmed = node?.reviewState === "needs_review";
  const filled = status === "done";
  const stroke =
    status === "blocked"
      ? "var(--orange)"
      : status === "in_progress"
        ? "var(--accent)"
        : status === "dropped"
          ? "var(--label-3)"
          : filled
            ? color
            : "var(--label-3)";
  const isPivot = base.kind === "pivot";
  return (
    <g
      data-node
      style={{ cursor: "pointer" }}
      onClick={() => onSelect?.(base.id)}
      onMouseEnter={() => node && onHover(node, x, y)}
      onMouseLeave={() => onHover(null, 0, 0)}
      role="button"
      aria-label={`${base.key ? `${base.key} ` : ""}${base.title}: ${STATUS_LABEL[status]}`}
    >
      <circle cx={x} cy={y} r={Math.max(r + 6, 10)} fill="transparent" />
      {selected && (
        <circle cx={x} cy={y} r={r + 4.5} fill="none" stroke="var(--accent)" strokeWidth={2} />
      )}
      {isPivot ? (
        <motion.path
          d={`M ${x} ${y - r - 1.5} L ${x + r + 1.5} ${y} L ${x} ${y + r + 1.5} L ${x - r - 1.5} ${y} Z`}
          fill={color}
          initial={false}
          animate={{ opacity: node ? 1 : 0 }}
          transition={spring}
        />
      ) : (
        <motion.circle
          cx={x}
          cy={y}
          initial={false}
          animate={{
            r: node ? r : 0,
            opacity: node ? 1 : 0,
            fill: filled ? color : "var(--content)",
          }}
          transition={spring}
          stroke={stroke}
          strokeWidth={station ? 2.5 : 1.6}
          strokeDasharray={unconfirmed ? "2 2" : undefined}
        />
      )}
      {status === "dropped" && node && (
        <g stroke="var(--label-3)" strokeWidth={1.5} strokeLinecap="round">
          <line x1={x - r * 0.6} y1={y - r * 0.6} x2={x + r * 0.6} y2={y + r * 0.6} />
          <line x1={x - r * 0.6} y1={y + r * 0.6} x2={x + r * 0.6} y2={y - r * 0.6} />
        </g>
      )}
    </g>
  );
}

/** A plain-language summary of the map for VoiceOver. */
function describe(state: ReturnType<typeof projectAt>, lanes: Lane[]): string {
  const parts = lanes
    .filter((l) => state.tracks.some((t) => t.id === l.track.id))
    .map((l) => {
      const nodes = state.nodes.filter((n) => n.trackId === l.track.id && n.kind !== "pivot");
      const done = nodes.filter((n) => n.status === "done").length;
      const status = state.tracks.find((t) => t.id === l.track.id)!.status;
      return `${l.track.name}, ${status}, ${done} of ${nodes.length} items done`;
    });
  return `Trajectory map. ${parts.join(". ")}.`;
}

export { LANE_GAP };
