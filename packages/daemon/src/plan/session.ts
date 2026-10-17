import { heading, projectAt, type NodeStatus, type TrajectoryData } from "@atlas/core";
import type { ProgressItem } from "../extract/schema.ts";
import { verifyEvidence } from "../extract/verify.ts";
import type { Turn } from "../ingest/transcript.ts";
import { advances } from "./reconcile.ts";
import type { TrajectoryStore } from "./store.ts";

const ACTION_STATUS: Partial<Record<ProgressItem["action"], NodeStatus>> = {
  started: "in_progress",
  done: "done",
  dropped: "dropped",
  blocked: "blocked",
};

/** The compact view of a trajectory given to the session extractor. */
export function renderTrajectory(data: TrajectoryData, now: string): string | undefined {
  const state = projectAt(data, now);
  const h = heading(state);
  if (!h.track) return undefined;
  const onTrack = state.nodes.filter((n) => n.trackId === h.track!.id);
  const recentDone = new Set(
    onTrack
      .filter((n) => n.status === "done")
      .sort((a, b) => (a.statusAt < b.statusAt ? 1 : -1))
      .slice(0, 10)
      .map((n) => n.id),
  );
  const lines = onTrack
    .filter((n) => n.kind !== "story" || n.status !== "done" || recentDone.has(n.id))
    .slice(0, 160)
    .map(
      (n) =>
        `- ${n.id} | ${n.kind}${n.parentId ? ` (in ${n.parentId})` : ""} | ${n.key ?? "-"} | ${n.title} | ${n.status}`,
    );
  return [`Active direction: ${h.track.name}`, ...lines].join("\n");
}

export interface ProgressContext {
  store: TrajectoryStore;
  projectId: string;
  sessionId: string;
  newTurns: Turn[];
  now: string;
}

const REVIEW_THRESHOLD = 0.7;

/** Apply session-reported progress. Returns how many changes were made. */
export function applyProgress(
  items: ProgressItem[],
  ctx: ProgressContext,
  log: (m: string) => void = () => undefined,
): number {
  const { store, projectId } = ctx;
  let changes = 0;
  for (const item of items) {
    const evidence = verifyEvidence(item.evidence, ctx.newTurns, ctx.sessionId);
    if (!evidence.length) {
      log(`progress "${item.title}" rejected: no verifiable quote`);
      continue;
    }
    const at = evidence.map((e) => e.timestamp).sort()[0]!;
    const userBacked = evidence.some((e) => e.role !== "assistant");
    const sure = userBacked && item.confidence >= REVIEW_THRESHOLD;
    const cite = (subjectId: string) => {
      for (const e of evidence)
        store.addEvidence(subjectId, {
          kind: "quote",
          ref: e.sessionId,
          excerpt: e.quote,
          at: e.timestamp,
        });
    };

    const status = ACTION_STATUS[item.action];
    if (status) {
      const node = item.nodeId ? store.node(item.nodeId) : null;
      if (!node || node.projectId !== projectId) {
        log(`progress "${item.title}" rejected: unknown node`);
        continue;
      }
      if (!advances(store.currentStatus(node.id), status)) continue;
      store.setNodeStatus(node.id, status, at, "session");
      if (!sure) store.setNodeReview(node.id, "needs_review");
      cite(node.id);
      changes++;
      continue;
    }

    const data = store.data(projectId);
    const h = heading(projectAt(data, ctx.now));
    if (!h.track) continue;

    if (item.action === "added") {
      const parent = item.milestoneId ? store.node(item.milestoneId) : null;
      const parentId =
        parent && parent.projectId === projectId && parent.kind === "milestone"
          ? parent.id
          : (h.now.milestone?.id ?? null);
      const siblings = data.nodes.filter(
        (n) =>
          n.trackId === h.track!.id &&
          (parentId ? n.parentId === parentId || n.id === parentId : true),
      );
      const sort = Math.max(0, ...siblings.map((n) => n.sort)) + 0.5;
      const nodeId = store.createNode({
        projectId,
        trackId: h.track.id,
        kind: "story",
        key: null,
        title: item.title.trim().slice(0, 120),
        parentId,
        sort,
        reviewState: sure ? "confirmed" : "needs_review",
        source: "session",
        at,
        status: "planned",
      });
      cite(nodeId);
      changes++;
      continue;
    }

    if (item.action === "pivot") {
      // Changing a project's direction needs the developer's own words and high confidence.
      if (!userBacked || item.confidence < 0.8) {
        log(`pivot "${item.title}" skipped: not explicit enough`);
        continue;
      }
      const old = h.track;
      const onOld = data.nodes.filter((n) => n.trackId === old.id);
      const fork = h.now.milestone ?? onOld.at(-1) ?? null;
      const trackId = store.createTrack({
        projectId,
        name: item.title.trim().slice(0, 80),
        parentTrackId: old.id,
        forkNodeId: fork?.id ?? null,
        reason: item.reason,
        at,
        source: "session",
      });
      store.setTrackStatus(old.id, "abandoned", at, "session");
      if (item.reason) store.updateTrack(old.id, { reason: item.reason });
      const pivotId = store.createNode({
        projectId,
        trackId,
        kind: "pivot",
        key: null,
        title: `Switched to ${item.title.trim()}`.slice(0, 120),
        parentId: null,
        sort: -1,
        reviewState: "confirmed",
        source: "session",
        at,
        status: "done",
      });
      cite(pivotId);
      cite(trackId);
      changes++;
    }
  }
  return changes;
}
