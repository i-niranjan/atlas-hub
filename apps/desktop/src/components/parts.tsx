import type { EntryDetail } from "@atlas/core";
import { ArrowRight, Quote } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { longDate, shortDate } from "../lib/format.ts";
import { KindGlyph, kindMeta, Pill, StatusPill } from "./ui.tsx";

/** Lets any block open an entry in the inspector, wherever it is rendered. */
export const NavContext = createContext<{ openEntry: (id: string) => void }>({
  openEntry: () => undefined,
});
export const useNav = () => useContext(NavContext);

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="t-section mb-2">{children}</h3>;
}

export function EntryMeta({
  entry,
  projectName,
}: {
  entry: EntryDetail;
  projectName?: string | undefined;
}) {
  return (
    <div
      className="t-callout flex flex-wrap items-center gap-x-2 gap-y-1"
      style={{ color: "var(--label-2)" }}
    >
      <span style={{ color: kindMeta(entry.kind).color }} className="font-medium">
        {kindMeta(entry.kind).label}
      </span>
      <span aria-hidden>·</span>
      <time dateTime={entry.decidedAt} title={longDate(entry.decidedAt)}>
        {shortDate(entry.decidedAt)}
      </time>
      {projectName && (
        <>
          <span aria-hidden>·</span>
          <span>{projectName}</span>
        </>
      )}
      <StatusPill status={entry.status} />
      {entry.reviewState === "needs_review" && <Pill tone="orange">Unconfirmed</Pill>}
    </div>
  );
}

export function EvidenceQuote({
  quote,
  source,
}: {
  quote: string;
  source?: string | null | undefined;
}) {
  return (
    <figure className="flex gap-2.5">
      <Quote
        size={13}
        className="mt-[3px] shrink-0"
        style={{ color: "var(--label-3)" }}
        aria-hidden
      />
      <div className="min-w-0">
        <blockquote className="selectable t-body" style={{ color: "var(--label)" }}>
          {quote}
        </blockquote>
        {source && (
          <figcaption className="t-caption mt-0.5" style={{ color: "var(--label-3)" }}>
            {source}
          </figcaption>
        )}
      </div>
    </figure>
  );
}

export function Alternatives({ entry }: { entry: EntryDetail }) {
  if (!entry.alternatives.length) return null;
  return (
    <ul className="space-y-2">
      {entry.alternatives.map((a) => (
        <li key={a.option} className="t-body selectable">
          <span className="font-medium">{a.option}</span>
          <span style={{ color: "var(--label-2)" }}> — {a.whyNot}</span>
        </li>
      ))}
    </ul>
  );
}

function evidenceSource(entry: EntryDetail, sessionId: string): string | null {
  if (sessionId === "mcp") return "Logged from a Claude session";
  const s = entry.sessions.find((x) => x.id === sessionId);
  return s?.title ? `Session · ${s.title}` : "Claude Code session";
}

export function EvidenceList({ entry, limit }: { entry: EntryDetail; limit?: number }) {
  const items = limit ? entry.evidence.slice(0, limit) : entry.evidence;
  return (
    <div className="space-y-3">
      {items.map((ev) => (
        <EvidenceQuote
          key={ev.quote}
          quote={ev.quote}
          source={evidenceSource(entry, ev.sessionId)}
        />
      ))}
    </div>
  );
}

/**
 * The supersession chain as a vertical timeline. Each step after the first
 * shows its rationale: the "why we changed" that a plain list would lose.
 */
export function Lineage({
  chain,
  currentId,
  entries,
}: {
  chain: EntryDetail["lineage"];
  currentId?: string;
  entries?: Record<string, EntryDetail>;
}) {
  const { openEntry } = useNav();
  return (
    <ol className="relative">
      {chain.map((step, i) => {
        const full = entries?.[step.id];
        const current = step.id === currentId;
        const last = i === chain.length - 1;
        return (
          <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                className="absolute top-[24px] bottom-[-2px] left-[10.5px] w-px"
                style={{ background: "var(--separator-strong)" }}
                aria-hidden
              />
            )}
            <KindGlyph
              kind={step.kind}
              muted={step.status !== "active" && step.status !== "resolved"}
            />
            <div className="min-w-0 flex-1 pt-[1px]">
              <button
                type="button"
                onClick={() => openEntry(step.id)}
                disabled={current}
                className="t-headline text-left hover:underline disabled:no-underline"
                style={{ color: current ? "var(--label)" : "var(--label)" }}
              >
                {step.title}
              </button>
              <div
                className="t-caption mt-0.5 flex items-center gap-1.5"
                style={{ color: "var(--label-3)" }}
              >
                <span>{shortDate(step.decidedAt)}</span>
                {step.status !== "active" && <StatusPill status={step.status} />}
                {current && <Pill tone="accent">Viewing</Pill>}
              </div>
              {full && i > 0 && (
                <p className="t-callout selectable mt-1.5" style={{ color: "var(--label-2)" }}>
                  {full.rationale}
                </p>
              )}
              {full && i === 0 && (
                <p className="t-callout selectable mt-1.5" style={{ color: "var(--label-2)" }}>
                  {full.summary}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OpenLink({ id, children }: { id: string; children: ReactNode }) {
  const { openEntry } = useNav();
  return (
    <button
      type="button"
      onClick={() => openEntry(id)}
      className="t-callout inline-flex items-center gap-1 font-medium hover:underline"
      style={{ color: "var(--accent)" }}
    >
      {children}
      <ArrowRight size={12} />
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[10px] p-4 ${className}`}
      style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </div>
  );
}
