import { STATUS_RANK, type NodeSource, type NodeStatus, type TNode } from "@atlas/core";
import { normalise } from "../extract/verify.ts";
import type { Doc } from "./docs.ts";
import type { PlanExtraction } from "./extract.ts";
import type { TrajectoryStore } from "./store.ts";

export interface ApplyResult {
  created: number;
  changed: number;
  rejected: { title: string; reason: string }[];
}

const normTitle = (s: string) => normalise(s).replace(/[^\p{L}\p{N} ]/gu, "");

/**
 * Forward-only status: progress never regresses from a document or a commit.
 * `dropped` and `blocked` are explicit statements and always apply.
 */
export function advances(current: NodeStatus | null, next: NodeStatus): boolean {
  if (current === next) return false;
  if (current === null) return true;
  if (next === "dropped" || next === "blocked") return true;
  if (current === "dropped") return false;
  return STATUS_RANK[next] > STATUS_RANK[current];
}

function validDate(s: string | null | undefined, fallback: string, now: string): string {
  if (!s) return fallback;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return fallback;
  const iso = d.toISOString();
  return iso > now ? fallback : iso;
}

/** Apply a document extraction to a project's trajectory. Only appends events. */
export function applyPlan(
  x: PlanExtraction,
  ctx: { store: TrajectoryStore; projectId: string; docs: Doc[]; now: string; source?: NodeSource },
): ApplyResult {
  const { store, projectId, now } = ctx;
  const source = ctx.source ?? "doc";
  const result: ApplyResult = { created: 0, changed: 0, rejected: [] };
  const docByLabel = new Map(ctx.docs.map((d) => [d.label, d]));
  const docText = new Map(ctx.docs.map((d) => [d.label, normalise(d.text)]));
  const stated = new Map(x.docs.map((d) => [d.path, d.date]));

  /** When a document's content appeared: its stated date, else its file time. */
  const createdAt = (label: string) => {
    const doc = docByLabel.get(label);
    return validDate(stated.get(label), doc?.modifiedAt ?? now, now);
  };
  const changedAt = (label: string) => docByLabel.get(label)?.modifiedAt ?? now;
  const quoteOk = (q: { path: string; quote: string }) => {
    const needle = normalise(q.quote);
    return needle.length >= 4 && (docText.get(q.path)?.includes(needle) ?? false);
  };

  const existing = store.data(projectId);
  const nodesById = new Map(existing.nodes.map((n) => [n.id, n]));

  // ── tracks ──────────────────────────────────────────────
  const trackIdByRef = new Map<string, string>();
  for (const t of x.tracks) {
    if (!quoteOk(t.evidence)) {
      result.rejected.push({ title: t.name, reason: "track quote not found in document" });
      continue;
    }
    const match = existing.tracks.find((e) => normTitle(e.name) === normTitle(t.name));
    const at = createdAt(t.evidence.path);
    const trackId = match?.id ?? store.createTrack({ projectId, name: t.name, at, source });
    if (!match) result.created++;
    trackIdByRef.set(t.ref, trackId);
    store.addEvidence(trackId, {
      kind: "doc",
      ref: t.evidence.path,
      excerpt: t.evidence.quote,
      at,
    });
  }

  // ── nodes ───────────────────────────────────────────────
  const nodeIdByRef = new Map<string, string>();
  const sortByTrack = new Map<string, number>();
  for (const n of x.nodes) {
    const trackId = trackIdByRef.get(n.trackRef);
    if (!trackId) {
      result.rejected.push({ title: n.title, reason: "unknown track" });
      continue;
    }
    if (!quoteOk(n.evidence)) {
      result.rejected.push({ title: n.title, reason: "quote not found in document" });
      continue;
    }
    const sort = sortByTrack.get(trackId) ?? 0;
    sortByTrack.set(trackId, sort + 1);
    const key = n.key?.trim() || null;
    const title = n.title.trim().slice(0, 120);
    const match: TNode | undefined =
      (n.existingId ? nodesById.get(n.existingId) : undefined) ??
      (key ? existing.nodes.find((e) => e.key?.toLowerCase() === key.toLowerCase()) : undefined) ??
      existing.nodes.find((e) => e.trackId === trackId && normTitle(e.title) === normTitle(title));
    const at = createdAt(n.evidence.path);
    let nodeId: string;
    if (match) {
      nodeId = match.id;
      store.updateNode(nodeId, { title, sort, key: key ?? match.key, trackId });
      if (advances(store.currentStatus(nodeId), n.status)) {
        store.setNodeStatus(nodeId, n.status, changedAt(n.evidence.path), source);
        result.changed++;
      }
    } else {
      nodeId = store.createNode({
        projectId,
        trackId,
        kind: n.kind,
        key,
        title,
        parentId: null,
        sort,
        reviewState: "confirmed",
        source,
        at,
        status: "planned",
      });
      if (n.status !== "planned") store.setNodeStatus(nodeId, n.status, at, source);
      result.created++;
    }
    nodeIdByRef.set(n.ref, nodeId);
    store.addEvidence(nodeId, { kind: "doc", ref: n.evidence.path, excerpt: n.evidence.quote, at });
  }
  for (const n of x.nodes) {
    const id = nodeIdByRef.get(n.ref);
    if (!id) continue;
    const parentId = n.parentRef ? (nodeIdByRef.get(n.parentRef) ?? null) : null;
    store.updateNode(id, { parentId });
  }

  // ── forks and abandonment (after nodes, so fork points exist) ──
  const lastAt =
    ctx.docs
      .map((d) => d.modifiedAt)
      .sort()
      .at(-1) ?? now;
  for (const t of x.tracks) {
    const trackId = trackIdByRef.get(t.ref);
    if (!trackId) continue;
    if (t.forkedFromRef) {
      const parentId = trackIdByRef.get(t.forkedFromRef);
      const cur = store.track(trackId);
      if (parentId && parentId !== trackId && cur && !cur.parentTrackId) {
        const parentNodes = store.data(projectId).nodes.filter((nd) => nd.trackId === parentId);
        const forkNode = parentNodes.at(-1)?.id ?? null;
        store.updateTrack(trackId, { parentTrackId: parentId, forkNodeId: forkNode });
        // The pivot itself is a node at the fork, carrying the reason.
        const reason = x.tracks.find((p) => p.ref === t.forkedFromRef)?.reason ?? t.reason;
        const pivotId = store.createNode({
          projectId,
          trackId,
          kind: "pivot",
          key: null,
          title: `Switched to ${t.name}`.slice(0, 120),
          parentId: null,
          sort: -1,
          reviewState: "confirmed",
          source,
          at: store.track(trackId)!.createdAt,
          status: "done",
        });
        store.addEvidence(pivotId, {
          kind: "doc",
          ref: t.evidence.path,
          excerpt: t.evidence.quote,
          at: store.track(trackId)!.createdAt,
        });
        if (reason) store.updateTrack(trackId, { reason });
        result.changed++;
      }
    }
    if (t.status === "abandoned") {
      if (t.reason) store.updateTrack(trackId, { reason: t.reason });
      // Abandoned when its successor appeared.
      const successor = x.tracks.find((s) => s.forkedFromRef === t.ref);
      const at = successor ? createdAt(successor.evidence.path) : lastAt;
      if (store.setTrackStatus(trackId, "abandoned", at, source)) result.changed++;
    }
  }
  return result;
}
