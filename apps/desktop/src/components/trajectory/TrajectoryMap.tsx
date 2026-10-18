import type { Entry, NodeState, NodeStatus, TrajectoryData } from "@atlas/core";
import { projectAt } from "@atlas/core";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";
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
import { layout, nowX, type Lane, type Station } from "./layout.ts";

export const STATUS_LABEL: Record<NodeStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
  blocked: "Blocked",
};

interface Props {
  data: TrajectoryData;
  /** Moment to show; the layout is always from the latest state. */
  at: string;
  decisions?: Entry[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
  onOpenEntry?: (id: string) => void;
  /** Embedded in Ask Atlas: no controls, fits its card. */
  compact?: boolean;
  height?: number;
}

type View = { x: number; y: number; k: number };

const spring = { type: "spring", stiffness: 420, damping: 32 } as const;
/** Zoom spreads the map out (more room between points); points and text keep their size. */
const MIN_K = 0.5;
const MAX_K = 3;
/** How far the map may be dragged past its edges. */
const SLACK = 80;
const MINIMAP_H = 34;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** The layout stretched horizontally by `k`: semantic zoom. */
function scaleLane(l: Lane, k: number): Lane {
  return {
    ...l,
    startX: l.startX * k,
    endX: l.endX * k,
    forkFrom: l.forkFrom ? { x: l.forkFrom.x * k, y: l.forkFrom.y } : null,
    stations: l.stations.map((s) => ({
      ...s,
      x: s.x * k,
      endX: s.endX * k,
      stories: s.stories.map((st) => ({ ...st, x: st.x * k })),
    })),
  };
}

type Hover =
  | { kind: "node"; node: NodeState; x: number; y: number }
  | { kind: "decisions"; entries: Entry[]; x: number; y: number };

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
  const [view, setViewRaw] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<Hover | null>(null);
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

  const mapHeight = height ?? Math.max(200, plan.height + 24);
  const contentW = plan.width;
  const contentH = plan.height;

  /** Keep the map on screen: it can be dragged a little past its edges, never away. */
  const clamp = (v: View): View => {
    const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
    const w = contentW * k;
    const h = contentH;
    const x =
      w + 2 * SLACK <= size.w
        ? (size.w - w) / 2
        : Math.min(SLACK, Math.max(size.w - w - SLACK, v.x));
    const y =
      h <= mapHeight
        ? (mapHeight - h) / 2
        : Math.min(SLACK / 2, Math.max(mapHeight - h - SLACK / 2, v.y));
    return { k, x, y };
  };
  const setView = (f: View | ((v: View) => View)) =>
    setViewRaw((v) => clamp(typeof f === "function" ? f(v) : f));

  const nowPoint = useMemo(() => {
    for (const l of plan.lanes) {
      const x = nowX(l, visible);
      if (x !== null && liveTracks.get(l.track.id)?.status === "active") return { x, y: l.y };
    }
    return null;
  }, [plan, visible, liveTracks]);

