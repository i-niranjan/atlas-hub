import type { Heading as HeadingData, TrajectoryState } from "@atlas/core";
import { scopeSize } from "@atlas/core";
import { CircleAlert, Split } from "lucide-react";
import { motion } from "motion/react";

/** Progress ring: the number reads at a glance, the arc confirms it. */
export function Ring({
  done,
  total,
  size = 44,
  color = "var(--accent)",
}: {
  done: number;
  total: number;
  size?: number;
  color?: string;
}) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg
      className="shrink-0"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`${done} of ${total} done`}
      role="img"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--fill-2)"
        strokeWidth={4}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ type: "spring", stiffness: 120, damping: 22 }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size > 50 ? 15 : 11}
        fontWeight={650}
        fill="var(--label)"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

export function HeadingCard({
  heading: h,
  state,
  onSelectNode,
}: {
  heading: HeadingData;
  state: TrajectoryState;
  onSelectNode: (id: string) => void;
}) {
  const scope = scopeSize(state);
  return (
    <div
      className="@container flex items-stretch gap-5 rounded-[12px] px-5 py-4"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex min-w-0 flex-[1.4] items-center gap-4">
        <Ring done={scope.done} total={scope.total} size={58} />
        <div className="min-w-0">
          <div className="t-section">Heading toward</div>
          <div className="t-title2 mt-0.5 line-clamp-2">
            {h.goal?.title ?? h.track?.name ?? "No direction recorded"}
          </div>
          <div
            className="t-callout mt-1 flex items-center gap-2"
            style={{ color: "var(--label-2)" }}
          >
            {h.track && <span>{h.track.name}</span>}
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {scope.done}/{scope.total} done
            </span>
          </div>
        </div>
      </div>

      <div className="w-px self-stretch" style={{ background: "var(--separator)" }} />

      <div className="flex min-w-0 flex-[1.6] items-center gap-4">
        {h.milestones.length === 0 && (
          <span className="t-body" style={{ color: "var(--label-2)" }}>
            Every planned milestone is done.
          </span>
        )}
        {h.milestones.map((m, i) => (
          <button
            key={m.node.id}
            type="button"
            onClick={() => onSelectNode(m.node.id)}
            className={`min-w-0 flex-1 items-center gap-2.5 rounded-[8px] p-1 text-left hover:bg-[var(--fill)] ${i === 2 ? "hidden @[880px]:flex" : "flex"}`}
          >
            <Ring
              done={m.done}
              total={m.total}
              size={38}
              color={i === 0 ? "var(--accent)" : "var(--label-3)"}
            />
            <div className="min-w-0">
              <div
                className="t-caption font-semibold whitespace-nowrap"
                style={{ color: i === 0 ? "var(--accent)" : "var(--label-2)" }}
              >
                {i === 0 ? "Now" : i === 1 ? "Next" : "Then"}
                {m.node.key ? ` · ${m.node.key}` : ""}
              </div>
              <div className="t-callout truncate font-medium">{m.node.title}</div>
              <div className="t-caption tabular-nums" style={{ color: "var(--label-3)" }}>
                {m.done}/{m.total}
              </div>
            </div>
          </button>
        ))}
      </div>

      {(h.now.story || h.blocked.length > 0 || h.abandoned.length > 0) && (
        <>
          <div
            className="hidden w-px self-stretch @[760px]:block"
            style={{ background: "var(--separator)" }}
          />
          <div className="hidden w-[210px] shrink-0 flex-col justify-center gap-1.5 @[760px]:flex">
            {h.now.story && (
              <button
                type="button"
                onClick={() => onSelectNode(h.now.story!.id)}
                className="rounded-[8px] px-2 py-1 text-left hover:bg-[var(--fill)]"
              >
                <div className="t-caption" style={{ color: "var(--label-3)" }}>
                  Working on
                </div>
                <div className="t-callout truncate font-medium">
                  {h.now.story.key ? `${h.now.story.key} · ` : ""}
                  {h.now.story.title}
                </div>
              </button>
            )}
            {h.blocked.length > 0 && (
              <div
                className="t-caption flex items-center gap-1.5 px-2"
                style={{ color: "var(--orange)" }}
              >
                <CircleAlert size={12} /> {h.blocked.length} blocked
              </div>
            )}
            {h.abandoned.length > 0 && (
              <div
                className="t-caption flex items-center gap-1.5 px-2"
                style={{ color: "var(--label-2)" }}
                title={h.abandoned.map((t) => `${t.name}: ${t.reason ?? ""}`).join("\n")}
              >
                <Split size={12} style={{ color: "var(--pink)" }} /> {h.abandoned.length} earlier
                direction{h.abandoned.length === 1 ? "" : "s"} abandoned
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
