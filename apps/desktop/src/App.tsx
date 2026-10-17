import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  FolderOpen,
  KeyRound,
  PlugZap,
  Search,
  Sparkles,
  SquareDashedMousePointer,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { Canvas } from "./components/Canvas.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { NavContext } from "./components/parts.tsx";
import { Settings } from "./components/Settings.tsx";
import { Sidebar, type Selection } from "./components/Sidebar.tsx";
import { Timeline } from "./components/Timeline.tsx";
import { LinkBanner } from "./components/trajectory/LinkBanner.tsx";
import { Trajectory } from "./components/trajectory/Trajectory.tsx";
import { Button, EmptyState, Kbd, Segmented, SkeletonRows } from "./components/ui.tsx";
import { api, isTauri, type ListedEntry } from "./lib/api.ts";
import { useCanvas } from "./lib/canvas.ts";
import { plural } from "./lib/format.ts";
import {
  keys,
  useEntries,
  useLiveUpdates,
  useProject,
  useProjects,
  useReviewQueue,
  useStatus,
} from "./lib/queries.ts";

type Filter = "all" | "decisions" | "architecture" | "open" | "pivots";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "decisions", label: "Decisions" },
  { value: "architecture", label: "Architecture" },
  { value: "open", label: "Open" },
  { value: "pivots", label: "Pivots" },
];

function matches(filter: Filter, e: ListedEntry): boolean {
  switch (filter) {
    case "all":
      return true;
    case "decisions":
      return e.kind === "decision" || e.kind === "constraint";
    case "architecture":
      return e.kind === "architecture";
    case "open":
      return e.kind === "open_question" || e.kind === "risk";
    case "pivots":
      return e.kind === "pivot" || e.supersedesId !== null;
  }
}

const STORED_PROJECT = "atlas.selectedProject";
const STORED_VIEW = "atlas.view";

type View = "decisions" | "trajectory";

/** `?view=trajectory&project=<id>` opens a specific view (deep links, screenshots). */
const urlParams = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;

function readStoredView(): View {
  const fromUrl = urlParams?.get("view");
  if (fromUrl === "trajectory" || fromUrl === "decisions") return fromUrl;
  try {
    return localStorage.getItem(STORED_VIEW) === "trajectory" ? "trajectory" : "decisions";
  } catch {
    return "decisions";
  }
}

function readStoredProject(): string | null {
  const fromUrl = urlParams?.get("project");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(STORED_PROJECT);
  } catch {
    return null;
  }
}