  /** Show from the start when "now" fits on screen; otherwise centre on now. */
  const fit = () => {
    const k = Math.max(0.8, Math.min(1.1, size.w / contentW));
    const focus = nowPoint ? nowPoint.x * k : contentW * k;
    const x =
      contentW * k <= size.w
        ? (size.w - contentW * k) / 2
        : focus <= size.w * 0.8
          ? 16
          : size.w * 0.55 - focus;
    setView({ x, y: (mapHeight - contentH) / 2, k });
  };
  const goToNow = () => {
    if (!nowPoint) return fit();
    setView((v) => ({ ...v, x: size.w * 0.5 - nowPoint.x * v.k }));
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
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: cx - ((cx - v.x) / v.k) * k, y: v.y };
      });
    } else {
      setView((v) => ({
        ...v,
        x: v.x - e.deltaX - (e.shiftKey ? e.deltaY : 0),
        y: v.y - (e.shiftKey ? 0 : e.deltaY),
      }));
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (compact || e.button !== 0 || (e.target as Element).closest("[data-node], button")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const zoom = (f: number) =>
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
      const cx = size.w / 2;
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: v.y };
    });

  // Decisions attach to the station they happened at, as a count badge, not a separate row.
  const decisionsByStation = useMemo(() => {
    const stations: Station[] = plan.lanes
      .filter((l) => liveTracks.has(l.track.id))
      .flatMap((l) => l.stations)
      .filter((s) => visible.has(s.node.id) && s.node.kind !== "goal");
    const out = new Map<string, Entry[]>();
    if (!stations.length) return out;
    for (const e of decisions) {
      if (e.decidedAt > at || e.reviewState === "dismissed") continue;
      const x = plan.timeToX(e.decidedAt);
      // The last station at or before this moment, else the nearest.
      const before = stations.filter((s) => s.x <= x + 1).sort((a, b) => b.x - a.x)[0];
      const target =
        before ?? stations.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
      out.set(target.node.id, [...(out.get(target.node.id) ?? []), e]);
    }
    return out;
  }, [plan, decisions, at, visible, liveTracks]);

  const lanes = useMemo(() => plan.lanes.map((l) => scaleLane(l, view.k)), [plan, view.k]);
  const toScreen = (x: number, y: number) => ({ x: x + view.x, y: y + view.y });

  return (
    <div className="relative">
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
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        role="img"
        aria-label={describe(visibleState, plan.lanes)}
      >
        <svg width={size.w} height={mapHeight} className="block">
          <g transform={`translate(${view.x},${view.y})`}>
            {lanes.map((lane) => (
              <LaneView
                key={lane.track.id}
                lane={lane}
                zoom={view.k}
                successor={lanes.find((l) => l.track.parentTrackId === lane.track.id)}
                live={liveTracks.get(lane.track.id)}
                visible={visible}
                selectedId={selectedId ?? null}
                decisions={decisionsByStation}
                onSelect={onSelectNode}
                onHoverNode={(node, x, y) =>
                  setHover(node ? { kind: "node", node, ...toScreen(x, y) } : null)
                }
                onHoverDecisions={(entries, x, y) =>
                  setHover({ kind: "decisions", entries, ...toScreen(x, y) })
                }
              />
            ))}
          </g>
        </svg>

        {hover && (
          <HoverCard
            hover={hover}
            width={size.w}
            height={mapHeight}
            onOpenEntry={onOpenEntry}
            onLeave={() => setHover(null)}
          />
        )}

        {!compact && (
          <div
            className="absolute right-3 bottom-3 flex overflow-hidden rounded-[7px]"
            style={{ background: "var(--elevated)", boxShadow: "var(--shadow-card)" }}
          >
            {[
              { icon: Crosshair, label: "Go to now", onClick: goToNow },
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

      {!compact && contentW * view.k > size.w + 4 && (
        <Minimap
          plan={plan}
          view={view}
          width={size.w}
          live={liveTracks}
          visible={visible}
          nowPoint={nowPoint}
          onJump={(cx) => setView((v) => ({ ...v, x: size.w / 2 - cx * v.k }))}
        />
      )}
    </div>
  );
}

/** The whole map in one strip, with the visible window outlined; click or drag to move. */
function Minimap({
  plan,
  view,
  width,
  live,
  visible,
  nowPoint,
  onJump,
}: {
  plan: ReturnType<typeof layout>;
  view: View;
  width: number;
  live: Map<string, { status: string }>;
  visible: Map<string, NodeState>;
  nowPoint: { x: number; y: number } | null;
  onJump: (contentX: number) => void;
}) {
  const pad = 16;
  const s = (width - pad * 2) / plan.width;
  const lanes = plan.lanes.length;
  const laneY = (y: number) => {
    const i = plan.lanes.findIndex((l) => l.y === y);
    return lanes <= 1 ? MINIMAP_H / 2 : 9 + (i / (lanes - 1)) * (MINIMAP_H - 18);
  };
  const winX = pad + (-view.x / view.k) * s;
  const winW = (width / view.k) * s;
  const dragging = useRef(false);
  const jump = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    onJump((clientX - r.left - pad) / s);
  };
  return (
    <svg
      width={width}
      height={MINIMAP_H}
      className="block"
      style={{ borderTop: "0.5px solid var(--separator)", cursor: "pointer" }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        jump(e.clientX, e.currentTarget);
      }}
      onPointerMove={(e) => dragging.current && jump(e.clientX, e.currentTarget)}
      onPointerUp={() => (dragging.current = false)}
      role="slider"
      aria-label="Map overview"
      aria-valuenow={Math.round(winX)}
    >
      {plan.lanes.map((l) => {
        if (!live.has(l.track.id)) return null;
        const y = laneY(l.y);
        const color = live.get(l.track.id)!.status === "abandoned" ? "var(--label-3)" : l.color;
        return (
          <g key={l.track.id}>
            <line
              x1={pad + l.startX * s}
              x2={pad + l.endX * s}
              y1={y}
              y2={y}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.7}
            />
            {l.stations.map((st) => {
              const v = visible.get(st.node.id);
              return v ? (
                <circle
                  key={st.node.id}
                  cx={pad + st.x * s}
                  cy={y}
                  r={2.2}
                  fill={v.status === "done" ? color : "var(--card)"}
                  stroke={color}
                  strokeWidth={1}
                />
              ) : null;
            })}
          </g>
        );
      })}
      {nowPoint && (
        <circle cx={pad + nowPoint.x * s} cy={laneY(nowPoint.y)} r={3.5} fill="var(--accent)" />
      )}
      <rect
        x={Math.max(1, winX)}
        y={2}
        width={Math.max(12, Math.min(winW, width - 2 - Math.max(1, winX)))}
        height={MINIMAP_H - 4}
        rx={5}
        fill="color-mix(in srgb, var(--accent) 10%, transparent)"
        stroke="color-mix(in srgb, var(--accent) 55%, transparent)"
        strokeWidth={1}
      />
    </svg>
  );
}

