import { motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ListedEntry } from "../lib/api.ts";
import { groupByDay } from "../lib/format.ts";
import { KindGlyph, Pill, StatusPill } from "./ui.tsx";

interface Props {
  entries: ListedEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fresh: Set<string>;
  /** Show the project name on each row (cross-project lists). */
  projectNames?: Record<string, string>;
  label: string;
}

export function Timeline({ entries, selectedId, onSelect, fresh, projectNames, label }: Props) {
  const [focused, setFocused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = entries.findIndex((x) => x.id === selectedId);
    const next = e.key === "ArrowDown" ? Math.min(entries.length - 1, i + 1) : Math.max(0, i - 1);
    const target = entries[next];
    if (target) onSelect(target.id);
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="h-full overflow-y-auto outline-none"
    >
      {groupByDay(entries).map(([day, items]) => (
        <section key={day} aria-label={day}>
          <h3
            className="t-section sticky top-0 z-10 px-5 pt-3 pb-1.5 backdrop-blur-xl"
            style={{ background: "color-mix(in srgb, var(--content) 82%, transparent)" }}
          >
            {day}
          </h3>
          <div className="px-2.5 pb-1">
            {items.map((e) => (
              <Row
                key={e.id}
                entry={e}
                selected={e.id === selectedId}
                emphasised={focused}
                fresh={fresh.has(e.id)}
                projectName={projectNames?.[e.projectId]}
                onSelect={() => onSelect(e.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({
  entry,
  selected,
  emphasised,
  fresh,
  projectName,
  onSelect,
}: {
  entry: ListedEntry;
  selected: boolean;
  emphasised: boolean;
  fresh: boolean;
  projectName: string | undefined;
  onSelect: () => void;
}) {
  const retired = entry.status === "superseded" || entry.status === "reverted";
  const onAccent = selected && emphasised;
  const label = onAccent ? "var(--accent-text)" : retired ? "var(--label-2)" : "var(--label)";
  const secondary = onAccent
    ? "color-mix(in srgb, var(--accent-text) 80%, transparent)"
    : "var(--label-2)";
  const tertiary = onAccent
    ? "color-mix(in srgb, var(--accent-text) 70%, transparent)"
    : "var(--label-3)";

  return (
    <motion.div
      layout="position"
      initial={fresh ? { opacity: 0, y: -6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      role="option"
      aria-selected={selected}
      data-id={entry.id}
      onMouseDown={onSelect}
      className="flex gap-3 rounded-[8px] px-2.5 py-2"
      style={{
        background: selected
          ? emphasised
            ? "var(--accent)"
            : "var(--fill-selected-inactive)"
          : undefined,
      }}
    >
      <div className="pt-[1px]">
        <KindGlyph kind={entry.kind} muted={retired && !onAccent} onAccent={onAccent} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {fresh && (
            <span
              className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] self-center rounded-full"
              style={{ background: onAccent ? "var(--accent-text)" : "var(--accent)" }}
              aria-label="New"
            />
          )}
          <span
            className="t-headline min-w-0 flex-1 truncate"
            style={{
              color: label,
              textDecoration: retired ? "line-through" : undefined,
              textDecorationColor: tertiary,
            }}
          >
            {entry.title}
          </span>
        </div>
        <p className="t-callout mt-0.5 line-clamp-2" style={{ color: secondary }}>
          {entry.summary}
        </p>
        {(entry.reviewState === "needs_review" || entry.status !== "active" || projectName) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {projectName && (
              <span className="t-caption" style={{ color: tertiary }}>
                {projectName}
              </span>
            )}
            {entry.reviewState === "needs_review" && !onAccent && (
              <Pill tone="orange">Unconfirmed</Pill>
            )}
            {entry.reviewState === "needs_review" && onAccent && (
              <span className="t-caption font-medium" style={{ color: secondary }}>
                Unconfirmed
              </span>
            )}
            {!onAccent && <StatusPill status={entry.status} />}
          </div>
        )}
      </div>
    </motion.div>
  );
}
