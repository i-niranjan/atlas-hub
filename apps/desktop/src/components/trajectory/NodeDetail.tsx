import type { NodeDetail as Detail, TrajectoryData } from "@atlas/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, FileText, GitCommitVertical, MessageSquareQuote, X } from "lucide-react";
import { api } from "../../lib/api.ts";
import { longDate, shortDate } from "../../lib/format.ts";
import { keys } from "../../lib/queries.ts";
import { SectionTitle } from "../parts.tsx";
import { Button, Pill } from "../ui.tsx";
import { STATUS_LABEL } from "./TrajectoryMap.tsx";

const SOURCE_LABEL: Record<string, string> = {
  doc: "from the docs",
  session: "from a Claude session",
  plan: "from a plan",
  git: "from a commit",
  manual: "by you",
};

const EVIDENCE_ICON = {
  doc: FileText,
  quote: MessageSquareQuote,
  commit: GitCommitVertical,
} as const;

export function NodeDetail({
  nodeId,
  projectId,
  data,
  onClose,
  onSelectNode,
}: {
  nodeId: string;
  projectId: string;
  data: TrajectoryData;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const client = useQueryClient();
  const { data: d } = useQuery({ queryKey: ["node", nodeId], queryFn: () => api.node(nodeId) });
  const review = useMutation({
    mutationFn: (state: "confirmed" | "dismissed") => api.reviewNode(nodeId, state),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["node", nodeId] });
      void client.invalidateQueries({ queryKey: keys.trajectory(projectId) });
    },
  });
  if (!d) return <aside className="w-[340px] shrink-0" />;
  const children = data.nodes.filter((n) => n.parentId === d.node.id);

  return (
    <aside
      className="flex w-[340px] shrink-0 flex-col overflow-y-auto"
      style={{ borderLeft: "0.5px solid var(--separator)" }}
      aria-label="Item detail"
    >
      <div className="flex items-start gap-2 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <div className="t-caption font-semibold" style={{ color: "var(--label-2)" }}>
            {d.node.kind === "milestone"
              ? "Milestone"
              : d.node.kind === "pivot"
                ? "Pivot"
                : d.node.kind === "goal"
                  ? "Goal"
                  : "Story"}
            {d.node.key ? ` · ${d.node.key}` : ""}
            {d.track ? ` · ${d.track.name}` : ""}
          </div>
          <h2 className="t-title2 selectable mt-1">{d.node.title}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.status && (
              <Pill
                tone={
                  d.status === "done"
                    ? "green"
                    : d.status === "in_progress"
                      ? "accent"
                      : d.status === "blocked"
                        ? "orange"
                        : "neutral"
                }
              >
                {STATUS_LABEL[d.status]}
              </Pill>
            )}
            {d.node.reviewState === "needs_review" && <Pill tone="orange">Unconfirmed</Pill>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="-mr-1 flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--fill)]"
          style={{ color: "var(--label-2)" }}
        >
          <X size={15} />
        </button>
      </div>

      {d.node.reviewState === "needs_review" && (
        <div
          className="mx-5 mt-4 rounded-[10px] px-3 py-2.5"
          style={{ background: "color-mix(in srgb, var(--orange) 10%, transparent)" }}
        >
          <p className="t-callout flex gap-2">
            <CircleAlert
              size={14}
              className="mt-[1px] shrink-0"
              style={{ color: "var(--orange)" }}
            />
            Atlas isn't sure about this change. Check the evidence.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="small"
              onClick={() => review.mutate("dismissed")}
              disabled={review.isPending}
            >
              Undo it
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={() => review.mutate("confirmed")}
              disabled={review.isPending}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}

      {d.track?.reason && d.node.kind === "pivot" && (
        <section className="px-5 pt-5">
          <SectionTitle>Why the direction changed</SectionTitle>
          <p className="t-body selectable">{d.track.reason}</p>
        </section>
      )}

      {children.length > 0 && (
        <Children data={data} ids={children.map((c) => c.id)} onSelect={onSelectNode} />
      )}

      <section className="px-5 pt-5">
        <SectionTitle>History</SectionTitle>
        <History d={d} />
      </section>

      <section className="px-5 pt-5 pb-8">
        <SectionTitle>Evidence</SectionTitle>
        <ul className="space-y-3">
          {d.evidence.map((e) => {
            const Icon = EVIDENCE_ICON[e.kind];
            return (
              <li key={`${e.kind}${e.ref}${e.excerpt}`} className="flex gap-2.5">
                <Icon
                  size={13}
                  className="mt-[3px] shrink-0"
                  style={{ color: "var(--label-3)" }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="t-callout selectable">
                    {e.kind === "commit" ? e.excerpt : `“${e.excerpt}”`}
                  </p>
                  <p className="t-caption mt-0.5 truncate" style={{ color: "var(--label-3)" }}>
                    {e.kind === "commit"
                      ? `Commit ${e.ref.slice(0, 7)}`
                      : e.kind === "doc"
                        ? e.ref
                        : "Claude session"}{" "}
                    · {shortDate(e.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

function History({ d }: { d: Detail }) {
  const items = d.history.filter((e) => e.type === "node_created" || e.type === "node_status");
  return (
    <ol className="relative space-y-3">
      {items.map((e, i) => (
        <li key={e.id} className="relative flex gap-3">
          {i < items.length - 1 && (
            <span
              className="absolute top-[12px] bottom-[-14px] left-[4px] w-px"
              style={{ background: "var(--separator-strong)" }}
              aria-hidden
            />
          )}
          <span
            className="mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full"
            style={{
              background:
                e.value === "done"
                  ? "var(--green)"
                  : e.value === "in_progress"
                    ? "var(--accent)"
                    : "var(--label-3)",
            }}
          />
          <div className="min-w-0">
            <div className="t-callout">
              {d.node.kind === "pivot" && e.type === "node_created"
                ? "Direction changed"
                : e.type === "node_created" && e.value === "planned"
                  ? "Planned"
                  : STATUS_LABEL[e.value as keyof typeof STATUS_LABEL]}{" "}
              <span style={{ color: "var(--label-3)" }}>{SOURCE_LABEL[e.source] ?? ""}</span>
            </div>
            <div className="t-caption" style={{ color: "var(--label-3)" }}>
              {longDate(e.at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Children({
  data,
  ids,
  onSelect,
}: {
  data: TrajectoryData;
  ids: string[];
  onSelect: (id: string) => void;
}) {
  const now = new Date().toISOString();
  const statusOf = (id: string) => {
    const evs = data.events.filter(
      (e) =>
        e.subjectId === id &&
        (e.type === "node_created" || e.type === "node_status") &&
        e.at <= now,
    );
    return (evs.at(-1)?.value ?? "planned") as keyof typeof STATUS_LABEL;
  };
  return (
    <section className="px-5 pt-5">
      <SectionTitle>Stories</SectionTitle>
      <ul>
        {ids.map((id) => {
          const n = data.nodes.find((x) => x.id === id)!;
          const s = statusOf(id);
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                className="t-callout flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-1 text-left hover:bg-[var(--fill)]"
              >
                <span
                  className="h-[8px] w-[8px] shrink-0 rounded-full"
                  style={{
                    background: s === "done" ? "var(--green)" : "transparent",
                    boxShadow:
                      s === "done"
                        ? undefined
                        : `inset 0 0 0 1.5px ${s === "in_progress" ? "var(--accent)" : "var(--label-3)"}`,
                  }}
                  aria-label={STATUS_LABEL[s]}
                />
                {n.key && <span className="font-semibold">{n.key}</span>}
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    color: s === "dropped" ? "var(--label-3)" : undefined,
                    textDecoration: s === "dropped" ? "line-through" : undefined,
                  }}
                >
                  {n.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
