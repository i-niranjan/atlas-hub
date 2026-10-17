import type { Project } from "@atlas/core";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

export interface Doc {
  path: string;
  /** Path shown to the model and stored as evidence: relative to its root. */
  label: string;
  text: string;
  modifiedAt: string;
  /** Lives in an archive-like folder or is named as superseded. */
  supersededHint: boolean;
}

const DOC_EXT = /\.(md|markdown|docx|html?)$/i;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
]);
/** Instructions for assistants, not plans. Decision records are module 1's job. */
const SKIP_FILES = /^(claude|agents|contributing|code_of_conduct|license|changelog)\.md$/i;
const SKIP_PATHS = /(^|\/)(docs\/decisions|docs\/adr|adr)(\/|$)/i;
const GIT_ROOT_FILES =
  /^(readme|roadmap|plan|scope|vision|status|resume|start-here)[^/]*\.(md|markdown|docx|html?)$/i;
const ARCHIVE = /(^|\/)(archive|archived|old|deprecated|superseded)(\/|$)|original|superseded/i;
const PRIORITY = /roadmap|scope|plan|backlog|resume|status|readme|start-here|milestone/i;
const MAX_FILE_BYTES = 400_000;
const MAX_DOC_CHARS = 60_000;
export const MAX_TOTAL_CHARS = 240_000;

function readText(path: string): string | null {
  try {
    if (/\.docx$/i.test(path)) {
      return execFileSync("textutil", ["-convert", "txt", "-stdout", path], {
        encoding: "utf8",
        timeout: 15_000,
      });
    }
    const raw = readFileSync(path, "utf8");
    if (/\.html?$/i.test(path)) {
      return raw
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n");
    }
    return raw;
  } catch {
    return null;
  }
}

const isGitRoot = (dir: string) => existsSync(join(dir, ".git"));
/** A subfolder with its own repo or entry document is a separate project. */
const looksLikeOwnProject = (dir: string) =>
  isGitRoot(dir) || existsSync(join(dir, "START-HERE.md")) || existsSync(join(dir, "README.md"));

function walk(root: string, dir: string, depth: number, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (depth >= 3 || SKIP_DIRS.has(name) || looksLikeOwnProject(full)) continue;
      walk(root, full, depth + 1, out);
    } else if (DOC_EXT.test(name) && !SKIP_FILES.test(name) && st.size <= MAX_FILE_BYTES) {
      if (!SKIP_PATHS.test(relative(root, full))) out.push(full);
    }
  }
}

/** Plan documents in a folder. Git repos contribute only their top-level plan docs and docs/. */
export function findDocs(root: string): string[] {
  const out: string[] = [];
  if (isGitRoot(root)) {
    for (const name of readdirSync(root)) {
      if (GIT_ROOT_FILES.test(name)) out.push(join(root, name));
    }
    const docsDir = join(root, "docs");
    if (existsSync(docsDir)) walk(root, docsDir, 1, out);
  } else {
    walk(root, root, 0, out);
  }
  return out;
}

/** Claude plan-mode plans are global; attribute each to the project it names most. */
export function attributePlan(text: string, projects: Project[]): Project | null {
  let best: { p: Project; score: number } | null = null;
  for (const p of projects) {
    const tilde = p.rootPath.replace(/^\/Users\/[^/]+/, "~");
    const score =
      text.split(p.rootPath).length -
      1 +
      (text.split(tilde).length - 1) * 1 +
      (p.name.length >= 4
        ? (text.match(new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"))
            ?.length ?? 0) * 0.25
        : 0);
    if (score >= 1 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

export function collectDocs(
  roots: string[],
  project: Project,
  allProjects: Project[],
  plansDir: string,
): Doc[] {
  const paths = roots.flatMap((r) => findDocs(r).map((p) => ({ root: r, path: p })));
  if (existsSync(plansDir)) {
    for (const name of readdirSync(plansDir)) {
      if (!name.endsWith(".md")) continue;
      const path = join(plansDir, name);
      const text = readText(path);
      if (text && attributePlan(text, allProjects)?.id === project.id)
        paths.push({ root: plansDir, path });
    }
  }
  const docs: Doc[] = [];
  for (const { root, path } of paths) {
    const text = readText(path);
    if (!text?.trim()) continue;
    const label =
      root === plansDir ? `claude-plan/${basename(path)}` : relative(root, path) || basename(path);
    docs.push({
      path,
      label: roots.length > 1 && root !== plansDir ? `${basename(root)}/${label}` : label,
      text: text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n[…truncated]` : text,
      modifiedAt: statSync(path).mtime.toISOString(),
      supersededHint: ARCHIVE.test(label),
    });
  }
  // Most plan-like first, then fit the budget.
  docs.sort(
    (a, b) =>
      Number(PRIORITY.test(b.label)) - Number(PRIORITY.test(a.label)) ||
      a.label.localeCompare(b.label),
  );
  const kept: Doc[] = [];
  let total = 0;
  for (const d of docs) {
    if (total + d.text.length > MAX_TOTAL_CHARS) continue;
    kept.push(d);
    total += d.text.length;
  }
  return kept;
}

export function hashDocs(docs: Doc[]): string {
  const h = createHash("sha256");
  for (const d of [...docs].sort((a, b) => a.label.localeCompare(b.label)))
    h.update(d.label).update("\0").update(d.text);
  return h.digest("hex");
}
