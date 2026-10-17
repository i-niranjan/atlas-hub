import type { Project } from "@atlas/core";
import { existsSync, watch, type FSWatcher } from "node:fs";
import type { Bus } from "../bus.ts";
import type { Store } from "../store.ts";
import { collectDocs, hashDocs } from "./docs.ts";
import type { PlanExtractor } from "./extract.ts";
import { applyCommits, readCommits, referencedForeignKeys } from "./git.ts";
import { applyPlan } from "./reconcile.ts";
import type { TrajectoryStore } from "./store.ts";

export interface EngineDeps {
  store: Store;
  trajectory: TrajectoryStore;
  bus: Bus;
  plansDir: string;
  extractor: () => PlanExtractor | null;
  log?: (m: string) => void;
  now?: () => string;
}

const DOC_DEBOUNCE_MS = 4_000;
const GIT_INTERVAL_MS = 5 * 60_000;

/** Keeps every project's trajectory in step with its docs, plans and commits. */
export class PlanEngine {
  private readonly deps: EngineDeps;
  private chain: Promise<void> = Promise.resolve();
  private readonly watchers: FSWatcher[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private gitTimer: NodeJS.Timeout | null = null;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  private get now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  private log(m: string): void {
    (this.deps.log ?? ((x) => console.log(`[atlasd] ${x}`)))(m);
  }

  private changed(projectId: string): void {
    this.deps.bus.emit({ type: "trajectory.changed", projectId });
  }

  /** Serialised so docs, git and links never interleave for one database. */
  private run(job: () => Promise<void>): Promise<void> {
    const next = this.chain.then(job);
    this.chain = next.catch((err: unknown) =>
      this.log(`trajectory: ${err instanceof Error ? err.message : String(err)}`),
    );
    return next;
  }

  sync(projectId: string, opts: { force?: boolean } = {}): Promise<void> {
    return this.run(async () => {
      await this.syncDocs(projectId, opts.force ?? false);
      this.syncGit(projectId);
    });
  }

  syncAll(): Promise<void> {
    return this.run(async () => {
      for (const p of this.deps.store.listProjects()) {
        await this.syncDocs(p.id, false);
        this.syncGit(p.id);
      }
    });
  }

  private async syncDocs(projectId: string, force: boolean): Promise<void> {
    const { store, trajectory } = this.deps;
    const project = store.getProject(projectId);
    if (!project) return;
    const roots = store
      .rootsOf(projectId)
      .map((r) => r.path)
      .filter(existsSync);
    const docs = collectDocs(roots, project, store.listProjects(), this.deps.plansDir);
    if (!docs.length) return;
    const hash = hashDocs(docs);
    if (!force && trajectory.docHash(projectId) === hash) return;
    const extractor = this.deps.extractor();
    if (!extractor) return;
    const data = trajectory.data(projectId);
    this.log(`trajectory: reading ${docs.length} docs for ${project.name}`);
    const extraction = await extractor.extract({
      projectName: project.name,
      docs,
      tracks: data.tracks,
      nodes: data.nodes,
    });
    const res = store.db.transaction(() =>
      applyPlan(extraction, { store: trajectory, projectId, docs, now: this.now }),
    )();
    trajectory.setDocHash(projectId, hash, this.now);
    for (const r of res.rejected.slice(0, 10))
      this.log(`trajectory: rejected "${r.title}": ${r.reason}`);
    this.log(
      `trajectory: ${project.name}: ${res.created} new, ${res.changed} changed, ${res.rejected.length} rejected`,
    );
    this.changed(projectId);
  }

  private syncGit(projectId: string): void {
    const { store, trajectory } = this.deps;
    const own = trajectory.data(projectId).nodes;
    const ownKeys = new Set(own.map((n) => n.key?.toLowerCase()).filter((k): k is string => !!k));
    let changes = 0;
    for (const root of store.rootsOf(projectId)) {
      const commits = readCommits(root.path, root.lastSha);
      if (!commits.length) continue;
      changes += store.db.transaction(() => applyCommits(trajectory, projectId, commits))();
      trajectory.setRootSha(root.path, commits.at(-1)!.sha);
      this.suggestLinks(projectId, commits, ownKeys);
    }
    if (changes) this.changed(projectId);
  }

  private suggestLinks(
    projectId: string,
    commits: ReturnType<typeof readCommits>,
    ownKeys: Set<string>,
  ): void {
    const { store, trajectory } = this.deps;
    const foreign = new Map<string, string>();
    for (const p of store.listProjects()) {
      if (p.id === projectId) continue;
      for (const n of trajectory.data(p.id).nodes)
        if (n.key) foreign.set(n.key.toLowerCase(), p.id);
    }
    for (const [docsProjectId, sample] of referencedForeignKeys(commits, ownKeys, foreign)) {
      if (trajectory.suggestLink({ codeProjectId: projectId, docsProjectId, sample }, this.now)) {
        this.log(`trajectory: suggest linking ${projectId} → ${docsProjectId} ("${sample}")`);
        this.deps.bus.emit({ type: "status.changed" });
      }
    }
  }

  /** Fold one project into another (e.g. a code repo into its plan's project) and rebuild. */
  link(intoId: string, fromId: string): Promise<Project | null> {
    return this.run(async () => {
      const { store, trajectory } = this.deps;
      // The folded project's own doc-derived map is rebuilt from the combined docs.
      trajectory.discardTrajectory(fromId);
      store.linkProjects(intoId, fromId);
      trajectory.dismissSuggestion(fromId, intoId);
      for (const r of store.rootsOf(intoId)) trajectory.resetRootSha(r.path);
      this.deps.bus.emit({ type: "project.changed", projectId: intoId });
      this.deps.bus.emit({ type: "project.changed", projectId: fromId });
      await this.syncDocs(intoId, true);
      this.syncGit(intoId);
      this.watchAll();
    }).then(() => this.deps.store.getProject(intoId));
  }

  /** Re-read docs shortly after they change on disk; re-check git periodically. */
  watchAll(): void {
    for (const w of this.watchers.splice(0)) w.close();
    const { store } = this.deps;
    const schedule = (projectId: string) => {
      clearTimeout(this.timers.get(projectId));
      this.timers.set(
        projectId,
        setTimeout(() => void this.sync(projectId), DOC_DEBOUNCE_MS),
      );
    };
    for (const p of store.listProjects()) {
      for (const r of store.rootsOf(p.id)) {
        if (!existsSync(r.path)) continue;
        try {
          this.watchers.push(
            watch(r.path, { recursive: true }, (_e, file) => {
              if (
                file &&
                /\.(md|markdown|docx|html?)$/i.test(file) &&
                !/node_modules|\.git\//.test(file)
              )
                schedule(p.id);
            }),
          );
        } catch {
          // folder not watchable; periodic sync still covers it
        }
      }
    }
    if (existsSync(this.deps.plansDir)) {
      try {
        this.watchers.push(watch(this.deps.plansDir, () => void this.syncAll()));
      } catch {
        // ignore
      }
    }
    if (!this.gitTimer) {
      this.gitTimer = setInterval(() => {
        void this.run(async () => {
          for (const p of this.deps.store.listProjects()) this.syncGit(p.id);
        });
      }, GIT_INTERVAL_MS);
      this.gitTimer.unref();
    }
  }
}