function HoverCard({
  hover,
  width,
  height,
  onOpenEntry,
  onLeave,
}: {
  hover: Hover;
  width: number;
  height: number;
  onOpenEntry: ((id: string) => void) | undefined;
  onLeave: () => void;
}) {
  const left = Math.min(width - 270, Math.max(8, hover.x - 130));
  // Open above the point in the lower half so the card is never cut off by the map edge.
  const below = hover.y < height / 2;
  const vert = (gap: number) =>
    below ? { top: hover.y + gap } : { bottom: height - hover.y + gap };
  if (hover.kind === "decisions") {
    return (
      <div
        className="absolute z-20 w-[260px] rounded-[10px] py-1.5"
        style={{
          left,
          ...vert(14),
          background: "var(--elevated)",
          boxShadow: "var(--shadow-pop)",
        }}
        onMouseLeave={onLeave}
        role="dialog"
        aria-label="Decisions made here"
      >
        <div className="t-section px-3 pt-1 pb-1">Decided here</div>
        {hover.entries.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onOpenEntry?.(e.id)}
            className="t-callout flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--fill)]"
          >
            <svg width={10} height={10} className="shrink-0" aria-hidden>
              <path d="M 5 0 L 10 5 L 5 10 L 0 5 Z" fill={kindMeta(e.kind).color} />
            </svg>
            <span className="min-w-0 flex-1 truncate">{e.title}</span>
          </button>
        ))}
      </div>
    );
  }
  const n = hover.node;
  return (
    <div
      className="pointer-events-none absolute z-20 w-[240px] rounded-[10px] px-3 py-2.5"
      style={{
        left,
        ...vert(16),
        background: "var(--elevated)",
        boxShadow: "var(--shadow-pop)",
      }}
      role="tooltip"
    >
      <div className="t-caption font-medium" style={{ color: "var(--label-2)" }}>
        {n.kind === "milestone"
          ? "Milestone"
          : n.kind === "pivot"
            ? "Pivot"
            : n.kind === "goal"
              ? "Goal"
              : "Story"}
        {n.key ? ` · ${n.key}` : ""}
      </div>
      <div className="t-headline mt-0.5">{n.title}</div>
      {n.explain && (
        <div className="t-callout mt-1" style={{ color: "var(--label-2)" }}>
          {n.explain}
        </div>
      )}
      <div className="t-caption mt-1" style={{ color: "var(--label-2)" }}>
        {STATUS_LABEL[n.status]}
        {n.reviewState === "needs_review" ? " · unconfirmed" : ""}
      </div>
    </div>
  );
}

