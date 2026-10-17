import { z } from "zod";

/**
 * Known entry kinds. `kind` stays an open string so new kinds can appear
 * without a migration; the UI falls back to a generic glyph for unknown ones.
 */
export const KNOWN_ENTRY_KINDS = [
  "decision",
  "pivot",
  "architecture",
  "constraint",
  "open_question",
  "risk",
] as const;

export type KnownEntryKind = (typeof KNOWN_ENTRY_KINDS)[number];

export const EntryKind = z
  .string()
  .regex(/^[a-z][a-z_]{1,31}$/, "kind must be snake_case, 2-32 chars");

export function isKnownKind(kind: string): kind is KnownEntryKind {
  return (KNOWN_ENTRY_KINDS as readonly string[]).includes(kind);
}

export const EntryStatus = z.enum(["active", "superseded", "reverted", "resolved"]);
export type EntryStatus = z.infer<typeof EntryStatus>;

export const ReviewState = z.enum(["confirmed", "needs_review", "dismissed"]);
export type ReviewState = z.infer<typeof ReviewState>;

/** Summaries are read in dense lists; the hard cap keeps them scannable. */
export const SUMMARY_MAX = 140;

export const Alternative = z.object({
  option: z.string().min(1),
  whyNot: z.string().min(1),
});
export type Alternative = z.infer<typeof Alternative>;

/** A verbatim quote from a transcript that backs an entry. */
export const Evidence = z.object({
  sessionId: z.string().min(1),
  messageUuid: z.string().min(1),
  quote: z.string().min(1),
});
export type Evidence = z.infer<typeof Evidence>;

export const Entry = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    kind: EntryKind,
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(SUMMARY_MAX),
    rationale: z.string().min(1),
    alternatives: z.array(Alternative).default([]),
    status: EntryStatus,
    supersedesId: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1),
    reviewState: ReviewState,
    evidence: z.array(Evidence).min(1, "every entry needs at least one evidence quote"),
    decidedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .refine((e) => e.kind !== "pivot" || e.supersedesId !== null, {
    message: "a pivot must reference the entry it supersedes",
    path: ["supersedesId"],
  })
  .refine((e) => e.supersedesId !== e.id, {
    message: "an entry cannot supersede itself",
    path: ["supersedesId"],
  });
export type Entry = z.infer<typeof Entry>;
