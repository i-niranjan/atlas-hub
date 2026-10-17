import type { TrajectoryData } from "@atlas/core";
import { scopeSeries } from "@atlas/core";
import { motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { shortDate } from "../../lib/format.ts";

/**
 * Planned work over time: the light area is everything in scope, the accent
 * area what's done. Markers show where scope grew or shrank.
 */
export function ScopeChart({ data, height = 92 }: { data: TrajectoryData; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = useMemo(() => scopeSeries(data), [data]);
  if (series.length < 1) return null;

  const pad = { l: 8, r: 8, t: 14, b: 18 };
  const now = new Date().toISOString();
  const t0 = Date.parse(series[0]!.at);
  const t1 = Math.max(Date.parse(now), t0 + 86_400_000);
  const max = Math.max(1, ...series.map((p) => p.total));
  const x = (iso: string) => pad.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);

  // Step series (scope changes at discrete moments), carried to now.
  const step = (key: "total" | "done") => {
    let d = `M ${x(series[0]!.at)} ${y(0)}`;
    let prev = 0;
    for (const p of series) {
      d += ` L ${x(p.at)} ${y(prev)} L ${x(p.at)} ${y(p[key])}`;
      prev = p[key];
    }
    d += ` L ${x(now)} ${y(prev)} L ${x(now)} ${y(0)} Z`;
    return d;
  };
  const marks = series.filter((p) => p.delta !== 0 && p !== series[0]);

  return (
    <div ref={box} className="relative" style={{ height }}>
      <svg
        width={w}
        height={height}
        className="block"
        role="img"
        aria-label={`Scope over time: ${series.at(-1)!.total} items planned, ${series.at(-1)!.done} done`}
      >
        <motion.path
          d={step("total")}
          fill="color-mix(in srgb, var(--label) 9%, transparent)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <motion.path
          d={step("done")}
          fill="color-mix(in srgb, var(--accent) 55%, transparent)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} stroke="var(--separator-strong)" />
        {marks.map((p) => {
          const grew = p.delta > 0;
          const cx = x(p.at);
          const cy = y(p.total) - 7;
          return (
            <g key={p.at}>
              <title>
                {`${shortDate(p.at)}: scope ${grew ? "grew" : "shrank"} by ${Math.abs(p.delta)} (now ${p.total})`}
              </title>
              <circle cx={cx} cy={cy} r={8} fill="transparent" />
              <path
                d={
                  grew
                    ? `M ${cx - 4} ${cy + 2.5} L ${cx} ${cy - 3} L ${cx + 4} ${cy + 2.5} Z`
                    : `M ${cx - 4} ${cy - 2.5} L ${cx} ${cy + 3} L ${cx + 4} ${cy - 2.5} Z`
                }
                fill={grew ? "var(--green)" : "var(--orange)"}
              />
            </g>
          );
        })}
        <text x={pad.l} y={height - 4} className="t-caption" fill="var(--label-3)">
          {shortDate(series[0]!.at)}
        </text>
        <text
          x={w - pad.r}
          y={height - 4}
          textAnchor="end"
          className="t-caption"
          fill="var(--label-3)"
        >
          Today
        </text>
        <text
          x={w - pad.r}
          y={pad.t - 3}
          textAnchor="end"
          className="t-caption tabular-nums"
          fill="var(--label-2)"
        >
          {series.at(-1)!.done}/{series.at(-1)!.total}
        </text>
      </svg>
    </div>
  );
}
