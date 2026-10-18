import type { Entry, PivotChange } from "@atlas/core";
import { ArrowRight, CircleSlash, Split } from "lucide-react";
import { shortDate } from "../../lib/format.ts";
import { useNav } from "../parts.tsx";
import { kindMeta } from "../ui.tsx";

/**
 * A change of direction for someone with no context: what it was, what it is
 * now, what concretely shifted, why, and what it cost. Rendered from the
 * structured pivot, never from a paragraph.
 */
export function PivotExplainer({
  change,
  fromName,
  toName,
  at,
  decisions = [],
  compact = false,
}: {
  change: PivotChange;
  fromName: string;
  toName: string;
  at?: string;
  decisions?: Entry[];
  compact?: boolean;
}) {
  const { openEntry } = useNav();
  const linked = change.entryIds
    .map((id) => decisions.find((d) => d.id === id))
    .filter((d): d is Entry => !!d);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div
          className="t-caption flex items-center gap-1.5 font-semibold"
          style={{ color: "var(--pink)" }}
        >
          <Split size={13} aria-hidden /> Change of direction{at ? ` · ${shortDate(at)}` : ""}
        </div>
      )}

      {/* Before → After */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <div className="rounded-[10px] px-3 py-2.5" style={{ background: "var(--fill)" }}>
          <div className="t-caption font-semibold" style={{ color: "var(--label-3)" }}>
            WAS · {fromName}
          </div>
          <div className="t-callout mt-1" style={{ color: "var(--label-2)" }}>
            {change.before}
          </div>
        </div>
        <div className="flex items-center" aria-hidden>
          <ArrowRight size={16} style={{ color: "var(--label-3)" }} />
        </div>
        <div
          className="rounded-[10px] px-3 py-2.5"
          style={{
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)",
          }}
        >
          <div className="t-caption font-semibold" style={{ color: "var(--accent)" }}>
            NOW · {toName}
          </div>
          <div className="t-callout mt-1 font-medium">{change.after}</div>
        </div>
      </div>

      {/* What concretely shifted */}
      {change.shifts.length > 0 && (
        <ul className="space-y-1.5" aria-label="What changed">
          {change.shifts.map((s) => (
            <li
              key={`${s.from}>${s.to}`}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
            >
              <span
                className="t-callout justify-self-end rounded-[6px] px-2 py-0.5 text-right"
                style={{
                  background: "var(--fill)",
                  color: "var(--label-2)",
                  textDecoration: "line-through",
                  textDecorationColor: "var(--label-3)",
                }}
              >
                {s.from}
              </span>
              <ArrowRight size={12} style={{ color: "var(--label-3)" }} aria-hidden />
              <span
                className="t-callout justify-self-start rounded-[6px] px-2 py-0.5 font-medium"
                style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
              >
                {s.to}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Why */}
      <div>
        <div className="t-section mb-1">Why</div>
        {change.why ? (
          <p className="t-body selectable">{change.why}</p>
        ) : (
          <p className="t-callout flex items-center gap-1.5" style={{ color: "var(--label-3)" }}>
            <CircleSlash size={12} aria-hidden /> Not recorded. No doc or decision says why.
          </p>
        )}
      </div>

      {change.cost && (
        <div>
          <div className="t-section mb-1">Given up or postponed</div>
          <p className="t-callout selectable" style={{ color: "var(--label-2)" }}>
            {change.cost}
          </p>
        </div>
      )}

      {linked.length > 0 && !compact && (
        <div>
          <div className="t-section mb-1.5">Decided in</div>
          <div className="flex flex-wrap gap-1.5">
            {linked.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => openEntry(d.id)}
                className="t-callout inline-flex h-[24px] max-w-[260px] items-center gap-1.5 rounded-[6px] px-2 hover:bg-[var(--fill-2)]"
                style={{ background: "var(--fill)" }}
                title={d.title}
              >
                <svg width={9} height={9} className="shrink-0" aria-hidden>
                  <path d="M 4.5 0 L 9 4.5 L 4.5 9 L 0 4.5 Z" fill={kindMeta(d.kind).color} />
                </svg>
                <span className="truncate">{d.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