function LaneView({
  lane,
  zoom,
  successor,
  live,
  visible,
  selectedId,
  decisions,
  onSelect,
  onHoverNode,
  onHoverDecisions,
}: {
  lane: Lane;
  /** Current zoom: more room means more detail in labels. */
  zoom: number;
  /** The lane that replaced this one, if any (carries the structured pivot). */
  successor: Lane | undefined;
  live: { status: string } | undefined;
  visible: Map<string, NodeState>;
  selectedId: string | null;
  decisions: Map<string, Entry[]>;
  onSelect: ((id: string) => void) | undefined;
  onHoverNode: (node: NodeState | null, x: number, y: number) => void;
  onHoverDecisions: (entries: Entry[], x: number, y: number) => void;
}) {
  const shown = !!live;
  const abandoned = live?.status === "abandoned";
  const color = abandoned ? "var(--gray)" : lane.color;
  const now = shown ? nowX(lane, visible) : null;
  const firstX = lane.stations[0] ? lane.stations[0].x - 16 : lane.startX;
  const solidEnd = now ?? lane.endX;
  const fork = lane.forkFrom;
  const forkPath = fork
    ? `M ${fork.x} ${fork.y} C ${fork.x + 30} ${fork.y}, ${firstX - 30} ${lane.y}, ${firstX} ${lane.y}`
    : null;

  return (
    <motion.g initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={{ duration: 0.35 }}>
      <text
        x={firstX}
        y={lane.y - 50}
        fontSize={12}
        fontWeight={650}
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
          strokeWidth={3.5}
          strokeLinecap="round"
          opacity={abandoned ? 0.45 : 1}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: shown ? 1 : 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
      <motion.line
        x1={firstX}
        y1={lane.y}
        y2={lane.y}
        stroke={color}
        strokeWidth={abandoned ? 3 : 4}
        strokeLinecap="round"
        opacity={abandoned ? 0.45 : 1}
        initial={{ x2: firstX }}
        animate={{ x2: Math.max(firstX, solidEnd) }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      {!abandoned && now !== null && (
        <line
          x1={now}
          x2={lane.endX}
          y1={lane.y}
          y2={lane.y}
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray="5 6"
          strokeLinecap="round"
          opacity={0.55}
        />
      )}
      {abandoned && (
        <line
          x1={lane.endX}
          x2={lane.endX}
          y1={lane.y - 10}
          y2={lane.y + 10}
          stroke="var(--gray)"
          strokeWidth={3.5}
          strokeLinecap="round"
          opacity={0.75}
        />
      )}

      {lane.stations.map((s) => {
        const v = visible.get(s.node.id);
        const here = decisions.get(s.node.id);
        return (
          <g key={s.node.id}>
            {s.stories.map((st) => (
              <g key={st.node.id}>
                <Dot
                  node={visible.get(st.node.id)}
                  base={st.node}
                  x={st.x}
                  y={st.y}
                  r={4.6}
                  color={color}
                  selected={selectedId === st.node.id}
                  onSelect={onSelect}
                  onHover={onHoverNode}
                />
                {/* Zoomed in far enough, stories get their own angled labels. */}
                {zoom >= 1.6 && !abandoned && visible.get(st.node.id) && (
                  <motion.text
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    x={st.x + 4}
                    y={st.y - 12}
                    transform={`rotate(-32 ${st.x + 4} ${st.y - 12})`}
                    fontSize={10}
                    fill="var(--label-2)"
                    pointerEvents="none"
                  >
                    {truncate(st.node.title, Math.floor(10 + (zoom - 1.6) * 12))}
                  </motion.text>
                )}
              </g>
            ))}
            <Dot
              node={v}
              base={s.node}
              x={s.x}
              y={s.y}
              r={8.5}
              color={s.node.kind === "pivot" ? "var(--pink)" : color}
              selected={selectedId === s.node.id}
              onSelect={onSelect}
              onHover={onHoverNode}
              station
            />
            {v && s.node.kind !== "pivot" && (
              <motion.text
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                x={s.x - 6}
                y={s.y + 27}
                fontSize={11.5}
                fill={abandoned ? "var(--label-3)" : "var(--label-2)"}
              >
                {s.node.key && (
                  <tspan fontWeight={700} fill={abandoned ? "var(--label-3)" : "var(--label)"}>
                    {s.node.key}{" "}
                  </tspan>
                )}
                {/* Zoomed out: just the key. Zoomed in: room for the full title. */}
                {zoom < 0.75 && s.node.key
                  ? ""
                  : truncate(
                      s.node.title,
                      Math.max(
                        6,
                        Math.floor((abandoned ? 19 : 25) * Math.min(zoom, 2.4)) -
                          (s.node.key ? s.node.key.length + 1 : 0),
                      ),
                    )}
              </motion.text>
            )}
            {here && v && (
              <g
                data-node
                style={{ cursor: "pointer" }}
                onMouseEnter={() => onHoverDecisions(here, s.x, s.y - 18)}
                onClick={() => onHoverDecisions(here, s.x, s.y - 18)}
                role="button"
                aria-label={`${here.length} decision${here.length === 1 ? "" : "s"} made here`}
              >
                <rect
                  x={s.x - 6}
                  y={s.y - 30}
                  width={here.length > 9 ? 30 : 25}
                  height={16}
                  rx={8}
                  fill="var(--elevated)"
                  stroke="var(--separator-strong)"
                />
                <path
                  d={`M ${s.x + 1} ${s.y - 26} L ${s.x + 5} ${s.y - 22} L ${s.x + 1} ${s.y - 18} L ${s.x - 3} ${s.y - 22} Z`}
                  fill="var(--blue)"
                />
                <text
                  x={s.x + 8}
                  y={s.y - 18}
                  fontSize={10.5}
                  fontWeight={650}
                  fill="var(--label-2)"
                >
                  {here.length}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {abandoned && (successor?.track.change || lane.track.reason) && (
        <foreignObject x={lane.endX + 14} y={lane.y - 30} width={270} height={66}>
          <PivotChip
            lane={lane}
            successor={successor}
            onOpen={() => {
              const pivot = successor?.stations.find((st) => st.node.kind === "pivot");
              if (pivot) onSelect?.(pivot.node.id);
            }}
          />
        </foreignObject>
      )}

      {now !== null && (
        <g pointerEvents="none">
          <circle
            cx={now}
            cy={lane.y}
            r={14}
            fill="color-mix(in srgb, var(--accent) 14%, transparent)"
          />
          <circle
            cx={now}
            cy={lane.y}
            r={14}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            className="pulse"
          />
          <rect x={now - 19} y={lane.y - 40} width={38} height={16} rx={8} fill="var(--accent)" />
          <text
            x={now}
            y={lane.y - 28.5}
            textAnchor="middle"
            fontSize={10.5}
            fontWeight={700}
            fill="var(--accent-text)"
          >
            NOW
          </text>
        </g>
      )}
    </motion.g>
  );
}

/** At the end of an abandoned line: what changed, as from → to, not a sentence. */
function PivotChip({
  lane,
  successor,
  onOpen,
}: {
  lane: Lane;
  successor: Lane | undefined;
  onOpen: () => void;
}) {
  const change = successor?.track.change;
  return (
    <button
      type="button"
      data-node
      onClick={onOpen}
      className="block max-w-[260px] rounded-[8px] px-2.5 py-1.5 text-left"
      style={{ background: "var(--fill)", cursor: "pointer" }}
      title="See what changed and why"
    >
      {change?.shifts.length ? (
        <ul className="space-y-0.5">
          {change.shifts.slice(0, 2).map((sh) => (
            <li
              key={`${sh.from}>${sh.to}`}
              className="t-caption flex items-center gap-1.5 whitespace-nowrap"
            >
              <span style={{ color: "var(--label-3)", textDecoration: "line-through" }}>
                {truncate(sh.from, 16)}
              </span>
              <span style={{ color: "var(--label-3)" }}>→</span>
              <span className="font-medium" style={{ color: "var(--label)" }}>
                {truncate(sh.to, 18)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="t-caption" style={{ color: "var(--label-2)" }}>
          {truncate(change?.after ?? lane.track.reason ?? "", 80)}
        </span>
      )}
      <span className="t-caption mt-0.5 block font-medium" style={{ color: "var(--accent)" }}>
        Why it changed ›
      </span>
    </button>
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
  // Planned points get a strong outline on the card colour so they read as "to do", not as gaps.
  const stroke =
    status === "blocked"
      ? "var(--orange)"
      : status === "in_progress"
        ? "var(--accent)"
        : status === "dropped"
          ? "var(--label-3)"
          : filled
            ? color
            : "var(--label-2)";
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
      <circle cx={x} cy={y} r={Math.max(r + 7, 11)} fill="transparent" />
      {selected && (
        <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      )}
      {isPivot ? (
        <motion.path
          d={`M ${x} ${y - r - 2} L ${x + r + 2} ${y} L ${x} ${y + r + 2} L ${x - r - 2} ${y} Z`}
          fill={color}
          stroke="var(--card)"
          strokeWidth={2}
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
            fill: filled
              ? color
              : status === "in_progress"
                ? "color-mix(in srgb, var(--accent) 22%, var(--card))"
                : "var(--card)",
          }}
          transition={spring}
          stroke={stroke}
          strokeWidth={station ? 3 : 2}
          strokeDasharray={unconfirmed ? "2.5 2" : undefined}
        />
      )}
      {status === "dropped" && node && (
        <g stroke="var(--label-3)" strokeWidth={1.6} strokeLinecap="round">
          <line x1={x - r * 0.55} y1={y - r * 0.55} x2={x + r * 0.55} y2={y + r * 0.55} />
          <line x1={x - r * 0.55} y1={y + r * 0.55} x2={x + r * 0.55} y2={y - r * 0.55} />
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
