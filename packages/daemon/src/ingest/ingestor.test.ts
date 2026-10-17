import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../bus.ts";
import { loadConfig } from "../config.ts";
import type { Extractor } from "../extract/llm.ts";
import type { ExtractInput } from "../extract/prompt.ts";
import type { CandidateBatch } from "../extract/schema.ts";
import { Mirror } from "../mirror.ts";
import { line, memoryStore, tempDir } from "../test-helpers.ts";
import { chunkTurns, Ingestor } from "./ingestor.ts";

class FakeExtractor implements Extractor {
  calls: ExtractInput[] = [];
  async extract(input: ExtractInput): Promise<CandidateBatch> {
    this.calls.push(input);
    const pick = input.newTurns.find((t) => t.text.includes("use SQLite"));
    if (!pick) return { entries: [], progress: [] };
    return {
      entries: [
        {
          action: "new",
          targetId: null,
          projectRoot: null,
          kind: "decision",
          title: "Use SQLite for storage",
          summary: "SQLite keeps storage local.",
          rationale: "Zero ops; single writer.",
          alternatives: [],
          confidence: 0.9,
          evidence: [{ turnUuid: pick.uuid, quote: "use SQLite" }],
        },
      ],
      progress: [],
    };
  }
}

function setup(withExtractor: boolean) {
  const home = tempDir();
  const projectDir = join(home, "demo");
  mkdirSync(join(projectDir, ".git"), { recursive: true });
  const config = loadConfig({ ATLAS_HOME_OVERRIDE: home, ATLAS_STOP_DEBOUNCE_MS: "10" });
  const store = memoryStore();
  const fake = new FakeExtractor();
  const events: string[] = [];
  const bus = new Bus();
  bus.subscribe((e) => events.push(e.type));
  const ingestor = new Ingestor({
    store,
    config,
    bus,
    mirror: new Mirror(join(home, "Atlas")),
    extractor: () => (withExtractor ? fake : null),
    log: () => undefined,
  });
  const transcript = join(home, "sess-1.jsonl");
  const withCwd = (l: string) => JSON.stringify({ ...JSON.parse(l), cwd: projectDir });
  writeFileSync(
    transcript,
    [line.user("Hello"), line.user("Let's use SQLite please")].map(withCwd).join("\n") + "\n",
  );
  return { home, projectDir, store, fake, ingestor, transcript, events, withCwd };
}

describe("Ingestor", () => {
  it("extracts from new turns, then only from turns appended later", async () => {
    const t = setup(true);
    await t.ingestor.enqueue(t.transcript);
    const project = t.store.findProject(t.projectDir)!;
    expect(project.name).toBe("demo");
    expect(t.store.listEntries({ projectId: project.id })).toHaveLength(1);
    expect(t.store.getSession("sess-1")!.state).toBe("done");
    expect(t.events).toContain("entry.changed");

    appendFileSync(t.transcript, t.withCwd(line.user("Thanks, that's all")) + "\n");
    await t.ingestor.enqueue(t.transcript);
    expect(t.fake.calls).toHaveLength(2);
    expect(t.fake.calls[1]!.newTurns.map((x) => x.text)).toEqual(["Thanks, that's all"]);
    expect(t.fake.calls[1]!.contextTurns).toHaveLength(2);
  });

  it("does not re-extract an unchanged transcript", async () => {
    const t = setup(true);
    await t.ingestor.enqueue(t.transcript);
    await t.ingestor.enqueue(t.transcript);
    expect(t.fake.calls).toHaveLength(1);
  });

  it("parks sessions until an API key exists", async () => {
    const t = setup(false);
    await t.ingestor.enqueue(t.transcript);
    expect(t.store.getSession("sess-1")!.state).toBe("waiting_for_key");
    expect(t.store.queueCounts().waitingForKey).toBe(1);
  });

  it("replays spooled hook events, keeping the latest per session", async () => {
    const t = setup(true);
    const spool = join(t.home, "Library", "Application Support", "Atlas", "spool.jsonl");
    mkdirSync(join(spool, ".."), { recursive: true });
    const ev = { session_id: "sess-1", transcript_path: t.transcript, hook_event_name: "Stop" };
    writeFileSync(spool, `${JSON.stringify(ev)}\n${JSON.stringify(ev)}\nnot json\n`);
    expect(await t.ingestor.drainSpool()).toBe(1);
    expect(t.fake.calls).toHaveLength(1);
  });
});

describe("chunkTurns", () => {
  it("splits long sessions under the character budget", () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      uuid: `u${i}`,
      role: "user" as const,
      text: "x".repeat(5000),
      timestamp: "",
    }));
    const chunks = chunkTurns(turns, 12_000);
    expect(chunks.length).toBe(5);
    expect(chunks.flat()).toHaveLength(10);
  });
});
