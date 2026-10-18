import type { EntryDetail, ProjectSummary } from "@atlas/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CornerDownLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ListedEntry } from "../lib/api.ts";
import { longDate } from "../lib/format.ts";
import { keys, useEntry } from "../lib/queries.ts";
import { ProjectOverview } from "./Blocks.tsx";
import { PivotExplainer } from "./trajectory/PivotExplainer.tsx";
import { Alternatives, EntryMeta, EvidenceList, Lineage, SectionTitle } from "./parts.tsx";
import { Button, KindGlyph, Kbd, SkeletonRows } from "./ui.tsx";

export function Inspector({
  entryId,
  project,
  projectEntries,
  projectNames,
}: {
  entryId: string | null;
  project: ProjectSummary | null;
  projectEntries: ListedEntry[];
  projectNames: Record<string, string>;
}) {
  const { data: entry, isLoading } = useEntry(entryId);

  return (
    <div className="h-full overflow-y-auto">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={entryId ?? project?.id ?? "none"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="mx-auto max-w-[680px] px-8 pt-6 pb-16"
        >
          {entryId && isLoading && <SkeletonRows rows={4} />}
          {entry && <EntryView entry={entry} projectName={projectNames[entry.projectId]} />}
          {!entryId && project && <ProjectOverview project={project} entries={projectEntries} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function EntryView({
  entry,
  projectName,
}: {
  entry: EntryDetail;
  projectName: string | undefined;
}) {
  return (
    <article aria-labelledby="entry-title">
      {entry.reviewState === "needs_review" && <ReviewBar entry={entry} />}
      <header className="flex gap-3.5">
        <KindGlyph kind={entry.kind} size={36} />
        <div className="min-w-0 flex-1">
          <h1 id="entry-title" className="t-title1 selectable">
            {entry.title}
          </h1>
          <div className="mt-1.5">
            <EntryMeta entry={entry} projectName={projectName} />
          </div>
        </div>
      </header>

      {entry.supersededBy && <SupersededNotice entry={entry} />}

      {entry.change && (
        <section
          className="mt-5 rounded-[12px] p-4"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-card)" }}
        >
          <PivotExplainer
            change={entry.change}
            showWhy={false}
            fromName="Before"
            toName="Now"
            at={entry.decidedAt}
            compact
          />
        </section>
      )}

      <p className="selectable mt-5 text-[15px] leading-[22px]">{entry.summary}</p>

      <section className="mt-7">
        <SectionTitle>Why</SectionTitle>
        <p className="selectable t-body">{entry.rationale}</p>
      </section>

      {entry.alternatives.length > 0 && (
        <section className="mt-7">
          <SectionTitle>Alternatives considered</SectionTitle>
          <Alternatives entry={entry} />
        </section>
      )}

      <section className="mt-7">
        <SectionTitle>Evidence</SectionTitle>
        <EvidenceList entry={entry} />
      </section>

      {entry.lineage.length > 1 && (
        <section className="mt-7">
          <SectionTitle>History</SectionTitle>
          <Lineage chain={entry.lineage} currentId={entry.id} />
        </section>
      )}

      <footer className="t-caption mt-10" style={{ color: "var(--label-3)" }}>
        Decided {longDate(entry.decidedAt)}
        {entry.source === "adr"
          ? " · Imported from docs/decisions"
          : entry.source === "manual"
            ? " · Logged via MCP"
            : " · Extracted by Atlas"}
        {entry.source === "extracted" ? ` · ${Math.round(entry.confidence * 100)}% confidence` : ""}
      </footer>
    </article>
  );
}

function SupersededNotice({ entry }: { entry: EntryDetail }) {
  const next = entry.supersededBy!;
  return (
    <div
      className="t-body mt-4 flex items-center gap-2 rounded-[8px] px-3 py-2"
      style={{ background: "var(--fill)" }}
    >
      <span style={{ color: "var(--label-2)" }}>
        {entry.status === "resolved" ? "Resolved by" : "Replaced by"}
      </span>
      <span className="font-medium">{next.title}</span>
    </div>
  );
}

function ReviewBar({ entry }: { entry: EntryDetail }) {
  const client = useQueryClient();
  const review = useMutation({
    mutationFn: (state: "confirmed" | "dismissed") => api.review(entry.id, state),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.entry(entry.id) });
      void client.invalidateQueries({ queryKey: keys.entries(entry.projectId) });
      void client.invalidateQueries({ queryKey: keys.review });
      void client.invalidateQueries({ queryKey: keys.projects });
    },
  });
  const agentOnly = entry.evidence.length > 0 && entry.source === "extracted";
  return (
    <div
      className="mb-6 flex items-center gap-3 rounded-[10px] px-3.5 py-2.5"
      style={{ background: "color-mix(in srgb, var(--orange) 10%, transparent)" }}
      role="region"
      aria-label="Review"
    >
      <CircleAlert size={16} className="shrink-0" style={{ color: "var(--orange)" }} aria-hidden />
      <p className="t-body min-w-0 flex-1">
        {agentOnly
          ? "Atlas isn't sure this was agreed. Check the evidence."
          : "This entry hasn't been confirmed."}
      </p>
      <Button
        size="small"
        variant="secondary"
        onClick={() => review.mutate("dismissed")}
        disabled={review.isPending}
        title="Dismiss (⌘⌫)"
      >
        Dismiss
      </Button>
      <Button
        size="small"
        variant="primary"
        onClick={() => review.mutate("confirmed")}
        disabled={review.isPending}
        title="Confirm (⌘↩)"
      >
        Confirm <CornerDownLeft size={11} />
      </Button>
      <span className="sr-only">
        Shortcuts: <Kbd>⌘↩</Kbd> confirm, <Kbd>⌘⌫</Kbd> dismiss
      </span>
    </div>
  );
}
