import type {
  Primer,
  TrajectoryEvidence as Evidence,
  NodeKind,
  NodeSource,
  NodeStatus,
  ReviewState,
  TNode,
  Track,
  TrackStatus,
  TrajectoryData,
  TrajectoryEvent,
} from "@atlas/core";
import { randomUUID } from "node:crypto";
import type { DB } from "../db.ts";

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 14)}`;

interface TrackRow {
  id: string;
  project_id: string;
  name: string;
  parent_track_id: string | null;
  fork_node_id: string | null;
  reason: string | null;
  created_at: string;
}

interface NodeRow {
  id: string;
  project_id: string;
  track_id: string;
  kind: NodeKind;
  key: string | null;
  title: string;
  parent_id: string | null;
  sort: number;
  explain: string | null;
  review_state: ReviewState;
  source: NodeSource;
  created_at: string;
}

const toTrack = (r: TrackRow): Track => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  parentTrackId: r.parent_track_id,
  forkNodeId: r.fork_node_id,
  reason: r.reason,
  createdAt: r.created_at,
});

const toNode = (r: NodeRow): TNode => ({
  id: r.id,
  projectId: r.project_id,
  trackId: r.track_id,
  kind: r.kind,
  key: r.key,
  title: r.title,
  parentId: r.parent_id,
  sort: r.sort,
  explain: r.explain,
  reviewState: r.review_state,
  source: r.source,
  createdAt: r.created_at,
});

export interface Suggestion {
  codeProjectId: string;
  docsProjectId: string;
  sample: string;
}

/** The only writer of trajectory tables. Events are appended, never edited. */
export class TrajectoryStore {
  private readonly db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  // ── reads ────────────────────────────────────────────────

  data(projectId: string): TrajectoryData {
    const tracks = (
      this.db
        .prepare(`SELECT * FROM tracks WHERE project_id = ? ORDER BY created_at`)
        .all(projectId) as TrackRow[]
    ).map(toTrack);
    const nodes = (
      this.db
        .prepare(`SELECT * FROM nodes WHERE project_id = ? ORDER BY sort`)
        .all(projectId) as NodeRow[]
    ).map(toNode);
    const events = (
      this.db
        .prepare(
          `SELECT id, at, type, subject_id, value, source FROM trajectory_events WHERE project_id = ? ORDER BY at, id`,
        )
        .all(projectId) as {
        id: number;
        at: string;
        type: string;
        subject_id: string;
        value: string | null;
        source: NodeSource;
      }[]
    ).map(
      (e) =>
        ({
          id: e.id,
          at: e.at,
          type: e.type,
          subjectId: e.subject_id,
          value: e.value,
          source: e.source,
        }) as TrajectoryEvent,
    );
    return { projectId, tracks, nodes, events, primer: this.primer(projectId) };
  }

  primer(projectId: string): Primer | null {
    const r = this.db
      .prepare(`SELECT one_liner, terms_json FROM project_primer WHERE project_id = ?`)
      .get(projectId) as { one_liner: string; terms_json: string } | undefined;
    return r ? { oneLiner: r.one_liner, terms: JSON.parse(r.terms_json) as Primer["terms"] } : null;
  }

  setPrimer(projectId: string, primer: Primer, at: string): void {
    this.db
      .prepare(
        `INSERT INTO project_primer (project_id, one_liner, terms_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET one_liner = excluded.one_liner, terms_json = excluded.terms_json, updated_at = excluded.updated_at`,
      )
      .run(projectId, primer.oneLiner, JSON.stringify(primer.terms), at);
  }

  hasTrajectory(projectId: string): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM tracks WHERE project_id = ? LIMIT 1`).get(projectId) !==
      undefined
    );
  }

  node(nodeId: string): TNode | null {
    const r = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(nodeId) as
      NodeRow | undefined;
    return r ? toNode(r) : null;
  }

  track(trackId: string): Track | null {
    const r = this.db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(trackId) as
      TrackRow | undefined;
    return r ? toTrack(r) : null;
  }

  currentStatus(nodeId: string): NodeStatus | null {
    const r = this.db
      .prepare(
        `SELECT value FROM trajectory_events WHERE subject_id = ? AND type IN ('node_created','node_status')
         ORDER BY at DESC, id DESC LIMIT 1`,
      )
      .get(nodeId) as { value: NodeStatus } | undefined;
    return r?.value ?? null;
  }

  trackStatus(trackId: string): TrackStatus | null {
    const r = this.db
      .prepare(
        `SELECT type, value FROM trajectory_events WHERE subject_id = ? AND type IN ('track_created','track_status')
         ORDER BY at DESC, id DESC LIMIT 1`,
      )
      .get(trackId) as { type: string; value: TrackStatus | null } | undefined;
    if (!r) return null;
    return r.type === "track_created" ? "active" : r.value;
  }

  history(subjectId: string): TrajectoryEvent[] {
    return (
      this.db
        .prepare(
          `SELECT id, at, type, subject_id, value, source FROM trajectory_events WHERE subject_id = ? ORDER BY at, id`,
        )
        .all(subjectId) as {
        id: number;
        at: string;
        type: string;
        subject_id: string;
        value: string | null;
        source: NodeSource;
      }[]
    ).map(
      (e) =>
        ({
          id: e.id,
          at: e.at,
          type: e.type,
          subjectId: e.subject_id,
          value: e.value,
          source: e.source,
        }) as TrajectoryEvent,
    );
  }

  evidence(subjectId: string): Evidence[] {
    return this.db
      .prepare(
        `SELECT kind, ref, excerpt, at FROM trajectory_evidence WHERE subject_id = ? ORDER BY at, id`,
      )
      .all(subjectId) as Evidence[];
  }

  // ── writes ───────────────────────────────────────────────

  private event(
    projectId: string,
    at: string,
    type: TrajectoryEvent["type"],
    subjectId: string,
    value: string | null,
    source: NodeSource,
  ): void {
    this.db
      .prepare(
        `INSERT INTO trajectory_events (project_id, at, type, subject_id, value, source) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, at, type, subjectId, value, source);
  }

  createTrack(t: {
    projectId: string;
    name: string;
    parentTrackId?: string | null;
    forkNodeId?: string | null;
    reason?: string | null;
    at: string;
    source: NodeSource;
  }): string {
    const trackId = id("t");
    this.db
      .prepare(
        `INSERT INTO tracks (id, project_id, name, parent_track_id, fork_node_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trackId,
        t.projectId,
        t.name,
        t.parentTrackId ?? null,
        t.forkNodeId ?? null,
        t.reason ?? null,
        t.at,
      );
    this.event(t.projectId, t.at, "track_created", trackId, null, t.source);
    return trackId;
  }

  updateTrack(
    trackId: string,
    patch: {
      name?: string;
      parentTrackId?: string | null;
      forkNodeId?: string | null;
      reason?: string | null;
    },
  ): void {
    const cur = this.track(trackId);
    if (!cur) return;
    this.db
      .prepare(
        `UPDATE tracks SET name = ?, parent_track_id = ?, fork_node_id = ?, reason = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? cur.name,
        patch.parentTrackId !== undefined ? patch.parentTrackId : cur.parentTrackId,
        patch.forkNodeId !== undefined ? patch.forkNodeId : cur.forkNodeId,
        patch.reason !== undefined ? patch.reason : cur.reason,
        trackId,
      );
  }

  /** Appends a status event only when it actually changes. */
  setTrackStatus(trackId: string, status: TrackStatus, at: string, source: NodeSource): boolean {
    const t = this.track(trackId);
    if (!t || this.trackStatus(trackId) === status) return false;
    this.event(t.projectId, at, "track_status", trackId, status, source);
    return true;
  }

  createNode(
    n: Omit<TNode, "id" | "createdAt" | "explain"> & {
      at: string;
      status: NodeStatus;
      explain?: string | null;
    },
  ): string {
    const nodeId = id("n");
    this.db
      .prepare(
        `INSERT INTO nodes (id, project_id, track_id, kind, key, title, parent_id, sort, review_state, source, created_at, explain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nodeId,
        n.projectId,
        n.trackId,
        n.kind,
        n.key,
        n.title,
        n.parentId,
        n.sort,
        n.reviewState,
        n.source,
        n.at,
        n.explain ?? null,
      );
    this.event(n.projectId, n.at, "node_created", nodeId, n.status, n.source);
    return nodeId;
  }

  updateNode(
    nodeId: string,
    patch: Partial<Pick<TNode, "title" | "sort" | "parentId" | "key" | "trackId" | "explain">>,
  ): void {
    const cur = this.node(nodeId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE nodes SET title = ?, sort = ?, parent_id = ?, key = ?, track_id = ?, explain = ? WHERE id = ?`,
      )
      .run(next.title, next.sort, next.parentId, next.key, next.trackId, next.explain, nodeId);
  }

  setNodeStatus(nodeId: string, status: NodeStatus, at: string, source: NodeSource): boolean {
    const n = this.node(nodeId);
    if (!n || this.currentStatus(nodeId) === status) return false;
    this.event(n.projectId, at, "node_status", nodeId, status, source);
    return true;
  }

  setNodeReview(nodeId: string, state: ReviewState): void {
    this.db.prepare(`UPDATE nodes SET review_state = ? WHERE id = ?`).run(state, nodeId);
  }

  addEvidence(subjectId: string, ev: Evidence): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO trajectory_evidence (subject_id, kind, ref, excerpt, at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(subjectId, ev.kind, ev.ref, ev.excerpt.slice(0, 600), ev.at);
  }

  /**
   * The single exception to append-only: when a project is folded into another,
   * its doc-derived map is discarded and rebuilt from the combined documents.
   */
  discardTrajectory(projectId: string): void {
    this.db.transaction(() => {
      const ids = [
        ...(this.db.prepare(`SELECT id FROM nodes WHERE project_id = ?`).all(projectId) as {
          id: string;
        }[]),
        ...(this.db.prepare(`SELECT id FROM tracks WHERE project_id = ?`).all(projectId) as {
          id: string;
        }[]),
      ].map((r) => r.id);
      for (const sid of ids)
        this.db.prepare(`DELETE FROM trajectory_evidence WHERE subject_id = ?`).run(sid);
      this.db.prepare(`DELETE FROM trajectory_events WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM nodes WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM tracks WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM doc_state WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM project_primer WHERE project_id = ?`).run(projectId);
    })();
  }

  setRootSha(path: string, sha: string): void {
    this.db.prepare(`UPDATE project_roots SET last_sha = ? WHERE path = ?`).run(sha, path);
  }

  resetRootSha(path: string): void {
    this.db.prepare(`UPDATE project_roots SET last_sha = NULL WHERE path = ?`).run(path);
  }

  // ── doc ingestion state ──────────────────────────────────

  docHash(projectId: string): string | null {
    const r = this.db.prepare(`SELECT hash FROM doc_state WHERE project_id = ?`).get(projectId) as
      { hash: string } | undefined;
    return r?.hash ?? null;
  }

  setDocHash(projectId: string, hash: string, at: string): void {
    this.db
      .prepare(
        `INSERT INTO doc_state (project_id, hash, ingested_at) VALUES (?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET hash = excluded.hash, ingested_at = excluded.ingested_at`,
      )
      .run(projectId, hash, at);
  }

  // ── link suggestions ─────────────────────────────────────

  suggestLink(s: Suggestion, at: string): boolean {
    return (
      this.db
        .prepare(
          `INSERT OR IGNORE INTO link_suggestions (code_project_id, docs_project_id, sample, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(s.codeProjectId, s.docsProjectId, s.sample, at).changes > 0
    );
  }

  suggestions(): Suggestion[] {
    return (
      this.db
        .prepare(
          `SELECT code_project_id, docs_project_id, sample FROM link_suggestions WHERE dismissed = 0`,
        )
        .all() as { code_project_id: string; docs_project_id: string; sample: string }[]
    ).map((r) => ({
      codeProjectId: r.code_project_id,
      docsProjectId: r.docs_project_id,
      sample: r.sample,
    }));
  }

  dismissSuggestion(codeProjectId: string, docsProjectId: string): void {
    this.db
      .prepare(
        `UPDATE link_suggestions SET dismissed = 1 WHERE code_project_id = ? AND docs_project_id = ?`,
      )
      .run(codeProjectId, docsProjectId);
  }
}
