import type { Project } from "@atlas/core";
import { existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { importAdrs } from "../adr.ts";
import type { Bus } from "../bus.ts";
import type { Config } from "../config.ts";
import type { Extractor } from "../extract/llm.ts";
import { reconcile } from "../extract/reconcile.ts";
import type { Mirror } from "../mirror.ts";
import { applyProgress, applySessionPlan, renderTrajectory } from "../plan/session.ts";
import type { TrajectoryStore } from "../plan/store.ts";
import type { Store } from "../store.ts";
import { isDirectory, resolveProject } from "./project.ts";
import { redact } from "./redact.ts";
import { completeLines, parseTranscript, type Turn } from "./transcript.ts";

export const HookEvent = z.object({
  session_id: z.string().min(1),
  transcript_path: z.string().min(1),
  cwd: z.string().optional(),
  hook_event_name: z.string().default("SessionEnd"),
});
export type HookEvent = z.infer<typeof HookEvent>;

const CONTEXT_TURNS = 12;
const CHUNK_CHARS = 120_000;

export interface IngestorDeps {
  store: Store;
  config: Config;
  bus: Bus;
  mirror: Mirror;
  /** Null until an API key is configured. */
  extractor: () => Extractor | null;
  /** Module 2: when present, sessions also move the project's trajectory. */
  trajectory?: TrajectoryStore;
  /** Whether a project has plan documents (then its docs, not sessions, define its roadmap). */
  hasPlanDocs?: (projectId: string) => boolean;
  /** Called after a session is processed, e.g. to re-check the project's git history. */
  onProjectActivity?: (projectId: string) => void;
  log?: (msg: string) => void;
  now?: () => string;
}

/** Splits turns so each extraction call stays well inside the model's context. */
export function chunkTurns(turns: Turn[], maxChars = CHUNK_CHARS): Turn[][] {
  const chunks: Turn[][] = [];
  let cur: Turn[] = [];
  let size = 0;
  for (const t of turns) {
    const len =
      Math.min(t.text.length, t.role === "user" ? 20_000 : t.role === "choice" ? 12_000 : 6_000) +
      80;
    if (cur.length && size + len > maxChars) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export class Ingestor {
  private readonly deps: IngestorDeps;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Serialises processing so two hooks for one session never race. */
  private chain: Promise<void> = Promise.resolve();

  constructor(deps: IngestorDeps) {
    this.deps = deps;
  }

  private get now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  private log(msg: string): void {
    (this.deps.log ?? ((m) => console.log(`[atlasd] ${m}`)))(msg);
  }

  /** Hook entry point. `Stop` fires after every turn, so it is debounced. */
  onHook(event: HookEvent): void {
    const key = event.session_id;
    clearTimeout(this.timers.get(key));
    const delay = event.hook_event_name === "Stop" ? this.deps.config.stopDebounceMs : 0;
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.enqueue(event.transcript_path, event.cwd);
      }, delay),
    );
  }

  enqueue(transcriptPath: string, cwdHint?: string): Promise<void> {
    const job = this.chain.then(() => this.process(transcriptPath, cwdHint));
    this.chain = job.catch(() => undefined);
    return job;
  }

  /** Register a project folder by hand (and import its decision records). */
  addProject(rootPath: string): Project {
    const project = this.deps.store.upsertProject(resolveProject(rootPath), this.now);
    this.syncAdrs(project);
    this.deps.bus.emit({ type: "project.changed", projectId: project.id });
    return project;
  }

  syncAdrs(project: Project): void {
    const res = importAdrs(this.deps.store, project, this.now);
    for (const e of res.errors) this.log(`ADR ${project.name}/${e.file}: ${e.error}`);
    for (const id of res.imported)
      this.deps.bus.emit({ type: "entry.changed", projectId: project.id, entryId: id });
  }

  private resolveProjectRoot = (root: string): Project | null => {
    if (!root.startsWith("/") || !isDirectory(root) || this.deps.store.isIgnored(root)) return null;
    const project = this.deps.store.upsertProject(resolveProject(root), this.now);
    this.syncAdrs(project);
    return project;
  };

  private async process(transcriptPath: string, cwdHint?: string): Promise<void> {
    const { store, bus } = this.deps;
    if (!existsSync(transcriptPath)) return;
    const size = statSync(transcriptPath).size;
    const parsed = parseTranscript(completeLines(readFileSync(transcriptPath, "utf8")));
    const sessionId = parsed.sessionId ?? basename(transcriptPath, ".jsonl");
    const cwd = parsed.cwd ?? cwdHint;
    if (!cwd) return;

    const lastTs = parsed.turns.at(-1)?.timestamp ?? this.now;
    const resolved = resolveProject(cwd);
    // Folders the user stopped tracking are skipped before anything is stored or sent.
    if (store.isIgnored(resolved.rootPath) || store.isIgnored(cwd)) return;
    const project = store.upsertProject(resolved, lastTs);
    this.syncAdrs(project);
    let session = store.upsertSession({
      id: sessionId,
      projectId: project.id,
      transcriptPath,
      title: parsed.title,
    });
    bus.emit({ type: "project.changed", projectId: project.id });

    if (parsed.turns.length <= session.processedTurns) {
      store.updateSession(sessionId, { byteOffset: size, state: "done", error: null });
      return;
    }

    const extractor = this.deps.extractor();
    if (!extractor) {
      store.updateSession(sessionId, { byteOffset: size, state: "waiting_for_key" });
      bus.emit({
        type: "session.changed",
        projectId: project.id,
        sessionId,
        state: "waiting_for_key",
      });
      return;
    }

    store.updateSession(sessionId, { state: "pending", error: null });
    const redacted = parsed.turns.map((t) => ({ ...t, text: redact(t.text) }));
    let processed = session.processedTurns;
    try {
      for (const chunk of chunkTurns(redacted.slice(processed))) {
        const knownProjects = store.listProjects();
        const tstore = this.deps.trajectory;
        // Roadmaps of the session's project and of any project the turns mention by path or name.
        const chunkText = chunk.map((t) => t.text).join("\n");
        const mentioned = knownProjects.filter(
          (p) =>
            p.id === project.id ||
            chunkText.includes(p.rootPath) ||
            chunkText.includes(p.rootPath.replace(/^\/Users\/[^/]+/, "~")) ||
            (p.name.length >= 4 &&
              new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
                chunkText,
              )),
        );
        // Existing entries come from the projects in this conversation, so older ones in a
        // busy project never fall out of view (which would let duplicates in).
        const shown = mentioned.flatMap((p) => [
          ...store.listEntries({ projectId: p.id, status: "active", limit: 150 }),
          ...store.listEntries({ projectId: p.id, status: "resolved", limit: 20 }),
        ]);
        const withRoadmap = tstore
          ? mentioned.filter((p) => tstore.hasTrajectory(p.id)).slice(0, 3)
          : [];
        const hasDocs = (id: string) => this.deps.hasPlanDocs?.(id) ?? true;
        const sessionManaged = new Set(withRoadmap.filter((p) => !hasDocs(p.id)).map((p) => p.id));
        const trajectory = withRoadmap.length
          ? withRoadmap
              .map(
                (p) =>
                  `## ${p.name} (${p.rootPath})${sessionManaged.has(p.id) ? ' managed_by="sessions"' : ""}\n${renderTrajectory(tstore!.data(p.id), this.now) ?? ""}`,
              )
              .join("\n\n")
          : undefined;
        // A session may start a roadmap only for its own project, only when that project has
        // neither a roadmap nor plan docs, and not when the turns are about another known project.
        const aboutOtherProject = mentioned.some((p) => p.id !== project.id);
        const noRoadmap =
          !!tstore &&
          !!this.deps.hasPlanDocs &&
          !tstore.hasTrajectory(project.id) &&
          !hasDocs(project.id) &&
          !aboutOtherProject;
        const batch = await extractor.extract({
          sessionProject: project,
          knownProjects,
          existing: shown,
          contextTurns: redacted.slice(Math.max(0, processed - CONTEXT_TURNS), processed),
          newTurns: chunk,
          ...(trajectory ? { trajectory } : {}),
          ...(noRoadmap ? { noRoadmap } : {}),
        });
        if (tstore && noRoadmap && batch.newPlan) {
          const started = store.db.transaction(() =>
            applySessionPlan(
              batch.newPlan!,
              { store: tstore, projectId: project.id, sessionId, newTurns: chunk },
              (m) => this.log(m),
            ),
          )();
          if (started) {
            this.log(`trajectory: started a roadmap for ${project.name} from a session`);
            bus.emit({ type: "trajectory.changed", projectId: project.id });
          }
        }
        if (tstore && trajectory && batch.progress.length) {
          const moved = store.db.transaction(() =>
            applyProgress(
              batch.progress,
              {
                store: tstore,
                projectId: project.id,
                projectIds: withRoadmap.map((p) => p.id),
                sessionManaged,
                sessionId,
                newTurns: chunk,
                now: this.now,
              },
              (m) => this.log(m),
            ),
          )();
          for (const pid of moved.projects)
            bus.emit({ type: "trajectory.changed", projectId: pid });
        }
        const outcome = reconcile(batch.entries, {
          store,
          sessionId,
          sessionProject: project,
          newTurns: chunk,
          shownIds: new Set(shown.map((e) => e.id)),
          resolveProjectRoot: this.resolveProjectRoot,
          now: this.now,
        });
        for (const id of [...outcome.saved, ...outcome.merged]) {
          const entry = store.getEntry(id);
          if (!entry) continue;
          const owner = store.getProject(entry.projectId);
          if (owner && entry.source !== "adr") this.deps.mirror.write(entry, owner);
          bus.emit({ type: "entry.changed", projectId: entry.projectId, entryId: id });
        }
        for (const r of outcome.rejected) this.log(`rejected "${r.title}": ${r.reason}`);
        processed += chunk.length;
        store.updateSession(sessionId, { processedTurns: processed, lastProcessedAt: this.now });
      }
      store.updateSession(sessionId, { byteOffset: size, state: "done", error: null });
      session = store.getSession(sessionId)!;
      this.log(`processed ${sessionId} (${project.name}): ${session.processedTurns} turns`);
      bus.emit({ type: "session.changed", projectId: project.id, sessionId, state: "done" });
      this.deps.onProjectActivity?.(project.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.updateSession(sessionId, { state: "error", error: message.slice(0, 500) });
      bus.emit({ type: "session.changed", projectId: project.id, sessionId, state: "error" });
      this.log(`error processing ${sessionId}: ${message}`);
    }
    bus.emit({ type: "status.changed" });
  }

  /** Re-run sessions that were waiting for a key or failed. */
  async retryStalled(): Promise<void> {
    const { store } = this.deps;
    const stalled = [
      ...store.sessionsInState("waiting_for_key"),
      ...store.sessionsInState("error"),
    ];
    for (const s of stalled) await this.enqueue(s.transcriptPath);
  }

  /** Pick up transcripts that changed while no hook reached us. */
  async scanAll(): Promise<number> {
    const root = this.deps.config.claudeProjectsDir;
    if (!isDirectory(root)) return 0;
    let queued = 0;
    for (const dir of readdirSync(root)) {
      const full = join(root, dir);
      if (!isDirectory(full)) continue;
      for (const f of readdirSync(full)) {
        if (!f.endsWith(".jsonl")) continue;
        const path = join(full, f);
        const session = this.deps.store.getSession(basename(f, ".jsonl"));
        if (session && session.byteOffset === statSync(path).size && session.state === "done")
          continue;
        queued++;
        await this.enqueue(path);
      }
    }
    return queued;
  }

  /** Replay hook events written while the daemon was down. */
  async drainSpool(): Promise<number> {
    const spool = this.deps.config.spoolPath;
    if (!existsSync(spool)) return 0;
    const processing = `${spool}.processing`;
    renameSync(spool, processing);
    const lines = readFileSync(processing, "utf8").split("\n").filter(Boolean);
    const latest = new Map<string, HookEvent>();
    for (const l of lines) {
      try {
        const ev = HookEvent.parse(JSON.parse(l));
        latest.set(ev.session_id, ev);
      } catch {
        // skip malformed spool line
      }
    }
    for (const ev of latest.values()) await this.enqueue(ev.transcript_path, ev.cwd);
    renameSync(processing, `${spool}.done`);
    return latest.size;
  }
}
