import type { Entry } from "./entry.ts";
import type { Project, Session } from "./project.ts";
import type { Block } from "./ui-spec.ts";

/** Shapes returned by atlasd's HTTP API, shared with the desktop app. */

export interface ProjectSummary extends Project {
  counts: { active: number; needsReview: number; total: number };
  sessionCount: number;
}

export interface EntryDetail extends Entry {
  source: "extracted" | "adr" | "manual";
  /** Oldest first; includes this entry. */
  lineage: Pick<Entry, "id" | "kind" | "title" | "status" | "decidedAt">[];
  supersededBy: Pick<Entry, "id" | "title"> | null;
  sessions: Pick<Session, "id" | "title">[];
}

export interface StatusReport {
  version: string;
  hasApiKey: boolean;
  hooksInstalled: boolean;
  mcpRegistered: boolean;
  queue: { pending: number; waitingForKey: number; errors: number };
}

/** The AG-UI shared state the canvas agent publishes via STATE_SNAPSHOT. */
export interface CanvasState {
  view: { title: string; blocks: Block[] } | null;
  entries: Record<string, EntryDetail>;
  projects: Record<string, ProjectSummary>;
  dropped: string[];
}

export interface Lens {
  id: string;
  title: string;
  prompt: string;
}

/** Pushed on GET /events. */
export type LiveEvent =
  | { type: "entry.changed"; projectId: string; entryId: string }
  | { type: "project.changed"; projectId: string }
  | { type: "session.changed"; projectId: string; sessionId: string; state: Session["state"] }
  | { type: "status.changed" };
