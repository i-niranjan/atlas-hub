import { Entry, type Project, type ReviewState } from "@atlas/core";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Store } from "./store.ts";

/** Imports `docs/decisions/*.md` records (format in Atlas's own docs/decisions/README.md). */

const FrontMatter = z.object({
  id: z.coerce.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.enum(["active", "superseded", "reverted", "resolved"]).default("active"),
  supersedes: z.coerce.string().nullable().default(null),
  date: z.union([z.string(), z.date()]),
  review: z.enum(["confirmed", "needs_review"]).default("confirmed"),
  evidence: z.array(z.object({ session: z.string(), quote: z.coerce.string() })).min(1),
});

export const adrEntryId = (projectId: string, adrId: string): string => `${projectId}-adr-${adrId}`;

function section(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m");
  return re.exec(body)?.[1]?.trim() ?? "";
}

const stripMd = (s: string): string =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

function parseAlternatives(text: string): { option: string; whyNot: string }[] {
  return text
    .split("\n")
    .map((l) => /^-\s+\*\*(.+?)\*\*:?\s*(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ option: stripMd(m[1]!), whyNot: stripMd(m[2]!) }));
}

export interface AdrImportResult {
  imported: string[];
  errors: { file: string; error: string }[];
}

export function importAdrs(store: Store, project: Project, now: string): AdrImportResult {
  const dir = join(project.rootPath, "docs", "decisions");
  const result: AdrImportResult = { imported: [], errors: [] };
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => /^\d{4}-.+\.md$/.test(f))
      .sort();
  } catch {
    return result;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf8");
      const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
      if (!m) throw new Error("missing front matter");
      const fm = FrontMatter.parse(parseYaml(m[1]!));
      const body = m[2]!;
      const date =
        fm.date instanceof Date ? fm.date.toISOString() : new Date(fm.date).toISOString();
      const review: ReviewState = fm.review;
      const entry = Entry.parse({
        id: adrEntryId(project.id, fm.id),
        projectId: project.id,
        kind: fm.kind,
        title: fm.title,
        summary: fm.summary,
        rationale: stripMd(section(body, "Decision")).slice(0, 800) || fm.summary,
        alternatives: parseAlternatives(section(body, "Alternatives")),
        status: fm.status,
        supersedesId: fm.supersedes ? adrEntryId(project.id, fm.supersedes) : null,
        confidence: review === "confirmed" ? 1 : 0.6,
        reviewState: review,
        evidence: fm.evidence.map((e) => ({
          sessionId: e.session,
          messageUuid: `adr:${file}`,
          quote: e.quote,
        })),
        decidedAt: date,
        createdAt: now,
      });
      store.saveEntry(entry, "adr");
      result.imported.push(entry.id);
    } catch (err) {
      result.errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
