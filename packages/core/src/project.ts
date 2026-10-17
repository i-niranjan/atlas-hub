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
  /** Bytes of the transcript already processed; ingestion resumes from here. */
  byteOffset: z.number().int().nonnegative(),
  lastProcessedAt: z.iso.datetime().nullable(),
});
export type Session = z.infer<typeof Session>;
