import type { Feature, UsageReport } from "@atlas/core";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { shortDate } from "../lib/format.ts";
import { EmptyState, Segmented, SkeletonRows } from "./ui.tsx";

/** One color per feature, in fixed order (validated: CVD-safe in light and dark). */
const FEATURES: { id: Feature; label: string; detail: string; color: string }[] = [
  {
    id: "decisions",
    label: "Reading sessions",
    detail: "Finding decisions in Claude sessions",
    color: "var(--series-1)",
  },
  {
    id: "roadmap",
    label: "Roadmaps",
    detail: "Building and updating trajectories",
    color: "var(--series-2)",
  },
  {
    id: "ask",
    label: "Ask Atlas",
    detail: "Answers composed in the canvas",
    color: "var(--series-3)",
  },
];
const meta = (f: Feature) => FEATURES.find((x) => x.id === f)!;

const usd = (v: number) => (v < 0.01 && v > 0 ? "<$0.01" : `$${v.toFixed(v < 10 ? 2 : 0)}`);
const tokens = (v: number) =>
  v >= 1e6
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1e3
      ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`
      : `${v}`;

type Range = "7" | "30" | "90";

/** What Atlas spends on Claude: totals, per day by feature, per project, recent calls. */
export function Usage() {
  const [range, setRange] = useState<Range>("30");
  const { data, isLoading } = useQuery({
    queryKey: ["usage", range],
    queryFn: () => api.usage(Number(range)),
  });

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-4 px-6 pt-5 pb-10">
        <div className="flex items-center justify-between">
          <p className="t-callout" style={{ color: "var(--label-2)" }}>
            Estimated from Anthropic list prices. Your Anthropic bill is the source of truth.
          </p>
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
          />
        </div>

        {isLoading && <SkeletonRows rows={4} />}
        {data && data.total.calls === 0 && (
          <div className="h-[360px]">
            <EmptyState
              icon={Coins}
              title="No Claude calls yet"
              message="Atlas records every call it makes to Claude here, with its tokens and estimated cost."
            />
          </div>
        )}
        {data && data.total.calls > 0 && <UsageBody data={data} />}
      </div>
    </div>
  );
}

function UsageBody({ data }: { data: UsageReport }) {
  const totalTokens = data.total.inputTokens + data.total.outputTokens;
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label={`Estimated cost · ${data.days} days`} value={usd(data.total.costUsd)} hero />
        <Stat
          label="Tokens"
          value={tokens(totalTokens)}
          sub={`${tokens(data.total.inputTokens)} in · ${tokens(data.total.outputTokens)} out`}
        />
        <Stat
          label="Claude calls"
          value={String(data.total.calls)}
          sub={data.total.calls ? `${usd(data.total.costUsd / data.total.calls)} per call` : ""}
        />
      </div>

      <section
        className="rounded-[12px] px-4 pt-3.5 pb-3"
        style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
        aria-label="Cost per day"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="t-headline">Cost per day</h3>
          <Legend present={new Set(data.byFeature.map((f) => f.feature))} />
        </div>
        <DailyBars data={data} />
      </section>

      <div className="grid grid-cols-2 gap-4">
        <Table
          title="By feature"
          rows={data.byFeature.map((f) => ({
            key: f.feature,
            swatch: meta(f.feature).color,
            name: meta(f.feature).label,
            detail: meta(f.feature).detail,
            calls: f.calls,
            tokens: f.tokens,
            cost: f.costUsd,
          }))}
          total={data.total.costUsd}
        />
        <Table
          title="By project"
          rows={data.byProject.map((p) => ({
            key: p.projectId ?? "none",
            name: p.name ?? "Across projects",
            calls: p.calls,
            tokens: p.tokens,
            cost: p.costUsd,
          }))}
          total={data.total.costUsd}
        />
      </div>

      <section
        className="rounded-[12px] py-2"
        style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
        aria-label="Recent calls"
      >
        <h3 className="t-headline px-4 pt-1.5 pb-2">Recent calls</h3>
        <table className="t-callout w-full">
          <tbody>
            {data.recent.map((r) => (
              <tr
                key={`${r.at}${r.feature}${r.tokens}`}
                style={{ borderTop: "0.5px solid var(--separator)" }}
              >
                <td className="py-1.5 pl-4 tabular-nums" style={{ color: "var(--label-3)" }}>
                  {new Date(r.at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ background: meta(r.feature).color }}
                      aria-hidden
                    />
                    {meta(r.feature).label}
                  </span>
                </td>
                <td className="py-1.5" style={{ color: "var(--label-2)" }}>
                  {r.projectName ?? "—"}
                </td>
                <td className="py-1.5" style={{ color: "var(--label-3)" }}>
                  {r.model.replace("claude-", "")}
                </td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--label-2)" }}>
                  {tokens(r.tokens)}
                </td>
                <td className="py-1.5 pr-4 text-right font-medium tabular-nums">
                  {usd(r.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  hero = false,
}: {
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
}) {
  return (
    <div
      className="rounded-[12px] px-4 py-3.5"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="t-callout" style={{ color: "var(--label-2)" }}>
        {label}
      </div>
      <div className={`${hero ? "t-large-title" : "t-title1"} mt-0.5 tabular-nums`}>{value}</div>
      {sub && (
        <div className="t-caption mt-0.5" style={{ color: "var(--label-3)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Legend({ present }: { present: Set<Feature> }) {
  return (
    <ul className="flex gap-3" aria-label="Legend">
      {FEATURES.filter((f) => present.has(f.id)).map((f) => (
        <li
          key={f.id}
          className="t-caption flex items-center gap-1.5"
          style={{ color: "var(--label-2)" }}
        >
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: f.color }} aria-hidden />
          {f.label}
        </li>
      ))}
    </ul>
  );
}

/** Stacked bars: one per day, segments by feature in fixed order, 2px surface gaps. */
function DailyBars({ data }: { data: UsageReport }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = useMemo(() => {
    const out: { day: string; parts: Record<Feature, number>; total: number }[] = [];
    for (let i = data.days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const parts = { decisions: 0, roadmap: 0, ask: 0 } as Record<Feature, number>;
      for (const r of data.byDay) if (r.day === day) parts[r.feature] += r.costUsd;
      out.push({ day, parts, total: parts.decisions + parts.roadmap + parts.ask });
    }
    return out;
  }, [data]);

  const H = 160;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const max = Math.max(...days.map((d) => d.total), 0.0001);
  const step = (w - pad.l - pad.r) / days.length;
  const bar = Math.max(2, Math.min(18, step - 3));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        width={w}
        height={H}
        className="block"
        role="img"
        aria-label={`Estimated cost per day over ${data.days} days; highest ${usd(max)}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--separator)" />
            <text
              x={pad.l - 6}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--label-3)"
              className="tabular-nums"
            >
              {usd(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.l + i * step + (step - bar) / 2;
          let top = H - pad.b;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect
                x={pad.l + i * step}
                y={pad.t}
                width={step}
                height={H - pad.t - pad.b}
                fill="transparent"
              />
              {FEATURES.map((f) => {
                const v = d.parts[f.id];
                if (!v) return null;
                const h = Math.max(1.5, ((H - pad.t - pad.b) * v) / max);
                top -= h;
                const rect = (
                  <rect
                    key={f.id}
                    x={x}
                    y={top + 1}
                    width={bar}
                    height={Math.max(0.5, h - 2)}
                    rx={Math.min(3, bar / 3)}
                    fill={f.color}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                );
                return rect;
              })}
              {i % labelEvery === 0 && (
                <text
                  x={x + bar / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={10.5}
                  fill="var(--label-3)"
                >
                  {shortDate(`${d.day}T12:00:00.000Z`)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && days[hover] && days[hover].total > 0 && (
        <div
          className="pointer-events-none absolute z-10 w-[190px] rounded-[10px] px-3 py-2"
          style={{
            left: Math.min(w - 200, Math.max(0, pad.l + hover * step + step / 2 - 95)),
            top: 0,
            background: "var(--elevated)",
            boxShadow: "var(--shadow-pop)",
          }}
          role="tooltip"
        >
          <div className="t-caption font-semibold">
            {shortDate(`${days[hover].day}T12:00:00.000Z`)}
          </div>
          {FEATURES.filter((f) => days[hover]!.parts[f.id] > 0).map((f) => (
            <div
              key={f.id}
              className="t-caption mt-0.5 flex items-center gap-1.5"
              style={{ color: "var(--label-2)" }}
            >
              <span className="h-2 w-2 rounded-[2px]" style={{ background: f.color }} aria-hidden />
              <span className="flex-1">{f.label}</span>
              <span className="tabular-nums" style={{ color: "var(--label)" }}>
                {usd(days[hover]!.parts[f.id])}
              </span>
            </div>
          ))}
          <div
            className="t-caption mt-1 flex justify-between pt-1 font-semibold"
            style={{ borderTop: "0.5px solid var(--separator)" }}
          >
            <span>Total</span>
            <span className="tabular-nums">{usd(days[hover].total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Table({
  title,
  rows,
  total,
}: {
  title: string;
  rows: {
    key: string;
    swatch?: string;
    name: string;
    detail?: string;
    calls: number;
    tokens: number;
    cost: number;
  }[];
  total: number;
}) {
  return (
    <section
      className="rounded-[12px] py-2"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
      aria-label={title}
    >
      <h3 className="t-headline px-4 pt-1.5 pb-2">{title}</h3>
      <ul>
        {rows.map((r) => (
          <li
            key={r.key}
            className="px-4 py-2"
            style={{ borderTop: "0.5px solid var(--separator)" }}
          >
            <div className="flex items-baseline gap-2">
              {r.swatch && (
                <span
                  className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-[3px]"
                  style={{ background: r.swatch }}
                  aria-hidden
                />
              )}
              <span className="t-body min-w-0 flex-1 truncate">{r.name}</span>
              <span className="t-body font-medium tabular-nums">{usd(r.cost)}</span>
            </div>
            <div className="t-caption mt-0.5 flex gap-2" style={{ color: "var(--label-3)" }}>
              {r.detail && <span className="truncate">{r.detail}</span>}
              <span className="ml-auto shrink-0 tabular-nums">
                {r.calls} {r.calls === 1 ? "call" : "calls"} · {tokens(r.tokens)} tokens ·{" "}
                {total ? Math.round((r.cost / total) * 100) : 0}%
              </span>
            </div>
            <div className="mt-1.5 h-[3px] rounded-full" style={{ background: "var(--fill)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${total ? (r.cost / total) * 100 : 0}%`,
                  background: r.swatch ?? "var(--label-3)",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
