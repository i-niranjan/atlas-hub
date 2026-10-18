import type { Lens, ProjectSummary, StatusReport } from "@atlas/core";
import { Coins, Folder, Inbox, Layers, Plus, Settings, Signpost, Waypoints, X } from "lucide-react";
import { ContextMenu } from "radix-ui";
import type { ReactNode } from "react";
import { isTauri } from "../lib/api.ts";

async function revealInFinder(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
import type { LiveState } from "../lib/queries.ts";

export type Selection =
  | { kind: "project"; projectId: string }
  | { kind: "review" }
  | { kind: "usage" }
  | { kind: "lens"; projectId: string; lens: Lens };

interface Props {
  projects: ProjectSummary[] | undefined;
  lenses: Lens[];
  reviewCount: number;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  /** Which view of the selected project is showing. */
  view: "decisions" | "trajectory" | null;
  onSelectView: (projectId: string, view: "decisions" | "trajectory") => void;
  onStopTracking: (project: ProjectSummary) => void;
  onDeleteLens: (id: string) => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
  status: StatusReport | undefined;
  live: LiveState;
}

const RECENT_MS = 15 * 60_000;

function Row({
  selected,
  icon,
  label,
  badge,
  indicator,
  onClick,
  trailing,
  indent = false,
}: {
  selected: boolean;
  icon: ReactNode;
  label: string;
  badge?: number;
  indicator?: ReactNode;
  onClick: () => void;
  trailing?: ReactNode;
  indent?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "page" : undefined}
        className={`t-body flex h-[28px] w-full items-center gap-2 rounded-[6px] pr-2 text-left ${indent ? "pl-7" : "pl-2"}`}
        style={{ background: selected ? "var(--fill-2)" : undefined }}
      >
        <span
          className="flex w-[18px] justify-center"
          style={{ color: selected ? "var(--accent)" : "var(--label-2)" }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {indicator}
        {badge !== undefined && badge > 0 && (
          <span className="t-callout tabular-nums" style={{ color: "var(--label-3)" }}>
            {badge}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-4 mb-1 flex h-5 items-center justify-between pr-1 pl-2">
      <span className="t-section">{children}</span>
      {action}
    </div>
  );
}

export function Sidebar(props: Props) {
  const { projects, selection, status } = props;
  const now = Date.now();
  const selectedProject =
    selection && (selection.kind === "project" || selection.kind === "lens")
      ? selection.projectId
      : null;

  return (
    <nav aria-label="Sidebar" className="flex h-full w-[232px] shrink-0 flex-col">
      <div className="drag h-[52px] shrink-0" data-tauri-drag-region />
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <Row
          selected={selection?.kind === "review"}
          icon={<Inbox size={16} strokeWidth={1.8} />}
          label="Needs Review"
          badge={props.reviewCount}
          onClick={() => props.onSelect({ kind: "review" })}
        />
        <Row
          selected={selection?.kind === "usage"}
          icon={<Coins size={16} strokeWidth={1.8} />}
          label="Usage"
          onClick={() => props.onSelect({ kind: "usage" })}
        />

        <SectionHeader
          action={
            <button
              type="button"
              aria-label="Track a project folder"
              title="Track a project folder"
              onClick={props.onAddProject}
              className="flex h-5 w-5 items-center justify-center rounded-[4px] hover:bg-[var(--fill)]"
              style={{ color: "var(--label-2)" }}
            >
              <Plus size={14} />
            </button>
          }
        >
          Projects
        </SectionHeader>

        {projects?.length === 0 && (
          <p className="t-callout px-2 py-1" style={{ color: "var(--label-3)" }}>
            Projects appear here after a Claude Code session ends.
          </p>
        )}

        {projects?.map((p) => {
          const active = now - new Date(p.lastActive).getTime() < RECENT_MS;
          const isSelected =
            selection?.kind === "project" && selection.projectId === p.id && props.view === null;
          return (
            <div key={p.id}>
              <ContextMenu.Root>
                <ContextMenu.Trigger asChild>
                  <div>
                    <Row
                      selected={isSelected}
                      icon={<Folder size={16} strokeWidth={1.8} />}
                      label={p.name}
                      badge={p.counts.total}
                      indicator={
                        active ? (
                          <span
                            className="pulse h-1.5 w-1.5 rounded-full"
                            style={{ background: "var(--green)" }}
                            title="A session ended in the last 15 minutes"
                            aria-label="Recently active"
                          />
                        ) : null
                      }
                      onClick={() => props.onSelect({ kind: "project", projectId: p.id })}
                    />
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    className="z-50 min-w-[190px] rounded-[8px] p-1"
                    style={{ background: "var(--elevated)", boxShadow: "var(--shadow-pop)" }}
                  >
                    {isTauri && (
                      <ContextMenu.Item
                        className="t-body flex h-[24px] items-center rounded-[5px] px-2.5 outline-none data-[highlighted]:bg-[var(--accent)] data-[highlighted]:text-[var(--accent-text)]"
                        onSelect={() => void revealInFinder(p.rootPath)}
                      >
                        Show in Finder
                      </ContextMenu.Item>
                    )}
                    <ContextMenu.Item
                      className="t-body flex h-[24px] items-center rounded-[5px] px-2.5 outline-none data-[highlighted]:bg-[var(--accent)] data-[highlighted]:text-[var(--accent-text)]"
                      onSelect={() => props.onStopTracking(p)}
                    >
                      Stop Tracking…
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
              {selectedProject === p.id && (
                <>
                  <Row
                    indent
                    selected={selection?.kind === "project" && props.view === "decisions"}
                    icon={<Signpost size={14} strokeWidth={1.8} />}
                    label="Decisions"
                    onClick={() => props.onSelectView(p.id, "decisions")}
                  />
                  <Row
                    indent
                    selected={selection?.kind === "project" && props.view === "trajectory"}
                    icon={<Waypoints size={14} strokeWidth={1.8} />}
                    label="Trajectory"
                    onClick={() => props.onSelectView(p.id, "trajectory")}
                  />
                </>
              )}
              {selectedProject === p.id &&
                props.lenses.map((lens) => (
                  <Row
                    key={lens.id}
                    indent
                    selected={selection?.kind === "lens" && selection.lens.id === lens.id}
                    icon={<Layers size={14} strokeWidth={1.8} />}
                    label={lens.title}
                    onClick={() => props.onSelect({ kind: "lens", projectId: p.id, lens })}
                    trailing={
                      <button
                        type="button"
                        aria-label={`Remove lens ${lens.title}`}
                        onClick={() => props.onDeleteLens(lens.id)}
                        className="absolute top-1/2 right-1.5 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] group-hover:flex hover:bg-[var(--fill-2)]"
                        style={{ color: "var(--label-2)" }}
                      >
                        <X size={12} />
                      </button>
                    }
                  />
                ))}
            </div>
          );
        })}
      </div>

      <footer
        className="flex h-[44px] shrink-0 items-center gap-2 px-4"
        style={{ borderTop: "0.5px solid var(--separator)" }}
      >
        <CaptureStatus status={status} live={props.live} onFix={props.onOpenSettings} />
        <button
          type="button"
          aria-label="Settings"
          title="Settings (⌘,)"
          onClick={props.onOpenSettings}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] hover:bg-[var(--fill)]"
          style={{ color: "var(--label-2)" }}
        >
          <Settings size={15} strokeWidth={1.8} />
        </button>
      </footer>
    </nav>
  );
}

function CaptureStatus({
  status,
  live,
  onFix,
}: {
  status: StatusReport | undefined;
  live: LiveState;
  onFix: () => void;
}) {
  let color = "var(--green)";
  let text = "Capturing sessions";
  let actionable = false;
  if (live === "offline") {
    color = "var(--red)";
    text = "Service not running";
    actionable = true;
  } else if (!status) {
    color = "var(--label-3)";
    text = "Connecting…";
  } else if (!status.hooksInstalled) {
    color = "var(--orange)";
    text = "Capture not installed";
    actionable = true;
  } else if (!status.hasApiKey) {
    color = "var(--orange)";
    text =
      status.queue.waitingForKey > 0
        ? `${status.queue.waitingForKey} waiting for API key`
        : "Add an API key";
    actionable = true;
  } else if (status.queue.errors > 0) {
    color = "var(--orange)";
    text = `${status.queue.errors} session${status.queue.errors === 1 ? "" : "s"} failed`;
    actionable = true;
  }
  const content = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="t-callout truncate" style={{ color: "var(--label-2)" }}>
        {text}
      </span>
    </>
  );
  return actionable ? (
    <button
      type="button"
      onClick={onFix}
      className="flex min-w-0 flex-1 items-center gap-2 text-left"
    >
      {content}
    </button>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-2" role="status">
      {content}
    </div>
  );
}
