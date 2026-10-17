import type {
  Alternative,
  Entry,
  EntryDetail,
  EntryStatus,
  Evidence,
  Project,
  ProjectSummary,
  ReviewState,
  Session,
} from "@atlas/core";
import { createHash, randomUUID } from "node:crypto";
import type { DB } from "./db.ts";

export type EntrySource = EntryDetail["source"];

export interface EntryFilter {
  projectId?: string;
  status?: EntryStatus;
  kind?: string;
  reviewState?: ReviewState;
  limit?: number;
}

interface EntryRow {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  summary: string;
  rationale: string;
  alternatives_json: string;
  status: EntryStatus;
  supersedes_id: string | null;
  confidence: number;
  review_state: ReviewState;
  source: EntrySource;
  decided_at: string;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  git_remote: string | null;
  first_seen: string;
  last_active: string;
}

interface SessionRow {
  id: string;
  project_id: string;
  transcript_path: string;
  title: string | null;
  byte_offset: number;
  processed_turns: number;
  state: Session["state"];
  error: string | null;
  last_processed_at: string | null;
}

export function newEntryId(): string {
  return `e_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function projectIdFor(name: string, rootPath: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  const hash = createHash("sha1").update(rootPath).digest("hex").slice(0, 6);
  return `p_${slug || "project"}_${hash}`;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  rootPath: r.root_path,
  gitRemote: r.git_remote,
  firstSeen: r.first_seen,
  lastActive: r.last_active,
});

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  projectId: r.project_id,
  transcriptPath: r.transcript_path,
  title: r.title,
  byteOffset: r.byte_offset,
  processedTurns: r.processed_turns,
  state: r.state,
  error: r.error,
  lastProcessedAt: r.last_processed_at,
});

/** Turn free text into a safe FTS5 query: every word as a prefix term, OR-ed. */
export function ftsQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu);
  if (!words) return null;
  return [...new Set(words)]
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(" OR ");
}

export class Store {
  readonly db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  // ── projects ──────────────────────────────────────────────

  upsertProject(
    p: { name: string; rootPath: string; gitRemote: string | null },
    at: string,
  ): Project {
    const id = projectIdFor(p.name, p.rootPath);
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, git_remote, first_seen, last_active)
         VALUES (@id, @name, @rootPath, @gitRemote, @at, @at)
         ON CONFLICT(root_path) DO UPDATE SET
           git_remote = COALESCE(excluded.git_remote, projects.git_remote),
           last_active = MAX(projects.last_active, excluded.last_active)`,
      )
      .run({ id, ...p, at });
    return this.getProjectByPath(p.rootPath)!;
  }

  getProject(id: string): Project | null {
    const r = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
      ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  getProjectByPath(rootPath: string): Project | null {
    const r = this.db.prepare(`SELECT * FROM projects WHERE root_path = ?`).get(rootPath) as
      ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  /** Resolve a project from an id, root path, or (case-insensitive) name. */
  findProject(ref: string): Project | null {
    const r = this.db
      .prepare(
        `SELECT * FROM projects WHERE id = @ref OR root_path = @ref OR lower(name) = lower(@ref)
         ORDER BY last_active DESC LIMIT 1`,
      )
      .get({ ref }) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id AND e.status = 'active' AND e.review_state != 'dismissed') AS active,
           (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id AND e.review_state = 'needs_review') AS needs_review,
           (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id AND e.review_state != 'dismissed') AS total,
           (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id
             OR s.id IN (SELECT ev.session_id FROM evidence ev JOIN entries e ON e.id = ev.entry_id WHERE e.project_id = p.id)
           ) AS session_count
         FROM projects p ORDER BY p.last_active DESC`,
      )
      .all() as (ProjectRow & {
      active: number;
      needs_review: number;
      total: number;
      session_count: number;
    })[];
    return rows.map((r) => ({
      ...toProject(r),
      counts: { active: r.active, needsReview: r.needs_review, total: r.total },
      sessionCount: r.session_count,
    }));
  }

  // ── sessions ──────────────────────────────────────────────

  getSession(id: string): Session | null {
    const r = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      SessionRow | undefined;
    return r ? toSession(r) : null;
  }

  upsertSession(s: {
    id: string;
    projectId: string;
    transcriptPath: string;
    title: string | null;
  }): Session {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, transcript_path, title)
         VALUES (@id, @projectId, @transcriptPath, @title)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           transcript_path = excluded.transcript_path,
           title = COALESCE(excluded.title, sessions.title)`,
      )
      .run(s);
    return this.getSession(s.id)!;
  }

  updateSession(
    id: string,
    patch: Partial<
      Pick<Session, "byteOffset" | "processedTurns" | "state" | "error" | "lastProcessedAt">
    >,
  ): void {
    const cur = this.getSession(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE sessions SET byte_offset = @byteOffset, processed_turns = @processedTurns,
           state = @state, error = @error, last_processed_at = @lastProcessedAt WHERE id = @id`,
      )
      .run(next);
  }

  sessionsInState(state: Session["state"]): Session[] {
    return (
      this.db.prepare(`SELECT * FROM sessions WHERE state = ?`).all(state) as SessionRow[]
    ).map(toSession);
  }

  queueCounts(): { pending: number; waitingForKey: number; errors: number } {
    const rows = this.db
      .prepare(`SELECT state, COUNT(*) AS n FROM sessions GROUP BY state`)
      .all() as {
      state: string;
      n: number;
    }[];
    const n = (s: string) => rows.find((r) => r.state === s)?.n ?? 0;
    return { pending: n("pending"), waitingForKey: n("waiting_for_key"), errors: n("error") };
  }

  // ── entries ───────────────────────────────────────────────

  private evidenceFor(entryId: string): Evidence[] {
    return (
      this.db
        .prepare(
          `SELECT session_id, message_uuid, quote FROM evidence WHERE entry_id = ? ORDER BY id`,
        )
        .all(entryId) as { session_id: string; message_uuid: string; quote: string }[]
    ).map((r) => ({ sessionId: r.session_id, messageUuid: r.message_uuid, quote: r.quote }));
  }

  private toEntry(r: EntryRow): Entry & { source: EntrySource } {
    return {
      id: r.id,
      projectId: r.project_id,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      rationale: r.rationale,
      alternatives: JSON.parse(r.alternatives_json) as Alternative[],
      status: r.status,
      supersedesId: r.supersedes_id,
      confidence: r.confidence,
      reviewState: r.review_state,
      evidence: this.evidenceFor(r.id),
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      source: r.source,
    };
  }

  /** Insert or replace an entry and merge its evidence. */
  saveEntry(e: Entry, source: EntrySource): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO entries (id, project_id, kind, title, summary, rationale, alternatives_json,
             status, supersedes_id, confidence, review_state, source, decided_at, created_at)
           VALUES (@id, @projectId, @kind, @title, @summary, @rationale, @alternatives,
             @status, @supersedesId, @confidence, @reviewState, @source, @decidedAt, @createdAt)
           ON CONFLICT(id) DO UPDATE SET
             project_id = excluded.project_id, kind = excluded.kind, title = excluded.title,
             summary = excluded.summary, rationale = excluded.rationale,
             alternatives_json = excluded.alternatives_json, status = excluded.status,
             supersedes_id = excluded.supersedes_id, confidence = excluded.confidence,
             review_state = excluded.review_state, decided_at = excluded.decided_at`,
        )
        .run({ ...e, alternatives: JSON.stringify(e.alternatives), source });
      for (const ev of e.evidence) this.addEvidence(e.id, ev);
    })();
  }

  addEvidence(entryId: string, ev: Evidence): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO evidence (entry_id, session_id, message_uuid, quote)
         VALUES (?, ?, ?, ?)`,
      )
      .run(entryId, ev.sessionId, ev.messageUuid, ev.quote);
  }

  setStatus(id: string, status: EntryStatus): void {
    this.db.prepare(`UPDATE entries SET status = ? WHERE id = ?`).run(status, id);
  }

  setReview(id: string, state: ReviewState): boolean {
    return (
      this.db.prepare(`UPDATE entries SET review_state = ? WHERE id = ?`).run(state, id).changes > 0
    );
  }

  getEntry(id: string): (Entry & { source: EntrySource }) | null {
    const r = this.db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as EntryRow | undefined;
    return r ? this.toEntry(r) : null;
  }

  listEntries(f: EntryFilter = {}): (Entry & { source: EntrySource })[] {
    const where: string[] = ["review_state != 'dismissed'"];
    const params: Record<string, unknown> = { limit: f.limit ?? 500 };
    if (f.projectId) {
      where.push("project_id = @projectId");
      params.projectId = f.projectId;
    }
    if (f.status) {
      where.push("status = @status");
      params.status = f.status;
    }
    if (f.kind) {
      where.push("kind = @kind");
      params.kind = f.kind;
    }
    if (f.reviewState) {
      where[0] = "review_state = @reviewState";
      params.reviewState = f.reviewState;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM entries WHERE ${where.join(" AND ")}
         ORDER BY decided_at DESC, created_at DESC LIMIT @limit`,
      )
      .all(params) as EntryRow[];
    return rows.map((r) => this.toEntry(r));
  }

  search(text: string, projectId?: string, limit = 20): (Entry & { source: EntrySource })[] {
    const q = ftsQuery(text);
    if (!q) return [];
    const rows = this.db
      .prepare(
        `SELECT e.* FROM entries_fts f JOIN entries e ON e.rowid = f.rowid
         WHERE entries_fts MATCH @q AND e.review_state != 'dismissed'
           ${projectId ? "AND e.project_id = @projectId" : ""}
         ORDER BY bm25(entries_fts, 4.0, 2.0, 1.0) LIMIT @limit`,
      )
      .all({ q, projectId, limit }) as EntryRow[];
    return rows.map((r) => this.toEntry(r));
  }

  /** The full supersession chain containing `id`, oldest first. */
  lineage(id: string): Entry[] {
    const start = this.getEntry(id);
    if (!start) return [];
    const back: Entry[] = [];
    const seen = new Set<string>([start.id]);
    let cur: Entry | null = start;
    while (cur?.supersedesId && !seen.has(cur.supersedesId)) {
      seen.add(cur.supersedesId);
      cur = this.getEntry(cur.supersedesId);
      if (cur) back.unshift(cur);
    }
    const forward: Entry[] = [];
    cur = start;
    for (;;) {
      const next = this.db
        .prepare(`SELECT * FROM entries WHERE supersedes_id = ? ORDER BY decided_at LIMIT 1`)
        .get(cur.id) as EntryRow | undefined;
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      cur = this.toEntry(next);
      forward.push(cur);
    }
    return [...back, start, ...forward];
  }

  entryDetail(id: string): EntryDetail | null {
    const e = this.getEntry(id);
    if (!e) return null;
    const chain = this.lineage(id);
    const idx = chain.findIndex((c) => c.id === id);
    const next = chain[idx + 1];
    const sessionIds = [...new Set(e.evidence.map((ev) => ev.sessionId))];
    const sessions = sessionIds
      .map((sid) => this.getSession(sid))
      .filter((s): s is Session => s !== null)
      .map((s) => ({ id: s.id, title: s.title }));
    return {
      ...e,
      lineage: chain.map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        status: c.status,
        decidedAt: c.decidedAt,
      })),
      supersededBy: next ? { id: next.id, title: next.title } : null,
      sessions,
    };
  }

  // ── lenses ────────────────────────────────────────────────

  listLenses(projectId: string | null): { id: string; title: string; prompt: string }[] {
    return this.db
      .prepare(`SELECT id, title, prompt FROM lenses WHERE project_id IS ? ORDER BY created_at`)
      .all(projectId) as { id: string; title: string; prompt: string }[];
  }

  saveLens(projectId: string | null, title: string, prompt: string, at: string): string {
    const id = `l_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    this.db
      .prepare(
        `INSERT INTO lenses (id, project_id, title, prompt, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, title, prompt, at);
    return id;
  }

  deleteLens(id: string): void {
    this.db.prepare(`DELETE FROM lenses WHERE id = ?`).run(id);
  }
}
