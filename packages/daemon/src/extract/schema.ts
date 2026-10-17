import { z } from "zod";

/** What the extraction model returns. Kept free of length limits so it works with structured outputs; limits are enforced afterwards by `Entry`. */
export const Candidate = z.object({
  action: z.enum(["new", "duplicate", "supersedes", "resolves"]),
  targetId: z.string().nullable(),
  projectRoot: z.string().nullable(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.object({ option: z.string(), whyNot: z.string() })),
  confidence: z.number(),
  evidence: z.array(z.object({ turnUuid: z.string(), quote: z.string() })),
});
export type Candidate = z.infer<typeof Candidate>;

/** Module 2: movement on the project's trajectory, read from the same turns. */
export const ProgressItem = z.object({
  action: z.enum(["started", "done", "dropped", "blocked", "added", "pivot"]),
  /** Existing node id for started/done/dropped/blocked. */
  nodeId: z.string().nullable(),
  /** For "added": the new story's title. For "pivot": the new direction's name. */
  title: z.string(),
  /** For "added": the milestone it belongs to, if any. */
  milestoneId: z.string().nullable(),
  /** For "added": a whole new milestone (only on session-managed roadmaps) or a story. */
  kind: z.enum(["story", "milestone"]).nullable(),
  reason: z.string().nullable(),
  confidence: z.number(),
  evidence: z.array(z.object({ turnUuid: z.string(), quote: z.string() })),
});
export type ProgressItem = z.infer<typeof ProgressItem>;

const Quote = z.object({ turnUuid: z.string(), quote: z.string() });

/** A roadmap laid out in a session, for a project that has no plan documents. */
export const NewPlan = z.object({
  direction: z.string(),
  goal: z.string(),
  confidence: z.number(),
  evidence: z.array(Quote),
  milestones: z.array(
    z.object({
      title: z.string(),
      key: z.string().nullable(),
      status: z.enum(["planned", "in_progress", "done"]),
      evidence: z.array(Quote),
      stories: z.array(
        z.object({
          title: z.string(),
          key: z.string().nullable(),
          status: z.enum(["planned", "in_progress", "done"]),
        }),
      ),
    }),
  ),
});
export type NewPlan = z.infer<typeof NewPlan>;

export const CandidateBatch = z.object({
  entries: z.array(Candidate),
  progress: z.array(ProgressItem),
  /** Only when <no_roadmap> was given and the turns lay out an agreed plan. */
  newPlan: NewPlan.nullable(),
});
export type CandidateBatch = z.infer<typeof CandidateBatch>;