export function App() {
  const client = useQueryClient();
  const live = useLiveUpdates();
  const { data: status } = useStatus();
  const { data: projects, isLoading: projectsLoading, error: projectsError } = useProjects();
  const { data: reviewQueue = [] } = useReviewQueue();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [mode, setMode] = useState<"timeline" | "canvas">("timeline");
  const [filter, setFilter] = useState<Filter>("all");
  const [showRetired, setShowRetired] = useState(true);
  const [palette, setPalette] = useState<{ open: boolean; mode: "ask" | "search" }>({
    open: false,
    mode: "ask",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setViewState] = useState<View>(readStoredView);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const canvas = useCanvas();
  const setView = useCallback((v: View) => {
    setViewState(v);
    setMode("timeline");
    try {
      localStorage.setItem(STORED_VIEW, v);
    } catch {
      // per-viewer convenience only
    }
  }, []);

  // Restore the last project, or pick the most recently active one.
  useEffect(() => {
    if (selection || !projects?.length) return;
    const stored = readStoredProject();
    const p =
      projects.find((x) => x.id === stored) ??
      projects.find((x) => x.counts.total > 0) ??
      projects[0]!;
    setSelection({ kind: "project", projectId: p.id });
  }, [projects, selection]);

  const projectId = selection && selection.kind !== "review" ? selection.projectId : null;
  const project = projects?.find((p) => p.id === projectId) ?? null;
  const { data: projectDetail } = useProject(projectId);
  const { data: entries = [], isLoading: entriesLoading } = useEntries(projectId);
  const projectNames = useMemo(
    () => Object.fromEntries((projects ?? []).map((p) => [p.id, p.name])),
    [projects],
  );

  const select = useCallback(
    (s: Selection) => {
      setSelection(s);
      setEntryId(null);
      setNodeId(null);
      if (s.kind === "project") {
        try {
          localStorage.setItem(STORED_PROJECT, s.projectId);
        } catch {
          // per-viewer convenience only
        }
      }
      if (s.kind === "lens") {
        setMode("canvas");
        void canvas.ask(s.lens.prompt, s.projectId);
      } else {
        setMode("timeline");
      }
    },
    [canvas],
  );

  const listed = useMemo(() => {
    const source = selection?.kind === "review" ? reviewQueue : entries;
    return source.filter(
      (e) =>
        matches(filter, e) &&
        (showRetired || (e.status !== "superseded" && e.status !== "reverted")),
    );
  }, [selection, reviewQueue, entries, filter, showRetired]);

  const openEntry = useCallback(
    (id: string) => {
      const known = [...entries, ...reviewQueue].find((e) => e.id === id);
      void api.entry(id).then((d) => {
        if (selection?.kind !== "review" && d.projectId !== projectId) {
          setSelection({ kind: "project", projectId: d.projectId });
        }
        setMode("timeline");
        setViewState("decisions");
        setFilter("all");
        setEntryId(id);
      });
      if (known) setEntryId(id);
    },
    [entries, reviewQueue, selection, projectId],
  );

  const openNode = useCallback(
    (id: string) => {
      setView("trajectory");
      setNodeId(id);
    },
    [setView],
  );

  const ask = useCallback(
    (question: string) => {
      setMode("canvas");
      void canvas.ask(question, projectId);
    },
    [canvas, projectId],
  );

  const review = useMutation({
    mutationFn: ({ id, state }: { id: string; state: "confirmed" | "dismissed" }) =>
      api.review(id, state),
    onSuccess: () => void client.invalidateQueries(),
  });

  const addProject = useCallback(async () => {
    if (!isTauri) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Track a project folder" });
    if (typeof dir !== "string") return;
    const p = await api.addProject(dir);
    await client.invalidateQueries({ queryKey: keys.projects });
    select({ kind: "project", projectId: p.id });
  }, [client, select]);

  const pin = useMutation({
    mutationFn: (title: string) => api.saveLens(projectId, title, canvas.run.question),
    onSuccess: () =>
      projectId && void client.invalidateQueries({ queryKey: keys.project(projectId) }),
  });

  const deleteLens = useMutation({
    mutationFn: api.deleteLens,
    onSuccess: () => {
      if (projectId) void client.invalidateQueries({ queryKey: keys.project(projectId) });
      if (selection?.kind === "lens" && projectId) select({ kind: "project", projectId });
    },
  });

  // ── commands (keyboard + native menu) ─────────────────────
  const command = useCallback(
    (id: string) => {
      switch (id) {
        case "ask":
          setPalette({ open: true, mode: "ask" });
          break;
        case "search":
          setPalette({ open: true, mode: "search" });
          break;
        case "settings":
          setSettingsOpen(true);
          break;
        case "review":
          select({ kind: "review" });
          break;
        case "toggle-superseded":
          setShowRetired((v) => !v);
          break;
        case "add-project":
          void addProject();
          break;
        case "show-decisions":
          setView("decisions");
          break;
        case "show-trajectory":
          setView("trajectory");
          break;
      }
    },
    [select, addProject, setView],
  );

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("menu", (e) => command(e.payload)).then((u) => (unlisten = u)),
    );
    return () => unlisten?.();
  }, [command]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && mode === "canvas" && !palette.open && !settingsOpen) {
        setMode("timeline");
        return;
      }
      if (!e.metaKey) return;
      // In the app these arrive as menu events; handle them here for the browser build.
      if (!isTauri) {
        if (e.key === "k") return (e.preventDefault(), command("ask"));
        if (e.key === "f") return (e.preventDefault(), command("search"));
        if (e.key === ",") return (e.preventDefault(), command("settings"));
      }
      if (typing) return;
      const selected = listed.find((x) => x.id === entryId);
      if (e.key === "Enter" && selected?.reviewState === "needs_review") {
        e.preventDefault();
        review.mutate({ id: selected.id, state: "confirmed" });
      } else if (e.key === "Backspace" && selected?.reviewState === "needs_review") {
        e.preventDefault();
        review.mutate({ id: selected.id, state: "dismissed" });
      } else if (/^[1-9]$/.test(e.key) && projects) {
        const p = projects[Number(e.key) - 1];
        if (p) {
          e.preventDefault();
          select({ kind: "project", projectId: p.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [command, mode, palette.open, settingsOpen, listed, entryId, review, projects, select]);

  // ── render ────────────────────────────────────────────────
  const offline = live.state === "offline" && !!projectsError;
  const showDecisions = view === "decisions" || selection?.kind !== "project";
  const lens = selection?.kind === "lens" ? selection.lens : null;
  const title =
    selection?.kind === "review" ? "Needs Review" : lens ? lens.title : (project?.name ?? "Atlas");
  const subtitle =
    selection?.kind === "review"
      ? plural(reviewQueue.length, "unconfirmed entry", "unconfirmed entries")
      : project
        ? `${plural(project.counts.active, "active entry", "active entries")} · ${plural(project.sessionCount, "session")}`
        : "";

  return (
    <NavContext.Provider value={{ openEntry, openNode }}>
      <div className="flex h-full">
        <Sidebar
          projects={projects}
          lenses={projectDetail?.lenses ?? []}
          reviewCount={reviewQueue.length}
          selection={selection}
          onSelect={select}
          view={selection?.kind === "project" && mode === "timeline" ? view : null}
          onSelectView={(pid, v) => {
            if (selection?.kind !== "project" || selection.projectId !== pid) {
              select({ kind: "project", projectId: pid });
            }
            setView(v);
          }}
          onDeleteLens={(id) => deleteLens.mutate(id)}
          onAddProject={() => void addProject()}
          onOpenSettings={() => setSettingsOpen(true)}
          status={status}
          live={live.state}
        />

        <main
          className="flex min-w-0 flex-1 flex-col"
          style={{ background: "var(--content)", borderLeft: "0.5px solid var(--separator)" }}
        >
          <header
            className="drag flex h-[52px] shrink-0 items-center gap-3 px-4"
            data-tauri-drag-region
            style={{ borderBottom: "0.5px solid var(--separator)" }}
          >
            <div className="min-w-0 shrink" data-tauri-drag-region>
              <h1 className="t-headline truncate" data-tauri-drag-region>
                {title}
              </h1>
              {subtitle && (
                <p
                  className="t-caption truncate"
                  style={{ color: "var(--label-2)" }}
                  data-tauri-drag-region
                >
                  {subtitle}
                </p>
              )}
            </div>
            {selection?.kind === "project" && mode === "timeline" && !offline && (
              <Segmented
                label="View"
                options={[
                  { value: "decisions", label: "Decisions" },
                  { value: "trajectory", label: "Trajectory" },
                ]}
                value={view}
                onChange={setView}
              />
            )}
            <div className="flex-1" data-tauri-drag-region />
            {mode === "timeline" && !offline && projects?.length !== 0 && showDecisions && (
              <Segmented
                label="Filter entries"
                options={FILTERS}
                value={filter}
                onChange={setFilter}
              />
            )}
            <button
              type="button"
              onClick={() => command("search")}
              className="t-body flex h-[26px] w-[180px] items-center gap-1.5 rounded-[7px] px-2"
              style={{ background: "var(--fill-2)", color: "var(--label-3)" }}
              aria-label="Search (⌘F)"
            >
              <Search size={13} aria-hidden />
              <span className="flex-1 text-left">Search</span>
              <Kbd>⌘F</Kbd>
            </button>
            <Button
              variant="secondary"
              onClick={() => command("ask")}
              title="Ask Atlas (⌘K)"
              aria-label="Ask Atlas (⌘K)"
            >
              <Sparkles size={13} style={{ color: "var(--accent)" }} aria-hidden /> Ask
              <Kbd>⌘K</Kbd>
            </Button>
          </header>

          <LinkBanner projectId={projectId} />
          <div className="flex min-h-0 flex-1">
            {offline ? (
              <EmptyState
                icon={PlugZap}
                title="Atlas isn't running"
                message="The background service that captures your Claude Code sessions isn't responding. Install it once and it starts with your Mac."
              >
                <code
                  className="selectable t-callout rounded-[6px] px-3 py-1.5 font-mono"
                  style={{ background: "var(--fill)" }}
                >
                  node ~/WORK/atlas/packages/daemon/src/cli.ts install
                </code>
              </EmptyState>
            ) : projectsLoading ? (
              <div className="w-[380px]">
                <SkeletonRows />
              </div>
            ) : projects?.length === 0 ? (
              <EmptyState
                icon={SquareDashedMousePointer}
                title="Waiting for your first session"
                message="Work with Claude Code in any project. When the session ends, Atlas reads it and records what you decided."
              >
                <Button onClick={() => void addProject()}>
                  <FolderOpen size={13} /> Track a folder now
                </Button>
              </EmptyState>
            ) : mode === "canvas" ? (
              <div className="min-w-0 flex-1">
                <Canvas
                  run={canvas.run}
                  lensTitle={lens?.title ?? null}
                  onBack={() => setMode("timeline")}
                  onRetry={() => void canvas.ask(canvas.run.question, projectId)}
                  onPin={projectId ? (t) => pin.mutate(t) : null}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            ) : !showDecisions && projectId ? (
              <Trajectory
                projectId={projectId}
                decisions={entries}
                onOpenEntry={openEntry}
                selectedNodeId={nodeId}
                onSelectNode={setNodeId}
              />
            ) : (
              <>
                <div
                  className="flex w-[380px] shrink-0 flex-col"
                  style={{ borderRight: "0.5px solid var(--separator)" }}
                >
                  {entriesLoading && selection?.kind !== "review" ? (
                    <SkeletonRows />
                  ) : listed.length > 0 ? (
                    <Timeline
                      entries={listed}
                      selectedId={entryId}
                      onSelect={setEntryId}
                      fresh={live.fresh}
                      label={title}
                      {...(selection?.kind === "review" ? { projectNames } : {})}
                    />
                  ) : (
                    <ListEmpty
                      review={selection?.kind === "review"}
                      filtered={
                        filter !== "all" &&
                        (selection?.kind === "review" ? reviewQueue : entries).length > 0
                      }
                      waitingForKey={!status?.hasApiKey && (status?.queue.waitingForKey ?? 0) > 0}
                      onAddKey={() => setSettingsOpen(true)}
                      onClearFilter={() => setFilter("all")}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Inspector
                    entryId={entryId}
                    project={selection?.kind === "review" ? null : project}
                    projectEntries={entries}
                    projectNames={projectNames}
                  />
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={(open) => setPalette((p) => ({ ...p, open }))}
        initialMode={palette.mode}
        projectId={projectId}
        projectName={project?.name ?? null}
        projectNames={projectNames}
        onAsk={ask}
        onOpenEntry={(e) => openEntry(e.id)}
      />
      <Settings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        status={status}
        live={live.state}
      />
    </NavContext.Provider>
  );
}

function ListEmpty({
  review,
  filtered,
  waitingForKey,
  onAddKey,
  onClearFilter,
}: {
  review: boolean;
  filtered: boolean;
  waitingForKey: boolean;
  onAddKey: () => void;
  onClearFilter: () => void;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={Search}
        title="No matches"
        message="Nothing in this view matches the filter."
      >
        <Button size="small" onClick={onClearFilter}>
          Show all
        </Button>
      </EmptyState>
    );
  }
  if (review) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="All caught up"
        message="Entries Atlas isn't sure about will appear here for you to confirm or dismiss."
      />
    );
  }
  if (waitingForKey) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Sessions are waiting"
        message="Atlas has captured sessions for this project but needs an Anthropic API key to read them."
      >
        <Button variant="primary" size="small" onClick={onAddKey}>
          Add API key
        </Button>
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={SquareDashedMousePointer}
      title="Nothing recorded yet"
      message="Decisions show up here after a Claude Code session in this project ends."
    />
  );
}
