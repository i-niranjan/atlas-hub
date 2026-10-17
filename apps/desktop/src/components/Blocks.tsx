import type { Block, CanvasState, Entry, EntryDetail, ProjectSummary } from "@atlas/core";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { plural, shortDate, tildify } from "../lib/format.ts";
import {
  Alternatives,
  Card,
  EntryMeta,
  EvidenceList,
  Lineage,
  OpenLink,
  SectionTitle,
  useNav,
} from "./parts.tsx";
import { KindGlyph, Pill, StatusPill } from "./ui.tsx";

/**
 * Renders an agent-composed view (ADR 0005). Every entry comes from the
 * resolved store data in `state.entries`; blocks only arrange them.
 */
export function ViewRenderer({ state }: { state: CanvasState }) {
  if (!state.view) return null;
  return (
    <div className="space-y-5">
      {state.view.blocks.map((b, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34, delay: i * 0.05 }}
        >
          <BlockView block={b} state={state} />
        </motion.div>
      ))}
    </div>
  );
}

function BlockView({ block, state }: { block: Block; state: CanvasState }): ReactNode {
  const e = (id: string) => state.entries[id];
  switch (block.type) {
    case "DecisionCard": {
      const entry = e(block.entryId);
      return entry ? (
        <DecisionCard entry={entry} project={state.projects[entry.projectId]} />
      ) : null;
    }
    case "EntryList":
      return (
        <EntryListBlock
          title={block.title}
          entries={block.entryIds.map(e).filter((x): x is EntryDetail => !!x)}
          projects={state.projects}
        />
      );
    case "OpenQuestions":
      return (
        <EntryListBlock
          title="Open questions"
          entries={block.entryIds.map(e).filter((x): x is EntryDetail => !!x)}
          projects={state.projects}
        />
      );
    case "PivotLineage": {
      const entry = e(block.entryId);
      if (!entry) return null;
      return (
        <Card>
          <SectionTitle>How this evolved</SectionTitle>
          <Lineage chain={entry.lineage} entries={state.entries} />
        </Card>
      );
    }
    case "ArchitectureDiagram":
      return (
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="t-headline">{block.title}</h3>
            {block.sourceEntryIds.length > 0 && (
              <span className="t-caption" style={{ color: "var(--label-3)" }}>
                From {plural(block.sourceEntryIds.length, "recorded entry", "recorded entries")}
              </span>
            )}
          </div>
          <Mermaid source={block.mermaid} />
          {block.caption && (
            <p className="t-callout mt-3" style={{ color: "var(--label-2)" }}>
              {block.caption}
            </p>
          )}
          {block.sourceEntryIds.length > 0 && (
            <SourceChips
              entries={block.sourceEntryIds.map(e).filter((x): x is EntryDetail => !!x)}
            />
          )}
        </Card>
      );
    case "OptionsCompare":
      return (
        <Card>
          <h3 className="t-headline mb-3">{block.question}</h3>
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${Math.min(block.options.length, 3)}, minmax(0, 1fr))`,
            }}
          >
            {block.options.map((o) => (
              <div
                key={o.name}
                className="rounded-[8px] p-3"
                style={{
                  background: o.chosen
                    ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                    : "var(--fill)",
                  boxShadow: o.chosen
                    ? "inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent)"
                    : undefined,
                }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="t-headline">{o.name}</span>
                  {o.chosen && (
                    <CircleCheck size={14} style={{ color: "var(--accent)" }} aria-label="Chosen" />
                  )}
                </div>
                <ul className="t-callout space-y-1">
                  {o.pros.map((p) => (
                    <li key={p} className="flex gap-1.5">
                      <span style={{ color: "var(--green)" }}>+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                  {o.cons.map((c) => (
                    <li key={c} className="flex gap-1.5" style={{ color: "var(--label-2)" }}>
                      <span>−</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {block.sourceEntryId && e(block.sourceEntryId) && (
            <div className="mt-3">
              <OpenLink id={block.sourceEntryId}>{e(block.sourceEntryId)!.title}</OpenLink>
            </div>
          )}
        </Card>
      );
    case "ProjectOverview": {
      const p = state.projects[block.projectId];
      return p ? (
        <ProjectOverview
          project={p}
          entries={Object.values(state.entries).filter((x) => x.projectId === p.id)}
        />
      ) : null;
    }
    case "Callout": {
      const Icon = block.tone === "warning" ? TriangleAlert : Info;
      const c = block.tone === "warning" ? "var(--orange)" : "var(--accent)";
      return (
        <div
          className="t-body flex gap-2.5 rounded-[10px] px-3.5 py-3"
          style={{ background: `color-mix(in srgb, ${c} 9%, transparent)` }}
          role="note"
        >
          <Icon size={16} className="mt-[1px] shrink-0" style={{ color: c }} aria-hidden />
          <p className="selectable">{block.text}</p>
        </div>
      );
    }
    case "Markdown":
      return <Markdown text={block.text} />;
    case "KeyValue":
      return (
        <Card>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
            {block.items.map((it) => (
              <Fragment key={it.label}>
                <dt className="t-body" style={{ color: "var(--label-2)" }}>
                  {it.label}
                </dt>
                <dd className="t-body selectable">{it.value}</dd>
              </Fragment>
            ))}
          </dl>
        </Card>
      );
    case "Section":
      return (
        <section>
          <h2 className="t-title2 mb-3">{block.title}</h2>
          <div className="space-y-4">
            {block.blocks.map((b, i) => (
              <BlockView key={i} block={b} state={state} />
            ))}
          </div>
        </section>
      );
  }
}

/** Compact, evenly wrapping references back to the entries a block was built from. */
function SourceChips({ entries }: { entries: EntryDetail[] }) {
  const { openEntry } = useNav();
  if (!entries.length) return null;
  return (
    <div className="mt-4 pt-3" style={{ borderTop: "0.5px solid var(--separator)" }}>
      <div className="t-section mb-2">Based on</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => openEntry(x.id)}
            title={x.title}
            className="t-callout inline-flex h-[24px] max-w-[280px] items-center gap-1.5 rounded-[6px] pr-2 pl-1 hover:bg-[var(--fill-2)]"
            style={{ background: "var(--fill)" }}
          >
            <KindGlyph kind={x.kind} size={16} />
            <span className="truncate">{x.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DecisionCard({
  entry,
  project,
}: {
  entry: EntryDetail;
  project?: ProjectSummary | undefined;
}) {
  return (
    <Card>
      <div className="flex gap-3">
        <KindGlyph kind={entry.kind} size={28} />
        <div className="min-w-0 flex-1">
          <h3 className="t-title2">{entry.title}</h3>
          <div className="mt-1">
            <EntryMeta entry={entry} projectName={project?.name} />
          </div>
        </div>
      </div>
      <p className="t-body selectable mt-3">{entry.summary}</p>
      <p className="t-body selectable mt-2" style={{ color: "var(--label-2)" }}>
        {entry.rationale}
      </p>
      {entry.alternatives.length > 0 && (
        <div className="mt-4">
          <SectionTitle>Considered</SectionTitle>
          <Alternatives entry={entry} />
        </div>
      )}
      <div className="mt-4">
        <SectionTitle>Evidence</SectionTitle>
        <EvidenceList entry={entry} limit={2} />
      </div>
      <div className="mt-4">
        <OpenLink id={entry.id}>Open</OpenLink>
      </div>
    </Card>
  );
}

function EntryListBlock({
  title,
  entries,
  projects,
}: {
  title?: string | undefined;
  entries: EntryDetail[];
  projects: Record<string, ProjectSummary>;
}) {
  const { openEntry } = useNav();
  const multiProject = new Set(entries.map((x) => x.projectId)).size > 1;
  return (
    <Card className="!p-0">
      {title && <h3 className="t-headline px-4 pt-3.5 pb-1.5">{title}</h3>}
      <ul>
        {entries.map((x, i) => (
          <li
            key={x.id}
            style={{ borderTop: i === 0 && !title ? undefined : "0.5px solid var(--separator)" }}
          >
            <button
              type="button"
              onClick={() => openEntry(x.id)}
              className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-[var(--fill)]"
            >
              <KindGlyph kind={x.kind} muted={x.status === "superseded"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="t-headline min-w-0 flex-1 truncate">{x.title}</span>
                  <span className="t-caption shrink-0" style={{ color: "var(--label-3)" }}>
                    {shortDate(x.decidedAt)}
                  </span>
                </div>
                <p className="t-callout mt-0.5 line-clamp-2" style={{ color: "var(--label-2)" }}>
                  {x.summary}
                </p>
                {(multiProject || x.status !== "active" || x.reviewState === "needs_review") && (
                  <div className="mt-1 flex items-center gap-1.5">
                    {multiProject && (
                      <span className="t-caption" style={{ color: "var(--label-3)" }}>
                        {projects[x.projectId]?.name}
                      </span>
                    )}
                    <StatusPill status={x.status} />
                    {x.reviewState === "needs_review" && <Pill tone="orange">Unconfirmed</Pill>}
                  </div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProjectOverview({
  project,
  entries,
}: {
  project: ProjectSummary;
  entries: Entry[];
}) {
  const { openEntry } = useNav();
  const active = entries.filter((e) => e.status === "active" && e.reviewState !== "dismissed");
  const architecture = active.filter((e) => e.kind === "architecture");
  const decisions = active.filter((e) => e.kind === "decision" || e.kind === "constraint");
  const open = active.filter((e) => e.kind === "open_question" || e.kind === "risk");
  const pivots = entries.filter((e) => e.supersedesId);
  const group = (title: string, items: Entry[]) =>
    items.length > 0 && (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <ul className="space-y-1">
          {items.slice(0, 8).map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => openEntry(x.id)}
                className="t-body flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-1 text-left hover:bg-[var(--fill)]"
              >
                <KindGlyph kind={x.kind} size={18} />
                <span className="min-w-0 flex-1 truncate">{x.title}</span>
                {x.reviewState === "needs_review" && <Pill tone="orange">Unconfirmed</Pill>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <div className="space-y-6">
      <header>
        <h2 className="t-title1">{project.name}</h2>
        <p className="t-callout selectable mt-1 font-mono" style={{ color: "var(--label-2)" }}>
          {tildify(project.rootPath)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat value={project.counts.active} label="Active" />
          <Stat value={project.counts.needsReview} label="Unconfirmed" />
          <Stat
            value={project.sessionCount}
            label={project.sessionCount === 1 ? "Session" : "Sessions"}
          />
        </div>
      </header>
      {group("Architecture", architecture)}
      {group("Decisions and constraints", decisions)}
      {group("Open questions and risks", open)}
      {group("Pivots", pivots)}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[10px] px-3.5 py-3" style={{ background: "var(--fill)" }}>
      <div className="t-title1 tabular-nums">{value}</div>
      <div className="t-callout" style={{ color: "var(--label-2)" }}>
        {label}
      </div>
    </div>
  );
}

// ── Mermaid ─────────────────────────────────────────────────

function Mermaid({ source }: { source: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    void import("mermaid").then(async ({ default: mermaid }) => {
      // Mermaid needs literal colours, so mirror the design tokens for each scheme.
      const t = dark
        ? {
            fill: "#2c2c2e",
            border: "#48484a",
            text: "#ebebf0",
            line: "#7c7c80",
            label: "#a1a1a6",
            card: "#262628",
          }
        : {
            fill: "#f5f5f7",
            border: "#d1d1d6",
            text: "#1d1d1f",
            line: "#a1a1a6",
            label: "#6e6e73",
            card: "#ffffff",
          };
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        themeVariables: {
          darkMode: dark,
          fontSize: "13px",
          background: t.card,
          primaryColor: t.fill,
          primaryBorderColor: t.border,
          primaryTextColor: t.text,
          secondaryColor: t.fill,
          tertiaryColor: t.fill,
          lineColor: t.line,
          textColor: t.label,
          edgeLabelBackground: t.card,
          clusterBkg: "transparent",
          clusterBorder: t.border,
        },
        flowchart: {
          curve: "basis",
          padding: 14,
          nodeSpacing: 36,
          rankSpacing: 48,
          htmlLabels: true,
          // Fixed pixel size: render 1:1 instead of stretching to the card.
          useMaxWidth: false,
        },
      });
      try {
        const { svg } = await mermaid.render(`m${id}`, source);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (failed) {
    return (
      <div>
        <p className="t-callout mb-2" style={{ color: "var(--label-2)" }}>
          This diagram couldn't be drawn. Its source:
        </p>
        <pre
          className="selectable t-callout overflow-x-auto rounded-[8px] p-3 font-mono"
          style={{ background: "var(--fill)" }}
        >
          {source}
        </pre>
      </div>
    );
  }
  if (!svg) return <div className="skeleton h-40" />;
  return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ── Markdown (deliberately tiny: paragraphs, lists, bold, code) ─────────────

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code
          key={i}
          className="rounded-[4px] px-1 font-mono text-[12px]"
          style={{ background: "var(--fill-2)" }}
        >
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="selectable t-body space-y-2.5">
      {text.split(/\n{2,}/).map((para, i) => {
        const lines = para.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(para)}</p>;
      })}
    </div>
  );
}
