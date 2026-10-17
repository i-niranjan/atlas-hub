import type { Entry, Project } from "@atlas/core";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";

/** Writes entries as markdown under ~/Atlas/<project>/decisions (ADR 0006). SQLite stays the source of truth. */
export class Mirror {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private dirFor(project: Project): string {
    const folder = project.id.replace(/^p_/, "");
    return join(this.root, folder, "decisions");
  }

  write(entry: Entry, project: Project): void {
    const dir = this.dirFor(project);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.startsWith(`${entry.id}-`)) rmSync(join(dir, f));
    const slug = entry.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const fm = stringify({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      status: entry.status,
      supersedes: entry.supersedesId,
      date: entry.decidedAt.slice(0, 10),
      review: entry.reviewState,
      evidence: entry.evidence.map((e) => ({ session: e.sessionId, quote: e.quote })),
    });
    const alternatives = entry.alternatives.length
      ? entry.alternatives.map((a) => `- **${a.option}**: ${a.whyNot}`).join("\n")
      : "None recorded.";
    const body = `## Decision\n\n${entry.rationale}\n\n## Alternatives\n\n${alternatives}\n`;
    writeFileSync(join(dir, `${entry.id}-${slug}.md`), `---\n${fm}---\n\n${body}`);
  }
}
