import { Entry, isKnownKind, type Project } from "@atlas/core";
import type { Turn } from "../ingest/transcript.ts";
import { newEntryId, type Store } from "../store.ts";
import type { Candidate } from "./schema.ts";
import { verifyEvidence } from "./verify.ts";

/** Below this, or with only assistant-side evidence, an entry waits for the user. */
export const REVIEW_THRESHOLD = 0.7;

export interface ReconcileContext {
  store: Store;
  sessionId: string;
  sessionProject: Project;
  newTurns: Turn[];
  /** Ids the model was shown; targets outside this set are ignored. */
  shownIds: Set<string>;
  /** Maps a projectRoot the model named to a project, or null if it isn't a real folder. */
  resolveProjectRoot: (root: string) => Project | null;
  now: string;
}

export interface ReconcileOutcome {
  saved: string[];
  merged: string[];
  rejected: { title: string; reason: string }[];
}

export function reconcile(candidates: Candidate[], ctx: ReconcileContext): ReconcileOutcome {
  const out: ReconcileOutcome = { saved: [], merged: [], rejected: [] };

  for (const c of candidates) {
    const evidence = verifyEvidence(c.evidence, ctx.newTurns, ctx.sessionId);
    if (evidence.length === 0) {
      out.rejected.push({ title: c.title, reason: "no verifiable evidence quote" });
      continue;
    }
    const plain = evidence.map(({ sessionId, messageUuid, quote }) => ({
      sessionId,
      messageUuid,
      quote,
    }));

    const target =
      c.targetId && ctx.shownIds.has(c.targetId) ? ctx.store.getEntry(c.targetId) : null;

    if (c.action === "duplicate" && target) {
      plain.forEach((ev) => ctx.store.addEvidence(target.id, ev));
      out.merged.push(target.id);
      continue;
    }

    const project =
      (c.projectRoot ? ctx.resolveProjectRoot(c.projectRoot) : null) ?? ctx.sessionProject;
    const linksTarget = (c.action === "supersedes" || c.action === "resolves") && target !== null;
    const userBacked = evidence.some((e) => e.role !== "assistant");
    const confidence = Math.min(1, Math.max(0, c.confidence));

    let kind = c.kind
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (kind === "pivot" && !linksTarget) kind = "decision";
    if (!isKnownKind(kind) && !/^[a-z][a-z_]{1,31}$/.test(kind)) kind = "decision";

    const decidedAt = evidence
      .map((e) => e.timestamp)
      .sort()
      .at(0)!;

    const parsed = Entry.safeParse({
      id: newEntryId(),
      projectId: project.id,
      kind,
      title: c.title.trim(),
      summary: c.summary.trim(),
      rationale: c.rationale.trim(),
      alternatives: c.alternatives.filter((a) => a.option.trim() && a.whyNot.trim()),
      status: "active",
      supersedesId: linksTarget ? target.id : null,
      confidence,
      reviewState:
        confidence >= REVIEW_THRESHOLD && userBacked && (c.action === "new" || linksTarget)
          ? "confirmed"
          : "needs_review",
      evidence: plain,
      decidedAt: new Date(decidedAt).toISOString(),
      createdAt: ctx.now,
    });
    if (!parsed.success) {
      out.rejected.push({ title: c.title, reason: parsed.error.issues[0]?.message ?? "invalid" });
      continue;
    }

    ctx.store.db.transaction(() => {
      ctx.store.saveEntry(parsed.data, "extracted");
      if (linksTarget)
        ctx.store.setStatus(target.id, c.action === "resolves" ? "resolved" : "superseded");
    })();
    out.saved.push(parsed.data.id);
  }
  return out;
}
