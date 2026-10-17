import type { TNode } from "@atlas/core";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { advances } from "./reconcile.ts";
import type { TrajectoryStore } from "./store.ts";

export interface Commit {
  sha: string;
  at: string;
  subject: string;
}

const SEP = "\u001f";

/** Commits after `sinceSha` (oldest first). Falls back to recent history if that SHA is gone. */
export function readCommits(root: string, sinceSha: string | null): Commit[] {
  if (!existsSync(join(root, ".git"))) return [];
  const run = (range: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        root,
        "log",
        "--reverse",
        "--max-count=2000",
        `--pretty=format:%H${SEP}%aI${SEP}%s`,
        ...range,
      ],
      {
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  let out: string;
  try {
    out = sinceSha ? run([`${sinceSha}..HEAD`]) : run([]);
  } catch {
    try {
      out = run([]);
    } catch {
      return [];
    }
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, at, subject] = l.split(SEP);
      return { sha: sha!, at: new Date(at!).toISOString(), subject: subject ?? "" };
    });
}

/** "record … evidence", "done", "complete", "close", "finish" in a commit mean the story is finished. */
const DONE =
  /\b(done|complete[sd]?|finish(e[sd])?|close[sd]?|resolve[sd]?|record(s|ed)?\b[^.]*\bevidence)\b/i;
/** Keys worth matching in free text: letters + digits, at least two characters ("H2", "CH-014", "M0"). */
const KEYLIKE = /^[A-Za-z]{1,6}-?\d{1,5}$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keyPattern(nodes: TNode[]): RegExp | null {
  const keys = [
    ...new Set(nodes.map((n) => n.key).filter((k): k is string => !!k && KEYLIKE.test(k))),
  ];
  if (!keys.length) return null;
  // Longest first so "CH-01" never shadows "CH-014".
  keys.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![A-Za-z0-9-])(${keys.map(escape).join("|")})(?![A-Za-z0-9])`, "gi");
}

/** Commits that name a story or milestone move it forward, with the commit as evidence. */
export function applyCommits(store: TrajectoryStore, projectId: string, commits: Commit[]): number {
  const nodes = store
    .data(projectId)
    .nodes.filter((n) => n.kind === "story" || n.kind === "milestone");
  const pattern = keyPattern(nodes);
  if (!pattern) return 0;
  const byKey = new Map(nodes.filter((n) => n.key).map((n) => [n.key!.toLowerCase(), n]));
  let changes = 0;
  for (const c of commits) {
    const status = DONE.test(c.subject) ? "done" : "in_progress";
    for (const m of c.subject.matchAll(pattern)) {
      const node = byKey.get(m[1]!.toLowerCase());
      if (!node) continue;
      store.addEvidence(node.id, { kind: "commit", ref: c.sha, excerpt: c.subject, at: c.at });
      if (advances(store.currentStatus(node.id), status)) {
        store.setNodeStatus(node.id, status, c.at, "git");
        changes++;
      }
    }
  }
  return changes;
}

/** Dashed ids ("CH-003") are specific enough to suggest linking a repo to another project's plan. */
const DASHED = /(?<![A-Za-z0-9-])([A-Za-z]{1,6}-\d{1,5})(?![A-Za-z0-9])/g;

export function referencedForeignKeys(
  commits: Commit[],
  ownKeys: Set<string>,
  foreignKeys: Map<string, string>,
): Map<string, string> {
  const hits = new Map<string, string>(); // projectId -> sample subject
  for (const c of commits) {
    for (const m of c.subject.matchAll(DASHED)) {
      const k = m[1]!.toLowerCase();
      if (ownKeys.has(k)) continue;
      const owner = foreignKeys.get(k);
      if (owner && !hits.has(owner)) hits.set(owner, c.subject);
    }
  }
  return hits;
}
