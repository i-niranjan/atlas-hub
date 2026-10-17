import { heading, projectAt, type NodeStatus, type TrajectoryData } from "@atlas/core";
import type { NewPlan, ProgressItem } from "../extract/schema.ts";
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
  /** The session's project: where added work and pivots go by default. */
  projectId: string;
  /** Every project whose roadmap the model was shown; status changes may touch any of them. */
  projectIds?: string[];
  /** Projects without plan docs, whose roadmap sessions maintain (they may add whole milestones). */
  sessionManaged?: Set<string>;
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
): { changes: number; projects: string[] } {
  const { store } = ctx;
  const allowed = new Set(ctx.projectIds ?? [ctx.projectId]);
  const changed = new Set<string>();
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
      if (!node || !allowed.has(node.projectId)) {
        log(`progress "${item.title}" rejected: unknown node`);
        continue;
      }
      if (!advances(store.currentStatus(node.id), status)) continue;
      store.setNodeStatus(node.id, status, at, "session");
      changed.add(node.projectId);
      if (!sure) store.setNodeReview(node.id, "needs_review");
      cite(node.id);
      changes++;
      continue;
    }

    // Added work goes to the milestone's project when one is named, else the session's project.
    const milestone = item.milestoneId ? store.node(item.milestoneId) : null;
    const projectId =
      milestone && allowed.has(milestone.projectId) ? milestone.projectId : ctx.projectId;
    if (!allowed.has(projectId) || !store.hasTrajectory(projectId)) continue;
    const data = store.data(projectId);
    const h = heading(projectAt(data, ctx.now));
    if (!h.track) continue;

    if (item.action === "added" && item.kind === "milestone") {
      // Whole new phases only come from sessions while no plan docs define the roadmap.
      if (!ctx.sessionManaged?.has(projectId)) {
        log(`milestone "${item.title}" skipped: this project's plan lives in its docs`);
        continue;
      }
      const onTrack = data.nodes.filter((n) => n.trackId === h.track!.id);
      const nodeId = store.createNode({
        projectId,
        trackId: h.track.id,
        kind: "milestone",
        key: null,
        title: item.title.trim().slice(0, 120),
        parentId: null,
        sort: Math.max(0, ...onTrack.map((n) => n.sort)) + 1,
        reviewState: sure ? "confirmed" : "needs_review",
        source: "session",
        at,
        status: "planned",
      });
      cite(nodeId);
      changed.add(projectId);
      changes++;
      continue;
    }

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
      changed.add(projectId);
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
      changed.add(projectId);
      changes++;
    }
  }
  return { changes, projects: [...changed] };
}

/**
 * Start a roadmap from a plan agreed in a session, for a project with no plan
 * docs. Returns the new track id, or null when the plan isn't backed by the turns.
 */
export function applySessionPlan(
  plan: NewPlan,
  ctx: { store: TrajectoryStore; projectId: string; sessionId: string; newTurns: Turn[] },
  log: (m: string) => void = () => undefined,
): string | null {
  const { store, projectId } = ctx;
  if (store.hasTrajectory(projectId)) return null;
  const goalEvidence = verifyEvidence(plan.evidence, ctx.newTurns, ctx.sessionId);
  const milestones = plan.milestones
    .map((m) => ({ ...m, verified: verifyEvidence(m.evidence, ctx.newTurns, ctx.sessionId) }))
    .filter((m) => m.verified.length > 0 && m.title.trim());
  const all = [...goalEvidence, ...milestones.flatMap((m) => m.verified)];
  if (milestones.length < 1 || !all.length) {
    log(`session plan "${plan.direction}" skipped: no milestone backed by a quote`);
    return null;
  }
  const at = all.map((e) => e.timestamp).sort()[0]!;
  // Agreed plans are confirmed; brainstorming that hasn't settled is drawn as unconfirmed.
  const sure = all.some((e) => e.role !== "assistant") && plan.confidence >= 0.8;
  const review = sure ? "confirmed" : "needs_review";
  const cite = (id: string, evs: typeof all) => {
    for (const e of evs)
      store.addEvidence(id, { kind: "quote", ref: e.sessionId, excerpt: e.quote, at: e.timestamp });
  };

  const trackId = store.createTrack({
    projectId,
    name: plan.direction.trim().slice(0, 80) || "Plan",
    at,
    source: "session",
  });
  cite(trackId, goalEvidence.length ? goalEvidence : all.slice(0, 1));
  let sort = 0;
  const goalId = store.createNode({
    projectId,
    trackId,
    kind: "goal",
    key: null,
    title: plan.goal.trim().slice(0, 120) || plan.direction,
    parentId: null,
    sort: sort++,
    reviewState: review,
    source: "session",
    at,
    status: "planned",
  });
  cite(goalId, goalEvidence.length ? goalEvidence : all.slice(0, 1));
  for (const m of milestones) {
    const mAt = m.verified.map((e) => e.timestamp).sort()[0]!;
    const mid = store.createNode({
      projectId,
      trackId,
      kind: "milestone",
      key: m.key?.trim() || null,
      title: m.title.trim().slice(0, 120),
      explain: m.explain?.trim().slice(0, 160) || null,
      parentId: null,
      sort: sort++,
      reviewState: review,
      source: "session",
      at: mAt,
      status: m.status,
    });
    cite(mid, m.verified);
    for (const st of m.stories) {
      if (!st.title.trim()) continue;
      store.createNode({
        projectId,
        trackId,
        kind: "story",
        key: st.key?.trim() || null,
        title: st.title.trim().slice(0, 120),
        parentId: mid,
        sort: sort++,
        reviewState: review,
        source: "session",
        at: mAt,
        status: st.status,
      });
    }
  }
  return trackId;
}
