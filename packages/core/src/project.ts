import { z } from "zod";

export const Project = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  gitRemote: z.string().nullable(),
  firstSeen: z.iso.datetime(),
  lastActive: z.iso.datetime(),
});
export type Project = z.infer<typeof Project>;

export const Session = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  transcriptPath: z.string().min(1),
  /** Taken from the transcript's `ai-title` line when present. */
  title: z.string().nullable(),
  /** Transcript size when last processed; a larger file means new turns. */
  byteOffset: z.number().int().nonnegative(),
  /** Number of conversation turns already sent through extraction. */
  processedTurns: z.number().int().nonnegative(),
  state: z.enum(["pending", "done", "error", "waiting_for_key"]),
  error: z.string().nullable(),
  lastProcessedAt: z.iso.datetime().nullable(),
});
export type Session = z.infer<typeof Session>;
