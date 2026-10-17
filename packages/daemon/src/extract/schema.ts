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

export const CandidateBatch = z.object({ entries: z.array(Candidate) });
export type CandidateBatch = z.infer<typeof CandidateBatch>;
